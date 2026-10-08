/* ============================================================================
   services/wealth-ledger.js — AURIX-WEALTH-LEDGER-1 (foundation, divided)

   A single portfolio-level event ledger — the infrastructure that will later
   let Aurix compute deposits / withdrawals / net contributions / wealth
   evolution / durable realized PnL / reports / timeline.

   THIS COMMIT (LEDGER-1) IS INVISIBLE INFRASTRUCTURE. It only:
     - defines the event schema + pure helpers
     - persists events[] in localStorage ('aurix_ledger') and a migration marker
     - does a ONE-TIME, idempotent, NON-DESTRUCTIVE backfill from the existing
       per-asset transactions[] + an estimated 'opening' baseline, on load
     - exposes window.wealthLedger + an IS_DEV self-test

   NOT in this commit (→ AURIX-WEALTH-LEDGER-CAPTURE-1):
     - instrumenting buy / sell / deposit / withdrawal write-paths
   NOT here either: any UI, Wealth Evolution, DERIVED_FINANCIAL_STATE changes,
   RLS, new tables, or modifying closed positions.

   PERSISTENCE NOTE: the remote user_portfolios row has discrete `assets` /
   `holdings` jsonb columns (no free blob). realizedPnL is folded into the
   `holdings` items by app.js (durable cross-device, no schema change). The
   portfolio-level events[] live in localStorage for now — consistent with how
   portfolioHistory/categoryHistory are already localStorage-only. Making
   events[] remote-durable needs a one-column migration and is intentionally
   deferred to a later signalled DB step (adding `events:` to the upsert
   without the column would break saves).

   Loads AFTER app.js (+ wealth-engine.js) so app.js globals are available; all
   dependencies are typeof-guarded so a missing one degrades, never throws.
   ========================================================================== */
(function (global) {
  'use strict';

  var LS_KEY = 'aurix_ledger';
  var SCHEMA = 1;
  var TYPES = ['opening', 'deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'transfer_in', 'transfer_out'];
  // Event types that move external capital → feed net contributions.
  var CONTRIB_SIGN = { opening: 1, deposit: 1, transfer_in: 1, withdrawal: -1, transfer_out: -1 };

  /* ── Dependency resolvers (late-bound, defensive) ───────────────────────── */
  function _assets()  { try { return (typeof assets !== 'undefined' && Array.isArray(assets)) ? assets : []; } catch (_) { return []; } }
  function _baseCcy() { try { return (typeof baseCurrency !== 'undefined' && baseCurrency) ? baseCurrency : 'USD'; } catch (_) { return 'USD'; } }
  function _fx()      { try { return (typeof usdToEur !== 'undefined' && usdToEur) ? usdToEur : 1; } catch (_) { return 1; } }
  function _valUSD(a) { try { return (typeof assetValueUSD === 'function') ? (Number(assetValueUSD(a)) || 0) : 0; } catch (_) { return 0; } }
  function _toBaseAmt(amount, cur) { try { return (typeof toBase === 'function') ? toBase(amount, cur || 'USD') : amount; } catch (_) { return amount; } }
  // AURIX-DATA-001 (F2-cost) — multi-FX. USD/EUR byte-identical (EUR via _fx());
  // GBP/CHF/JPY via the app FX engine (_aurixFxRate); unknown ccy → NaN (uncovered).
  function _toUSD(amount, cur) {
    var c = String(cur || 'USD').toUpperCase();
    if (c === 'USD') return amount;
    if (c === 'EUR') return amount / _fx();
    try { if (typeof _aurixFxRate === 'function') { var r = _aurixFxRate(c); if (Number.isFinite(r)) return amount * r; } } catch (_) {}
    return NaN;
  }
  function _now() { try { return Date.now(); } catch (_) { return 0; } }

  // Stable hash → deterministic ids so a re-run of the backfill never dups.
  function _hash(str) {
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36);
  }
  function _randId() { return _now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // Shared deterministic id for a trade event, so a captured buy/sell (CAPTURE-1)
  // and the same trade seen by a later backfill collapse to ONE event (dedup).
  function tradeEventId(assetId, ts, type, qty, price) {
    return 'tx_' + _hash([assetId, ts, type, qty, price].join('|'));
  }

  /* ── createEvent / validate / append ────────────────────────────────────── */
  function createEvent(partial) {
    partial = partial || {};
    var ev = {
      schema:      SCHEMA,
      id:          partial.id || _randId(),
      ts:          Number.isFinite(partial.ts) ? partial.ts : _now(),
      tsEstimated: !!partial.tsEstimated,
      type:        partial.type,
      amount:      Math.abs(Number(partial.amount) || 0),
      currency:    String(partial.currency || _baseCcy()).toUpperCase(),
      origin:      partial.origin || 'user',
    };
    if (partial.assetId != null) ev.assetId = String(partial.assetId);
    if (partial.ticker  != null) ev.ticker  = String(partial.ticker);
    if (partial.qty     != null) ev.qty     = Number(partial.qty);
    if (partial.price   != null) ev.price   = Number(partial.price);
    if (partial.realized != null) ev.realized = Number(partial.realized);
    if (partial.source  != null) ev.source  = String(partial.source);
    if (partial.note    != null) ev.note    = String(partial.note);
    return ev;
  }

  function validate(ev) {
    if (!ev || typeof ev !== 'object') return { ok: false, reason: 'not-an-object' };
    if (TYPES.indexOf(ev.type) === -1) return { ok: false, reason: 'bad-type' };
    if (!Number.isFinite(ev.amount) || ev.amount < 0) return { ok: false, reason: 'bad-amount' };
    if (!Number.isFinite(ev.ts)) return { ok: false, reason: 'bad-ts' };
    if (!ev.currency) return { ok: false, reason: 'no-currency' };
    if (ev.type === 'buy' || ev.type === 'sell') {
      if (!Number.isFinite(ev.qty) || ev.qty <= 0) return { ok: false, reason: 'trade-needs-qty' };
      if (!Number.isFinite(ev.price) || ev.price < 0) return { ok: false, reason: 'trade-needs-price' };
    }
    return { ok: true };
  }

  // Immutable add with id-dedup (idempotent). Invalid events are dropped.
  function append(events, ev) {
    var arr = Array.isArray(events) ? events : [];
    if (!validate(ev).ok) return arr;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === ev.id) return arr; // dedup
    return arr.concat(ev);
  }

  /* ── backfillFromAssets — derive buy/sell events from transactions[] ────── */
  function backfillFromAssets(list) {
    var arr = Array.isArray(list) ? list : _assets();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      // Cash flows are deposits/withdrawals, not buy/sell — captured live, never
      // backfilled (pre-history is unknown). Skip cash here to avoid mislabelling.
      if (a && a.type === 'cash') continue;
      var txs = (a && Array.isArray(a.transactions)) ? a.transactions : [];
      for (var j = 0; j < txs.length; j++) {
        var tx = txs[j];
        if (tx.type !== 'buy' && tx.type !== 'sell') continue;
        var qty = Number(tx.qty) || 0, price = Number(tx.price) || 0;
        if (qty <= 0) continue;
        var ts = Number.isFinite(tx.ts) ? tx.ts : _now();
        var cur = String(a.assetCurrency || 'USD').toUpperCase();
        var id = tradeEventId(a.id, ts, tx.type, qty, price);
        out.push(createEvent({
          id: id, type: tx.type, qty: qty, price: price,
          amount: qty * price, currency: cur,
          assetId: a.id, ticker: a.ticker,
          ts: ts, tsEstimated: !!tx.estimated, origin: 'backfill',
        }));
      }
    }
    return out;
  }

  /* ── computeOpeningEvent — estimated baseline at migration ──────────────── */
  function _investedBase(arr) {
    try { if (typeof totalCostBasisBase === 'function') return Number(totalCostBasisBase()) || 0; } catch (_) {}
    var usd = 0;
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (a.type === 'cash' || a.type === 'real_estate') continue;
      var cb = Number(a.costBasis || 0);
      if (cb > 0) usd += _toUSD(cb, a.assetCurrency || 'USD');
    }
    return _toBaseAmt(usd, 'USD');
  }
  function _cashBase(arr) {
    var usd = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i].type === 'cash') usd += _valUSD(arr[i]);
    return _toBaseAmt(usd, 'USD');
  }
  function computeOpeningEvent(list, opts) {
    opts = opts || {};
    var arr = Array.isArray(list) ? list : _assets();
    var amount = _investedBase(arr) + _cashBase(arr);
    return createEvent({
      id: 'opening:v1',                 // singleton → idempotent across re-runs
      type: 'opening',
      amount: amount,
      currency: _baseCcy(),
      ts: Number.isFinite(opts.nowTs) ? opts.nowTs : _now(),
      tsEstimated: true,                // NEVER presented as a real deposit
      origin: 'opening',
      note: 'estimated opening baseline (invested cost + cash) at migration',
    });
  }

  /* ── Derivations (FUTURE use — not surfaced in this phase) ──────────────── */
  // Net contributions in base currency. Internal moves (buy/sell/dividend/fee)
  // are excluded by design; only external capital flows + the opening baseline.
  function netContributions(events) {
    var arr = Array.isArray(events) ? events : (_ledger().events || []);
    var total = 0;
    for (var i = 0; i < arr.length; i++) {
      var sign = CONTRIB_SIGN[arr[i].type];
      if (!sign) continue;
      total += sign * _toBaseAmt(Number(arr[i].amount) || 0, arr[i].currency);
    }
    return { base: total, currency: _baseCcy() };
  }
  // Durable realized PnL reconstructed from the ledger. Backfilled sells carry
  // no `realized` (the historical avg cost is unknown) → 0 until CAPTURE-1
  // stamps it; the per-holding realizedPnL remains the source of truth meanwhile.
  function realizedFromLedger(events) {
    var arr = Array.isArray(events) ? events : (_ledger().events || []);
    var total = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i].type === 'sell' && Number.isFinite(arr[i].realized)) total += arr[i].realized;
    return { usd: total };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     AURIX-PORTFOLIO-CHART-CASHFLOW-AWARE-1 — cashflow-aware evolution math.

     Pure infrastructure: lets Aurix separate PATRIMONIO (net worth) from
     APORTACIONES (external capital in/out) so a deposit is never read as
     market gain. No UI is touched — these series are produced in parallel and
     consumed later (Wealth Evolution, cashflow-aware chart, Workspace, reports).

     Integrity rules (see spec §2, §11): external capital only (opening / deposit
     / withdrawal / transfer_in / transfer_out via CONTRIB_SIGN). buy/sell are
     internal moves and never count as contributions. dividend/fee are excluded
     in v1. Missing data → confidence 'insufficient'; an estimated opening →
     'partial'. Nothing is invented, interpolated, or artificially smoothed.
     All amounts are normalised to the base currency (same unit as net worth).
     ════════════════════════════════════════════════════════════════════════ */

  // Is this a valid external-capital flow we can place on a timeline?
  function _isContribEvent(e) {
    return !!e && typeof e === 'object'
      && !!CONTRIB_SIGN[e.type]
      && Number.isFinite(Number(e.ts))
      && Number.isFinite(Number(e.amount)) && Number(e.amount) >= 0;
  }

  // Net external capital contributed up to (and including) `ts`, in base ccy.
  // Internal moves (buy/sell/dividend/fee) never affect the result.
  function calculateNetContributionsAt(events, ts) {
    var arr = Array.isArray(events) ? events : (_ledger().events || []);
    var cutoff = Number(ts);
    if (!Number.isFinite(cutoff)) cutoff = Infinity;
    var total = 0;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (!_isContribEvent(e)) continue;
      if (Number(e.ts) > cutoff) continue;
      total += CONTRIB_SIGN[e.type] * _toBaseAmt(Number(e.amount) || 0, e.currency);
    }
    return total;
  }

  // Cumulative net-contributions step series in base currency:
  //   [{ ts, contributions }]  ascending by ts, no duplicate timestamps.
  // Deterministic (same input → same output): same-ts flows collapse into one
  // point and addition is order-independent. Invalid events are ignored.
  function buildCashflowSeries(events) {
    var arr = Array.isArray(events) ? events : (_ledger().events || []);
    var flows = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (!_isContribEvent(e)) continue;
      flows.push({ ts: Number(e.ts), delta: CONTRIB_SIGN[e.type] * _toBaseAmt(Number(e.amount) || 0, e.currency) });
    }
    if (!flows.length) return [];
    flows.sort(function (a, b) { return a.ts - b.ts; });
    var out = [], running = 0;
    for (var j = 0; j < flows.length; j++) {
      running += flows[j].delta;
      var last = out.length ? out[out.length - 1] : null;
      if (last && last.ts === flows[j].ts) last.contributions = running; // collapse same-ts
      else out.push({ ts: flows[j].ts, contributions: running });
    }
    return out;
  }

  // Three aligned series + an honesty verdict. PURE: net worth comes from the
  // caller's portfolioHistory, contributions from the ledger events.
  //   { netWorthSeries:[{ts,value}], contributionsSeries:[{ts,value}],
  //     gainSeries:[{ts,value}], confidence, startsAt, notes:[] }
  function buildEvolutionSeries(portfolioHistory, events) {
    var notes = [];

    var hist = (Array.isArray(portfolioHistory) ? portfolioHistory : [])
      .filter(function (p) { return p && Number.isFinite(Number(p.ts)) && Number.isFinite(Number(p.value)); })
      .map(function (p) { return { ts: Number(p.ts), value: Number(p.value) }; })
      .sort(function (a, b) { return a.ts - b.ts; });

    var evs = Array.isArray(events) ? events : (_ledger().events || []);
    var contribEvents = evs.filter(_isContribEvent);

    var netWorthSeries     = hist.map(function (p) { return { ts: p.ts, value: p.value }; });
    var contributionsSeries = buildCashflowSeries(contribEvents)
      .map(function (c) { return { ts: c.ts, value: c.contributions }; });

    // No external-capital events at all → we cannot separate aportaciones from
    // growth. Be honest: 'insufficient', and never fabricate contributions.
    if (!contribEvents.length) {
      notes.push('no-ledger-flows');
      return {
        netWorthSeries: netWorthSeries,
        contributionsSeries: [],
        gainSeries: [],
        confidence: 'insufficient',
        startsAt: null,
        notes: notes,
      };
    }

    // gain(ts) = netWorth(ts) − netContributions(≤ ts). Aligned to net-worth
    // samples (the only timestamps where total value is actually known).
    var gainSeries = hist.map(function (p) {
      return { ts: p.ts, value: p.value - calculateNetContributionsAt(contribEvents, p.ts) };
    });

    // startsAt = earliest real data point across both series — never earlier
    // than the first event (no invented pre-history).
    var firstContribTs = contribEvents.reduce(function (m, e) {
      var t = Number(e.ts); return (m == null || t < m) ? t : m;
    }, null);
    var firstHistTs = hist.length ? hist[0].ts : null;
    var startsAt = (firstHistTs == null) ? firstContribTs
                 : (firstContribTs == null) ? firstHistTs
                 : Math.min(firstHistTs, firstContribTs);

    // Confidence: an estimated opening baseline means the early history is a
    // reference, not a recorded deposit → 'partial'. Otherwise 'complete'.
    var hasEstimatedOpening = contribEvents.some(function (e) { return e.type === 'opening' && e.tsEstimated; });
    var confidence;
    if (hasEstimatedOpening) { confidence = 'partial'; notes.push('estimated-opening'); }
    else                     { confidence = 'complete'; }
    if (!hist.length) notes.push('no-networth-history');

    return {
      netWorthSeries: netWorthSeries,
      contributionsSeries: contributionsSeries,
      gainSeries: gainSeries,
      confidence: confidence,
      startsAt: startsAt,
      notes: notes,
    };
  }

  /* ── Persistence (localStorage; events[] only — see header note) ────────── */
  var _cache = null;
  function _ledger() {
    if (_cache) return _cache;
    try {
      var raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      _cache = (obj && Array.isArray(obj.events)) ? obj : { events: [], ledgerMigrated: false, schema: SCHEMA };
    } catch (_) { _cache = { events: [], ledgerMigrated: false, schema: SCHEMA }; }
    return _cache;
  }
  function _save(obj) {
    _cache = obj;
    try { if (global.localStorage) global.localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (_) {}
  }
  function getEvents()      { return (_ledger().events || []).slice(); }
  function isMigrated()     { return !!_ledger().ledgerMigrated; }

  // Per-asset timeline (AURIX-ASSET-DETAIL-1) — events for one asset, oldest
  // first. The detail screen's history consumes this directly (Ledger only).
  function eventsForAsset(assetId, events) {
    var arr = Array.isArray(events) ? events : (_ledger().events || []);
    return arr.filter(function (e) { return e && e.assetId === assetId; })
              .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }

  /* ── One-time idempotent backfill (called on portfolio-ready) ───────────── */
  function ensureBackfill(list) {
    var L = _ledger();
    if (L.ledgerMigrated) return { skipped: 'already-migrated', count: (L.events || []).length };
    var arr = Array.isArray(list) ? list : _assets();
    if (!arr.length) return { skipped: 'empty-portfolio' }; // don't mark while empty
    var events = (L.events || []).slice();
    var bf = backfillFromAssets(arr);
    for (var i = 0; i < bf.length; i++) events = append(events, bf[i]);
    var op = computeOpeningEvent(arr, { nowTs: _now() });
    events = append(events, op);
    _save({ events: events, ledgerMigrated: true, schema: SCHEMA });
    return { migrated: true, count: events.length, backfilled: bf.length };
  }

  /* ── record — append-only capture of a single live event (CAPTURE-1) ────── */
  // Used by app.js write-paths. Append-only + idempotent by id; never throws to
  // the caller (the trade/save must never be blocked by the ledger). Returns the
  // event, or null if invalid.
  function record(partial) {
    try {
      var ev = createEvent(partial);
      if (!validate(ev).ok) return null;
      var L = _ledger();
      var events = append(L.events || [], ev);
      if (events !== (L.events || [])) {
        _save({ events: events, ledgerMigrated: L.ledgerMigrated, schema: SCHEMA });
      }
      return ev;
    } catch (_) { return null; }
  }

  /* ── Dev-only self-test ─────────────────────────────────────────────────── */
  function _approx(a, b, t) { return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= (t == null ? 0.01 : t); }
  function selfTest() {
    var R = [], ok = function (n, c, x) { R.push(Object.assign({ test: n, pass: !!c }, x || {})); };
    try {
      ok('createEvent normalizes + valid', validate(createEvent({ type: 'deposit', amount: 100, currency: 'EUR' })).ok);
      ok('validate rejects bad type', !validate(createEvent({ type: 'nope', amount: 1, currency: 'EUR' })).ok);
      ok('validate rejects negative amount', !validate({ type: 'deposit', amount: -1, currency: 'EUR', ts: 1 }).ok);
      ok('validate rejects buy without qty', !validate({ type: 'buy', amount: 10, currency: 'USD', ts: 1, price: 5 }).ok);

      var fx = [
        { id: 'a1', ticker: 'BTC', type: 'crypto', assetCurrency: 'USD', costBasis: 40000, qty: 1, price: 50000,
          transactions: [{ type: 'buy', qty: 1, price: 40000, ts: 1000 }] },
        { id: 'a2', ticker: 'AAPL', type: 'stock', assetCurrency: 'EUR', costBasis: 800, qty: 5, price: 200,
          transactions: [{ type: 'buy', qty: 10, price: 100, ts: 2000 }, { type: 'sell', qty: 5, price: 150, ts: 3000 }] },
        { id: 'c1', ticker: '€', type: 'cash', assetCurrency: 'EUR', qty: 1000, price: 1 },
      ];
      var bf = backfillFromAssets(fx);
      ok('backfill: 3 trade events (2 buy + 1 sell)', bf.length === 3);
      // idempotent re-append: same ids → no duplicates
      var ev = []; bf.concat(bf).forEach(function (e) { ev = append(ev, e); });
      ok('backfill: re-append dedups (no dup ids)', ev.length === 3);

      var op = computeOpeningEvent(fx, { nowTs: 999 });
      ok('opening: tsEstimated true', op.tsEstimated === true);
      ok('opening: singleton id', op.id === 'opening:v1');
      ok('opening: type opening', op.type === 'opening');

      var synth = [
        createEvent({ id: 'o', type: 'opening', amount: 1000, currency: _baseCcy() }),
        createEvent({ type: 'deposit', amount: 500, currency: _baseCcy() }),
        createEvent({ type: 'withdrawal', amount: 200, currency: _baseCcy() }),
        createEvent({ id: 'b', type: 'buy', qty: 1, price: 300, amount: 300, currency: _baseCcy() }),
      ];
      ok('netContributions = opening+dep-wd, excludes buy', _approx(netContributions(synth).base, 1300));
      ok('realizedFromLedger sums sell.realized', _approx(realizedFromLedger([createEvent({ id: 's', type: 'sell', qty: 1, price: 9, amount: 9, currency: 'USD', realized: 42 })]).usd, 42));

      /* ── AURIX-PORTFOLIO-CHART-CASHFLOW-AWARE-1 — cases A–G ──────────────── */
      var bc = _baseCcy();
      var mk = function (type, amount, ts, extra) { return createEvent(Object.assign({ type: type, amount: amount, currency: bc, ts: ts }, extra || {})); };
      var lastVal = function (series) { return series && series.length ? series[series.length - 1].value : null; };

      var rA = buildEvolutionSeries([{ ts: 200, value: 10000 }], [mk('deposit', 10000, 100)]);
      ok('evo A: contributions 10000', _approx(lastVal(rA.contributionsSeries), 10000));
      ok('evo A: gain 0',              _approx(lastVal(rA.gainSeries), 0));

      var rB = buildEvolutionSeries([{ ts: 200, value: 12000 }], [mk('deposit', 10000, 100)]);
      ok('evo B: contributions 10000', _approx(lastVal(rB.contributionsSeries), 10000));
      ok('evo B: gain 2000',           _approx(lastVal(rB.gainSeries), 2000));

      var rC = buildEvolutionSeries([{ ts: 300, value: 17000 }], [mk('deposit', 10000, 100), mk('deposit', 5000, 200)]);
      ok('evo C: contributions 15000', _approx(lastVal(rC.contributionsSeries), 15000));
      ok('evo C: gain 2000',           _approx(lastVal(rC.gainSeries), 2000));

      var rD = buildEvolutionSeries([{ ts: 300, value: 9000 }], [mk('deposit', 10000, 100), mk('withdrawal', 2000, 200)]);
      ok('evo D: contributions 8000',  _approx(lastVal(rD.contributionsSeries), 8000));
      ok('evo D: gain 1000',           _approx(lastVal(rD.gainSeries), 1000));

      var eE = [mk('deposit', 10000, 100),
                createEvent({ type: 'buy',  qty: 1, price: 5000, amount: 5000, currency: bc, ts: 200 }),
                createEvent({ type: 'sell', qty: 1, price: 6000, amount: 6000, currency: bc, ts: 300, realized: 1000 })];
      ok('evo E: buy/sell ignored (net 10000)', _approx(calculateNetContributionsAt(eE, Infinity), 10000));

      var rF = buildEvolutionSeries([{ ts: 200, value: 20000 }],
                [createEvent({ id: 'opening:v1', type: 'opening', amount: 20000, currency: bc, ts: 100, tsEstimated: true })]);
      ok('evo F: estimated opening → partial', rF.confidence === 'partial');

      var rG = buildEvolutionSeries([{ ts: 200, value: 5000 }], []);
      ok('evo G: no ledger → insufficient', rG.confidence === 'insufficient');
      ok('evo G: series empty-safe', rG.contributionsSeries.length === 0 && rG.gainSeries.length === 0);
    } catch (e) { ok('selfTest threw', false, { error: e && e.message }); }

    var pass = R.every(function (r) { return r.pass; });
    try { console.log('%c[wealthLedger] self-test ' + (pass ? 'PASS' : 'FAIL'), 'color:' + (pass ? '#27c768' : '#e0664a') + ';font-weight:700', R); } catch (_) {}
    return { pass: pass, results: R };
  }

  /* ── Public namespace ───────────────────────────────────────────────────── */
  global.wealthLedger = {
    version: 1,
    TYPES: TYPES.slice(),
    createEvent: createEvent,
    validate: validate,
    append: append,
    record: record,
    tradeEventId: tradeEventId,
    backfillFromAssets: backfillFromAssets,
    computeOpeningEvent: computeOpeningEvent,
    netContributions: netContributions,
    realizedFromLedger: realizedFromLedger,
    // AURIX-PORTFOLIO-CHART-CASHFLOW-AWARE-1 — cashflow-aware evolution math.
    calculateNetContributionsAt: calculateNetContributionsAt,
    buildCashflowSeries: buildCashflowSeries,
    buildEvolutionSeries: buildEvolutionSeries,
    getEvents: getEvents,
    eventsForAsset: eventsForAsset,
    isMigrated: isMigrated,
    ensureBackfill: ensureBackfill,
    selfTest: selfTest,
  };

  // Run the idempotent backfill once the portfolio is hydrated (app.js fires
  // 'aurix:portfolio-ready'). Dev self-test runs alongside.
  try {
    var _dev = (typeof IS_DEV !== 'undefined') && IS_DEV;
    global.addEventListener('aurix:portfolio-ready', function () {
      try { var r = global.wealthLedger.ensureBackfill(); if (_dev) console.log('[wealthLedger] ensureBackfill', r); } catch (_) {}
    });
    if (_dev) {
      if (typeof document !== 'undefined' && document.readyState !== 'complete') {
        global.addEventListener('load', function () { try { global.wealthLedger.selfTest(); } catch (_) {} });
      } else { global.wealthLedger.selfTest(); }
    }
  } catch (_) {}

})(typeof window !== 'undefined' ? window : this);
