/* ============================================================================
   services/portfolio-chart-engine.js — AURIX-PORTFOLIO-CHART-ENGINE-1 · Fase A

   THE PURE MATH + TIME CORE of the Aurix Portfolio Chart Engine (PCE).

   This is the definitive foundation for ALL Aurix net-worth-style charts
   (Dashboard, Wealth Evolution, Category Performance, Workspace, future premium
   surfaces, professional fullscreen). It reconstructs portfolio value over time
   as  netWorth(t) = Σ qtyᵢ(t)·priceᵢ(t)·fx(t) + cash(t)  instead of relying on
   the snapshots the app could self-record while open.

   FASE A SCOPE — strictly the math + temporal core. This file:
     • is PURE: no DOM, no fetch, no timers, no app.js globals, no side effects
       beyond defining window.AurixPortfolioEngine (a frozen namespace);
     • is COMPLETELY DORMANT: it is NOT loaded by index.html in this phase, so
       Aurix's visible behaviour is byte-for-byte unchanged;
     • performs NO price fetching and NO rendering (later phases inject prices
       and bridge to aurix-chart-core);
     • is deterministic and node-testable (run `node services/portfolio-chart-engine.js`).

   DESIGN PRINCIPLES (locked in here so later phases never need a rewrite):
     1. Generic by asset-set — every function works on an arbitrary list of
        holdings, so Dashboard (all), Category (filtered), Workspace (subset)
        and Wealth Evolution (all + contributions) share ONE engine.
     2. Multi-resolution — granularity (intraday | daily | weekly | monthly) is
        a first-class parameter; the grid builder is resolution-agnostic.
     3. Fullscreen / crosshair ready — the output is a structured object with a
        timestamped series (exact read-by-date) plus reserved `overlays` /
        `annotations` arrays for future trend lines / overlays / notes.
     4. Dependency inversion — the engine NEVER hardcodes asset→symbol policy.
        The caller injects a `resolveHolding` resolver. In integration the real
        `_aurixAssetPickAdapter` (app.js:11083) is passed in, so there is ZERO
        duplication / drift of classification rules. `defaultResolveHolding`
        below mirrors those rules ONLY for self-tests.

   FIDELITY > AESTHETICS: this core never fabricates a data point. Market value
   is sampled by linear interpolation strictly BETWEEN real provider samples
   (the market was continuous); it never extrapolates a price before the first
   real sample. Quantities and cash are step functions that change only at real
   user events. Static (non-feed) holdings are held flat — which is the truth
   for a user-asserted value, not invented market movement — and are reported as
   reduced confidence so the surface can label them.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────────── */
  var DAY_MS  = 86400000;
  var RANGE_MS = {
    '24h': DAY_MS,
    '7d':  7   * DAY_MS,
    '30d': 30  * DAY_MS,
    '1y':  365 * DAY_MS,
    'all': null            // unbounded — caller supplies the span via firstTs
  };
  // Default temporal resolution per range. Overridable by the caller.
  var DEFAULT_GRANULARITY = {
    '24h': 'intraday', '7d': 'intraday', '30d': 'daily', '1y': 'daily', 'all': 'weekly'
  };
  var GRANULARITY = ['intraday', 'daily', 'weekly', 'monthly'];
  var MAX_GRID_POINTS = 250;             // hard cap on rendered points (perf)
  var MIN_INTRADAY_STEP_MS = 5 * 60000;  // 5 min — finest grid we ever draw

  var CONFIDENCE = { COMPLETE: 'complete', PARTIAL: 'partial', INSUFFICIENT: 'insufficient' };

  /* ── Small pure utilities ──────────────────────────────────────────────── */
  function _isFiniteNum(x) { return typeof x === 'number' && isFinite(x); }
  function _num(x, fallback) { return _isFiniteNum(x) ? x : (fallback || 0); }
  function _asArray(x) { return Array.isArray(x) ? x : []; }

  // Coarse step (ms) for a granularity. For 'intraday' the step adapts to the
  // span so a 24h window is fine-grained and a 30d intraday window stays bounded.
  function _granularityStep(granularity, spanMs) {
    switch (granularity) {
      case 'daily':   return DAY_MS;
      case 'weekly':  return 7 * DAY_MS;
      case 'monthly': return 30 * DAY_MS;
      case 'intraday':
      default:
        if (!_isFiniteNum(spanMs) || spanMs <= 0) return MIN_INTRADAY_STEP_MS;
        return Math.max(MIN_INTRADAY_STEP_MS, Math.floor(spanMs / MAX_GRID_POINTS));
    }
  }

  /* ── Temporal core: the grid ───────────────────────────────────────────────
     Builds an ascending array of timestamps covering [now - span, now].
     Resolution-agnostic and bounded to MAX_GRID_POINTS. The final timestamp is
     always exactly `now` so the live anchor lands on a real grid slot.        */
  function buildGrid(opts) {
    var o = opts || {};
    var now = _num(o.now, 0);
    if (now <= 0) return [];
    var range = o.range;
    var span = RANGE_MS.hasOwnProperty(range) && RANGE_MS[range] != null
      ? RANGE_MS[range]
      : _num(o.spanMs, 0);                 // 'all' / custom → caller supplies span
    if (span <= 0 && _isFiniteNum(o.firstTs) && o.firstTs > 0) span = now - o.firstTs;
    if (span <= 0) return [now];

    var granularity = GRANULARITY.indexOf(o.granularity) !== -1
      ? o.granularity
      : (DEFAULT_GRANULARITY[range] || 'daily');
    var maxPoints = _num(o.maxPoints, MAX_GRID_POINTS);

    var step = _granularityStep(granularity, span);
    var n = Math.floor(span / step);
    if (n > maxPoints) { step = Math.ceil(span / maxPoints); n = maxPoints; }
    if (n < 1) n = 1;

    var start = now - span;
    var grid = [];
    for (var i = 0; i < n; i++) grid.push(start + i * step);
    grid.push(now);                         // guarantee the live anchor slot
    return grid;
  }

  /* ── Quantity timeline ──────────────────────────────────────────────────────
     From an asset's transactions[] ([{type:'buy'|'sell', qty, price, ts}]) builds
     a cumulative step function of units held. qtyAt(t) = Σ buys − Σ sells with
     ts ≤ t (0 before the first transaction). 100% real — no fabrication.        */
  function buildQuantityTimeline(transactions) {
    var txns = _asArray(transactions)
      .filter(function (t) { return t && _isFiniteNum(t.ts) && _isFiniteNum(t.qty); })
      .slice()
      .sort(function (a, b) { return a.ts - b.ts; });
    var points = [];     // [{ts, qty}] cumulative
    var running = 0;
    for (var i = 0; i < txns.length; i++) {
      var t = txns[i];
      var sign = (t.type === 'sell') ? -1 : 1;
      running += sign * Math.abs(t.qty);
      if (running < 0) running = 0;          // never report a negative position
      points.push({ ts: t.ts, qty: running });
    }
    return {
      points: points,
      firstTs: points.length ? points[0].ts : null,
      at: function (ts) {
        var q = 0;
        for (var j = 0; j < points.length; j++) {
          if (points[j].ts <= ts) q = points[j].qty; else break;
        }
        return q;
      }
    };
  }

  /* ── Cash timeline ──────────────────────────────────────────────────────────
     From wealth-ledger external-capital events (deposit/withdrawal/opening/...
     and trade buy/sell that move a cash balance) builds a per-currency step
     balance. Pure: caller passes the events array. balanceAt(t) sums signed
     amounts with ts ≤ t. Cash is flat between events — the truth (no market).   */
  var CASH_SIGN = { opening: 1, deposit: 1, transfer_in: 1, withdrawal: -1, transfer_out: -1 };
  function buildCashTimeline(events) {
    var evs = _asArray(events)
      .filter(function (e) { return e && _isFiniteNum(e.ts) && CASH_SIGN.hasOwnProperty(e.type); })
      .slice()
      .sort(function (a, b) { return a.ts - b.ts; });
    // Per-currency cumulative points so multi-currency cash is reconstructable.
    var byCcy = {};
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      var ccy = (e.currency || 'USD').toUpperCase();
      var prev = byCcy[ccy] && byCcy[ccy].length ? byCcy[ccy][byCcy[ccy].length - 1].balance : 0;
      var bal = prev + CASH_SIGN[e.type] * Math.abs(_num(e.amount, 0));
      if (bal < 0) bal = 0;
      (byCcy[ccy] = byCcy[ccy] || []).push({ ts: e.ts, balance: bal });
    }
    return {
      byCurrency: byCcy,
      balanceAt: function (ts, ccy) {
        var pts = byCcy[(ccy || 'USD').toUpperCase()] || [];
        var b = 0;
        for (var j = 0; j < pts.length; j++) { if (pts[j].ts <= ts) b = pts[j].balance; else break; }
        return b;
      }
    };
  }

  /* ── Series sampling ────────────────────────────────────────────────────────
     Sample a real price series [{t,v}] (ascending) at time ts.
       mode 'linear' (market prices): linear interpolation strictly BETWEEN real
         samples; returns null before the first sample (never extrapolate a price
         backwards), holds the last real value for ts beyond the last sample.
       mode 'step'   (user-asserted values): last value with t ≤ ts.
     Returns null when there is no honest value to report.                       */
  function sampleSeriesAt(series, ts, mode) {
    var s = _asArray(series);
    if (!s.length) return null;
    if (ts <= s[0].t) return (ts === s[0].t) ? s[0].v : (mode === 'step' ? null : null);
    if (ts >= s[s.length - 1].t) return s[s.length - 1].v;
    // find bracketing samples
    var lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (s[mid].t <= ts) lo = mid; else hi = mid;
    }
    if (mode === 'step') return s[lo].v;
    var a = s[lo], b = s[hi];
    if (b.t === a.t) return a.v;
    var f = (ts - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * f;
  }

  /* ── Confidence classifier ─────────────────────────────────────────────────
     coverage = covered value / total value at a point (0..1).
     hasStatic = some value came from a user-asserted (non-feed) holding.        */
  function classifyConfidence(coverage, hasStatic) {
    if (!_isFiniteNum(coverage) || coverage < 0.5) return CONFIDENCE.INSUFFICIENT;
    if (coverage < 0.999 || hasStatic) return CONFIDENCE.PARTIAL;
    return CONFIDENCE.COMPLETE;
  }

  /* ── Default holding resolver (SELF-TEST ONLY) ───────────────────────────────
     Mirrors app.js `_aurixAssetPickAdapter` so the self-test is self-contained.
     PRODUCTION INJECTS THE REAL RESOLVER — this is never the source of truth.   */
  function defaultResolveHolding(asset) {
    var a = asset || {};
    var tp = String(a.type || '').toLowerCase();
    if (tp === 'cash') return { mode: 'cash' };
    if (tp === 'real_estate') return { mode: 'static' };
    if (tp === 'crypto' && a.coinId) return { mode: 'market', provider: 'crypto', key: String(a.coinId) };
    var sym = a.marketSymbol || a.ticker || '';
    if (tp === 'metal' && (sym === 'XAU' || a.ticker === 'XAU')) sym = 'GC=F';
    if (!sym) return { mode: 'static' };
    return { mode: 'market', provider: 'yahoo', key: String(sym).toUpperCase() };
  }

  /* ── buildCashBaseAt — aggregate cash → BASE, ONCE per currency ──────────────
     Cash is a portfolio-level, per-CURRENCY fact (not a per-asset one). This is
     the SINGLE place cash is aggregated, which structurally removes any chance
     of double counting (two cash entries in the same currency can't be summed
     twice). fxByCurrency: { CCY → factor to base }; the base currency's factor
     is 1. A currency with no known factor is skipped (cannot be valued honestly)
     — coverage / confidence upstream reflects that rather than guessing.        */
  function buildCashBaseAt(cashTimeline, fxByCurrency, baseCurrency) {
    var fx = fxByCurrency || {};
    var base = String(baseCurrency || 'USD').toUpperCase();
    var ccys = (cashTimeline && cashTimeline.byCurrency) ? Object.keys(cashTimeline.byCurrency) : [];
    return function (t) {
      var sum = 0;
      for (var i = 0; i < ccys.length; i++) {
        var ccy = ccys[i];
        var bal = cashTimeline.balanceAt(t, ccy);
        if (!bal) continue;
        var rate = (ccy === base) ? 1 : (_isFiniteNum(fx[ccy]) ? fx[ccy] : null);
        if (rate == null) continue;
        sum += bal * rate;
      }
      return sum;
    };
  }

  /* ── Composition: the net-worth series — STRICTLY BASE CURRENCY ──────────────
     PURE. The engine NEVER does FX and NEVER assumes any currency: ALL inputs
     must already be in the base currency (the caller / Fase C pre-converts).
     Inputs:
       grid        : ascending timestamps (from buildGrid)
       holdings    : [{ asset, classification:{mode:'market'|'static', key?}, qtyTimeline, currentValue }]
                     • market : value(t) = qtyTimeline.at(t) × priceByKey[key] sampled at t  (BASE)
                     • static : currentValue held flat (real estate / manual / no-feed) (BASE)
                     • 'cash' classification is IGNORED here — cash enters ONCE via
                       cashBaseAt (aggregated per-currency), so it can never double-count.
       priceByKey  : { key → [{t,v}] } real price series, ALREADY CONVERTED TO BASE
       cashBaseAt  : optional function(t) → total cash in BASE (see buildCashBaseAt)
       nowValue    : live total (BASE) to anchor ONLY the final point
       fxApproximated : true when any conversion used a non-historical rate → caps
                        overall confidence at 'partial' (honest FX caveat, never COMPLETE)
     Output (fullscreen/crosshair-ready, extensible):
       { series:[{t, v, confidence}], meta:{...}, overlays:[], annotations:[] }   */
  function composeNetWorth(input) {
    var o = input || {};
    var grid = _asArray(o.grid);
    var holdings = _asArray(o.holdings);
    var priceByKey = o.priceByKey || {};
    var cashBaseAt = (typeof o.cashBaseAt === 'function') ? o.cashBaseAt : null;
    var lastT = grid.length ? grid[grid.length - 1] : 0;

    var series = [];
    var anyStaticOverall = false;
    var coverageAccum = 0;

    // SPEC 4.1D — READ-ONLY per-asset coverage attribution. Diagnostic ONLY: the
    // sub-pass below RE-reads the same prices/qty/cash and normalises by the same
    // expectedVal(t), accumulating each holding's covered/missing SHARE. It never
    // touches total/coveredVal/expectedVal/coverage/series — the official value is
    // unchanged. Across all rows + cash, coverageContribution sums to avgCoverage
    // and missingContribution sums to (1 − avgCoverage).
    var _dxN = holdings.length;
    var _dxCov = new Array(_dxN), _dxMiss = new Array(_dxN), _dxUncov = new Array(_dxN);
    for (var _di = 0; _di < _dxN; _di++) { _dxCov[_di] = 0; _dxMiss[_di] = 0; _dxUncov[_di] = false; }
    var _dxCashCov = 0;

    for (var gi = 0; gi < grid.length; gi++) {
      var t = grid[gi];
      var total = 0, coveredVal = 0, expectedVal = 0, hasStatic = false;

      for (var hi = 0; hi < holdings.length; hi++) {
        var h = holdings[hi];
        var cls = h.classification || { mode: 'static' };

        if (cls.mode === 'cash') continue;   // cash handled once via cashBaseAt — no per-asset double count

        if (cls.mode === 'market' && h.qtyTimeline) {
          var qty = h.qtyTimeline.at(t);
          if (qty <= 0) continue;                       // no position at t → no value
          var px = sampleSeriesAt(priceByKey[cls.key], t, 'linear');   // price ALREADY in base
          if (px == null) {
            // Position held but NO real price coverage at t → uncovered. It does
            // not contribute to the drawn value; it only adds to `expectedVal`
            // (weighted by the last-known price) so coverage — and therefore the
            // point's confidence — drops honestly. Never invent the value.
            var lastPx = sampleSeriesAt(priceByKey[cls.key], lastT, 'linear');
            expectedVal += (lastPx != null) ? qty * lastPx : _num(h.currentValue, 0);
            continue;
          }
          var v = qty * px;                             // base × base, no FX here
          total += v; coveredVal += v; expectedVal += v;
          continue;
        }

        // static (real estate, manual / no-feed funds): held flat at current BASE value.
        var sv = _num(h.currentValue, 0);
        total += sv; expectedVal += sv; coveredVal += sv;
        hasStatic = true; anyStaticOverall = true;
      }

      // Cash: aggregated per-currency upstream and added ONCE (covered + known).
      if (cashBaseAt) {
        var cb = _num(cashBaseAt(t), 0);
        total += cb; coveredVal += cb; expectedVal += cb;
      }

      // Coverage measures: of the value we EXPECT at t, how much is backed by a
      // real feed/event. When nothing is expected at t (empty portfolio, or a
      // point before any position/cash existed), net worth is fully KNOWN to be
      // ~0 — that is complete knowledge, not "uncovered". So coverage = 1 then.
      var coverage = expectedVal > 0 ? (coveredVal / expectedVal) : 1;
      coverageAccum += coverage;
      series.push({ t: t, v: +total.toFixed(2), confidence: classifyConfidence(coverage, hasStatic) });

      // SPEC 4.1D diagnostic sub-pass (read-only). Recomputes each holding's
      // covered/missing share of expectedVal(t); writes ONLY to _dx* arrays.
      if (expectedVal > 0) {
        for (var dj = 0; dj < _dxN; dj++) {
          var dh = holdings[dj];
          var dcls = dh.classification || { mode: 'static' };
          if (dcls.mode === 'cash') continue;
          if (dcls.mode === 'market' && dh.qtyTimeline) {
            var dq = dh.qtyTimeline.at(t);
            if (dq <= 0) continue;
            var dpx = sampleSeriesAt(priceByKey[dcls.key], t, 'linear');
            if (dpx == null) {
              var dlast = sampleSeriesAt(priceByKey[dcls.key], lastT, 'linear');
              _dxMiss[dj] += ((dlast != null) ? dq * dlast : _num(dh.currentValue, 0)) / expectedVal;
              _dxUncov[dj] = true;
            } else {
              _dxCov[dj] += (dq * dpx) / expectedVal;
            }
            continue;
          }
          _dxCov[dj] += _num(dh.currentValue, 0) / expectedVal;   // static
        }
        if (cashBaseAt) _dxCashCov += _num(cashBaseAt(t), 0) / expectedVal;
      }
    }

    // Anchor ONLY the final point to the live total (never rescale history, never
    // touch historical points, never fabricate a point to reconcile).
    if (_isFiniteNum(o.nowValue) && series.length) {
      series[series.length - 1] = {
        t: series[series.length - 1].t,
        v: +o.nowValue.toFixed(2),
        confidence: series[series.length - 1].confidence
      };
    }

    var avgCoverage = series.length ? (coverageAccum / series.length) : 0;
    var overallConf = classifyConfidence(avgCoverage, anyStaticOverall);
    // FX approximation (non-historical rate) is an honest fidelity caveat → never COMPLETE.
    if (o.fxApproximated && overallConf === CONFIDENCE.COMPLETE) overallConf = CONFIDENCE.PARTIAL;
    var first = series.length ? series[0].v : null;
    var last = series.length ? series[series.length - 1].v : null;

    // SPEC 4.1D — assemble the read-only per-asset coverage diagnostic. Pure
    // metadata; does not affect series/coverage/confidence above.
    var coverageByAsset = [];
    var _gn = grid.length || 1;
    var _gridStart = grid.length ? grid[0] : 0;
    for (var ci = 0; ci < holdings.length; ci++) {
      var cclas = holdings[ci].classification || { mode: 'static' };
      if (cclas.mode === 'cash') continue;   // emitted once as the aggregate cash row
      var crow = {
        index: ci,
        mode: cclas.mode || 'static',
        key: (cclas.key != null) ? cclas.key : null,
        coverageContribution: +(_dxCov[ci] / _gn).toFixed(4),
        missingContribution:  +(_dxMiss[ci] / _gn).toFixed(4),
        everUncovered: !!_dxUncov[ci],
        feedEmpty: false, firstPriceTs: null, lastPriceTs: null, feedStatus: 'static-covered'
      };
      if (cclas.mode === 'market') {
        var feed = priceByKey[cclas.key];
        var hasFeed = _asArray(feed).length > 0;
        crow.feedEmpty = !hasFeed;
        crow.firstPriceTs = hasFeed ? feed[0].t : null;
        crow.lastPriceTs = hasFeed ? feed[feed.length - 1].t : null;
        crow.feedStatus = !hasFeed ? 'empty-feed'
          : ((crow.firstPriceTs > _gridStart || _dxUncov[ci]) ? 'leading-edge-gap' : 'ok');
      }
      coverageByAsset.push(crow);
    }
    if (cashBaseAt) {
      coverageByAsset.push({
        index: -1, mode: 'cash', key: null,
        coverageContribution: +(_dxCashCov / _gn).toFixed(4),
        missingContribution: 0, everUncovered: false,
        feedEmpty: false, firstPriceTs: null, lastPriceTs: null, feedStatus: 'cash-covered'
      });
    }

    return {
      series: series,
      meta: {
        range: o.range || null,
        granularity: o.granularity || null,
        baseCurrency: o.baseCurrency || null,
        asOf: _num(o.asOf, 0) || null,           // caller stamps the time (engine is deterministic)
        pointCount: series.length,
        coverage: +avgCoverage.toFixed(3),
        confidence: overallConf,
        fxApproximated: !!o.fxApproximated,
        anchored: _isFiniteNum(o.nowValue),
        firstValue: first,
        lastValue: last,
        deltaAbs: (_isFiniteNum(first) && _isFiniteNum(last)) ? +(last - first).toFixed(2) : null,
        deltaPct: (_isFiniteNum(first) && first > 0 && _isFiniteNum(last)) ? +(((last - first) / first) * 100).toFixed(4) : null,
        source: 'reconstructed',
        coverageByAsset: coverageByAsset   // SPEC 4.1D — read-only diagnostic
      },
      // Reserved for fullscreen / advanced analysis (Fase posterior; vacíos hoy).
      overlays: [],
      annotations: []
    };
  }

  /* ── Self-test (deterministic; runnable under node) ─────────────────────────
     `node services/portfolio-chart-engine.js` → PASS/FAIL, exit 1 on failure.   */
  function selfTest() {
    var R = [], ok = true;
    function check(name, cond) { R.push({ name: name, pass: !!cond }); if (!cond) ok = false; }

    // grid: bounded + ends at now + ascending
    var now = 1700000000000;
    var g = buildGrid({ range: '24h', granularity: 'intraday', now: now });
    check('grid non-empty', g.length > 1);
    check('grid capped', g.length <= MAX_GRID_POINTS + 1);
    check('grid ends at now', g[g.length - 1] === now);
    check('grid ascending', g.every(function (t, i) { return i === 0 || t > g[i - 1]; }));

    // quantity timeline: buy 2 @ t1, buy 3 @ t2, sell 1 @ t3
    var qt = buildQuantityTimeline([
      { type: 'buy', qty: 2, price: 10, ts: 100 },
      { type: 'buy', qty: 3, price: 12, ts: 200 },
      { type: 'sell', qty: 1, price: 15, ts: 300 }
    ]);
    check('qty before first = 0', qt.at(50) === 0);
    check('qty after first buy = 2', qt.at(150) === 2);
    check('qty after second buy = 5', qt.at(250) === 5);
    check('qty after sell = 4', qt.at(350) === 4);

    // cash timeline: +1000, -400
    var ct = buildCashTimeline([
      { type: 'deposit', amount: 1000, currency: 'EUR', ts: 100 },
      { type: 'withdrawal', amount: 400, currency: 'EUR', ts: 200 }
    ]);
    check('cash before = 0', ct.balanceAt(50, 'EUR') === 0);
    check('cash mid = 1000', ct.balanceAt(150, 'EUR') === 1000);
    check('cash after = 600', ct.balanceAt(250, 'EUR') === 600);

    // linear sampling between real samples
    var s = [{ t: 0, v: 100 }, { t: 10, v: 200 }];
    check('sample no extrapolation before first', sampleSeriesAt(s, -5, 'linear') === null);
    check('sample linear midpoint', sampleSeriesAt(s, 5, 'linear') === 150);
    check('sample holds last beyond end', sampleSeriesAt(s, 99, 'linear') === 200);
    check('sample step', sampleSeriesAt(s, 7, 'step') === 100);

    // composition: 1 market holding (qty 2 from t=100), price 100→110 over grid
    var grid = [100, 150, 200];
    var comp = composeNetWorth({
      grid: grid,
      range: '24h', granularity: 'intraday', baseCurrency: 'USD', asOf: 200,
      holdings: [{
        asset: { type: 'stock', ticker: 'AAPL' },
        classification: { mode: 'market', provider: 'yahoo', key: 'AAPL' },
        qtyTimeline: buildQuantityTimeline([{ type: 'buy', qty: 2, price: 100, ts: 100 }]),
        currentValue: 220
      }],
      priceByKey: { AAPL: [{ t: 100, v: 100 }, { t: 200, v: 110 }] }
    });
    check('compose point count', comp.series.length === 3);
    check('compose t=100 value = 200', comp.series[0].v === 200);
    check('compose t=150 value = 210 (linear 105×2)', comp.series[1].v === 210);
    check('compose t=200 value = 220', comp.series[2].v === 220);
    check('compose complete confidence', comp.meta.confidence === CONFIDENCE.COMPLETE);
    check('compose deltaPct = 10', comp.meta.deltaPct === 10);
    check('output has reserved overlays/annotations', Array.isArray(comp.overlays) && Array.isArray(comp.annotations));

    // anchor: final point forced to live total
    var comp2 = composeNetWorth({
      grid: [100, 200], range: '24h',
      holdings: [{ asset: { type: 'stock', ticker: 'X' }, classification: { mode: 'market', key: 'X' },
        qtyTimeline: buildQuantityTimeline([{ type: 'buy', qty: 1, price: 50, ts: 100 }]), currentValue: 70 }],
      priceByKey: { X: [{ t: 100, v: 50 }, { t: 200, v: 60 }] },
      nowValue: 999
    });
    check('anchor overrides last point', comp2.series[comp2.series.length - 1].v === 999 && comp2.meta.anchored === true);

    // static holding → partial confidence, no invented movement
    var comp3 = composeNetWorth({
      grid: [100, 200], range: '30d',
      holdings: [{ asset: { type: 'real_estate' }, classification: { mode: 'static' }, currentValue: 300000 }]
    });
    check('static flat both points', comp3.series[0].v === 300000 && comp3.series[1].v === 300000);
    check('static → partial', comp3.meta.confidence === CONFIDENCE.PARTIAL);

    // AMENDMENT (Fase A.1) — base-currency contract + per-currency cash aggregation.
    // buildCashBaseAt: EUR 1000 (base) + USD 500 × 0.9 = 1450 (no double count).
    var cashTl2 = buildCashTimeline([
      { type: 'deposit', amount: 1000, currency: 'EUR', ts: 100 },
      { type: 'deposit', amount: 500,  currency: 'USD', ts: 100 }
    ]);
    var cashBaseAt = buildCashBaseAt(cashTl2, { USD: 0.9 }, 'EUR');
    check('cashBaseAt aggregates per-currency to base', cashBaseAt(150) === 1450);

    // compose with aggregate cash: market 200 (1×@200 base) + cash 1450 = 1650.
    var comp4 = composeNetWorth({
      grid: [100, 200], range: '24h', baseCurrency: 'EUR',
      holdings: [{ asset: { type: 'stock', ticker: 'X' }, classification: { mode: 'market', key: 'X' },
        qtyTimeline: buildQuantityTimeline([{ type: 'buy', qty: 1, price: 180, ts: 100 }]) }],
      priceByKey: { X: [{ t: 100, v: 180 }, { t: 200, v: 200 }] },
      cashBaseAt: cashBaseAt
    });
    check('compose adds aggregate cash once', comp4.series[comp4.series.length - 1].v === 1650);

    // no double count: passing extra 'cash' holdings must NOT add cash twice.
    var comp5 = composeNetWorth({
      grid: [100, 200], range: '24h', baseCurrency: 'EUR',
      holdings: [
        { asset: { type: 'cash', assetCurrency: 'EUR' }, classification: { mode: 'cash' } },
        { asset: { type: 'cash', assetCurrency: 'EUR' }, classification: { mode: 'cash' } }
      ],
      cashBaseAt: function () { return 1450; }
    });
    check('cash holdings ignored → no double count', comp5.series[0].v === 1450 && comp5.series[1].v === 1450);

    // fxApproximated caps confidence at partial even when fully covered.
    var comp6 = composeNetWorth({
      grid: [100, 200], range: '24h',
      holdings: [{ asset: { type: 'stock', ticker: 'Y' }, classification: { mode: 'market', key: 'Y' },
        qtyTimeline: buildQuantityTimeline([{ type: 'buy', qty: 1, price: 10, ts: 100 }]) }],
      priceByKey: { Y: [{ t: 100, v: 10 }, { t: 200, v: 11 }] },
      fxApproximated: true
    });
    check('fxApproximated caps confidence at partial', comp6.meta.confidence === CONFIDENCE.PARTIAL && comp6.meta.fxApproximated === true);

    try {
      console.log('%c[AurixPCE] self-test ' + (ok ? 'PASS' : 'FAIL'),
        'color:' + (ok ? '#27c768' : '#e0664a') + ';font-weight:700',
        R.filter(function (r) { return !r.pass; }));
    } catch (_) {
      // node console (no CSS)
      console.log('[AurixPCE] self-test ' + (ok ? 'PASS' : 'FAIL'));
      if (!ok) console.log(R.filter(function (r) { return !r.pass; }));
    }
    return { pass: ok, results: R };
  }

  /* ── Public namespace (frozen; pure functions only) ─────────────────────── */
  global.AurixPortfolioEngine = Object.freeze({
    version: 1,
    CONFIDENCE: CONFIDENCE,
    GRANULARITY: GRANULARITY.slice(),
    DEFAULT_GRANULARITY: DEFAULT_GRANULARITY,
    buildGrid: buildGrid,
    buildQuantityTimeline: buildQuantityTimeline,
    buildCashTimeline: buildCashTimeline,
    buildCashBaseAt: buildCashBaseAt,
    sampleSeriesAt: sampleSeriesAt,
    classifyConfidence: classifyConfidence,
    composeNetWorth: composeNetWorth,
    defaultResolveHolding: defaultResolveHolding,   // self-test / fallback only
    selfTest: selfTest
  });

  // Node: run the self-test ONLY when executed directly (`node <file>`), never
  // when required by another module (avoids side effects on import). Browser:
  // never auto-runs (and in this phase the file is not even loaded).
  if (typeof window === 'undefined' && typeof process !== 'undefined' &&
      typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    var r = selfTest();
    if (!r.pass && typeof process.exit === 'function') process.exit(1);
  }

})(typeof window !== 'undefined' ? window : this);
