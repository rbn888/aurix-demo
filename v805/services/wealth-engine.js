/* ============================================================================
   services/wealth-engine.js — AURIX-WEALTH-ENGINE-1 (Step 1)

   Pure, deterministic FAÇADE over the financial primitives already defined in
   app.js. It introduces a single cohesive contract for derived wealth data and
   will progressively become the official producer of DERIVED_FINANCIAL_STATE.

   STEP 1 SCOPE (this file):
     - Read-only façade. NO formula changes, NO UI migration, NO DERIVED_*
       correction, NO chart/history/prices/auth touched.
     - Exposes exactly ONE global namespace: window.wealthEngine.
     - Dev-only self-test (gated by IS_DEV) proving parity vs the legacy
       functions and the per-asset-type rules.

   CANONICAL CURRENCY = USD. Every result also carries `base` = toBase(usd,'USD').

   D1 (approved): "capital aportado" v1 = COST OF CURRENTLY OPEN POSITIONS
   (sum of costBasis, cash + real_estate excluded). This is NOT lifetime net
   contributions — that concept is reserved for AURIX-WEALTH-EVOLUTION-1.
   UI wording allowed: "Coste de posiciones" / "Capital invertido actual".
   NOT allowed yet: "Capital aportado histórico" / "Dinero aportado total".

   KNOWN, DOCUMENTED (not fixed here): DERIVED_FINANCIAL_STATE.totalCostBasis
   sums costBasis raw (currency-naive); the currency-correct basis is
   totalCostBasisBase(). The engine adopts the currency-correct semantics. The
   DERIVED_* correction is a later, signalled, validated step (it can move
   displayed PnL for users with non-USD cost basis).

   Loads AFTER app.js, so app.js's globals are already initialised; everything
   is resolved lazily + typeof-guarded so a missing dependency degrades to a
   neutral value instead of throwing.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ── Dependency resolvers (late-bound, defensive) ───────────────────────── */
  // AURIX-CLOSED-POSITIONS-1: closed positions (fully sold, qty 0) stay in the
  // global `assets` array for historical analysis but must NOT affect the live
  // figures. _assets() therefore returns ACTIVE positions only — i.e. the
  // engine defaults to includeClosed = false for every calculation that reads
  // it (net worth, allocation, contributions, gain/loss). A future analysis
  // surface can pass the full array explicitly (the engine functions accept a
  // `list` param) to opt into includeClosed = true.
  function _isClosed(a) { return !!a && a.lifecycleStatus === 'closed'; }
  function _allAssets() { try { return (typeof assets !== 'undefined' && Array.isArray(assets)) ? assets : []; } catch (_) { return []; } }
  function _assets()    { return _allAssets().filter(a => !_isClosed(a)); }
  function _baseCcy()  { try { return (typeof baseCurrency !== 'undefined' && baseCurrency) ? baseCurrency : 'USD'; } catch (_) { return 'USD'; } }
  function _fx()       { try { return (typeof usdToEur !== 'undefined' && usdToEur) ? usdToEur : 1; } catch (_) { return 1; } }
  function _meta()     { try { return (typeof TYPE_META !== 'undefined' && TYPE_META) ? TYPE_META : {}; } catch (_) { return {}; } }
  function _valUSD(a)  { try { return (typeof assetValueUSD === 'function') ? (Number(assetValueUSD(a)) || 0) : 0; } catch (_) { return 0; } }

  // Convert an amount in `cur` to the base currency (mirrors app.js toBase).
  function _toBase(usd) {
    try { return (typeof toBase === 'function') ? toBase(usd, 'USD') : usd; } catch (_) { return usd; }
  }
  // Convert an amount in its own currency to USD (mirrors assetValueUSD's logic).
  // AURIX-DATA-001 (F2-cost) — multi-FX. USD/EUR byte-identical (EUR via _fx());
  // GBP/CHF/JPY via the app FX engine (_aurixFxRate, USD per unit); unknown
  // currency → NaN (uncovered, never assume EUR).
  function _toUSD(amount, cur) {
    var c = String(cur || 'USD').toUpperCase();
    if (c === 'USD') return amount;
    if (c === 'EUR') return amount / _fx();
    try { if (typeof _aurixFxRate === 'function') { var r = _aurixFxRate(c); if (Number.isFinite(r)) return amount * r; } } catch (_) {}
    return NaN;
  }

  // Asset-type rules. Cash + real estate are excluded from cost basis / PnL.
  function _isInvested(a) { return !!a && a.type !== 'cash' && a.type !== 'real_estate'; }
  function _costUSD(a)    { return _toUSD(Number(a.costBasis || 0), a.assetCurrency || 'USD'); }

  function _now() { try { return Date.now(); } catch (_) { return 0; } }

  /* ── 1. Net worth ───────────────────────────────────────────────────────── */
  function calculateNetWorth(list) {
    const arr = Array.isArray(list) ? list : _assets();
    let usd = 0;
    for (const a of arr) usd += _valUSD(a);
    return { usd, base: _toBase(usd), currency: _baseCcy(), assetCount: arr.length, computedAt: _now() };
  }

  /* ── 2. Contributions = cost of open positions (D1·a) ───────────────────── */
  function calculateContributions(list) {
    const arr = Array.isArray(list) ? list : _assets();
    let usd = 0, covered = 0;
    for (const a of arr) {
      if (!_isInvested(a)) continue;             // cash + real_estate excluded
      const cb = Number(a.costBasis || 0);
      if (cb > 0) { usd += _costUSD(a); covered++; }
    }
    return { usd, base: _toBase(usd), currency: _baseCcy(), coveredAssetCount: covered, semantics: 'open-positions-cost' };
  }

  /* ── 3. Gain / loss ─────────────────────────────────────────────────────── */
  function calculateGainLoss(list) {
    const arr = Array.isArray(list) ? list : _assets();
    let unreal = 0, real = 0;
    for (const a of arr) {
      if (_isInvested(a) && Number(a.costBasis || 0) > 0) {
        unreal += _valUSD(a) - _costUSD(a);      // mark-to-market on open positions
      }
      const r = Number(a.realizedPnL || 0);
      if (r) real += _toUSD(r, a.assetCurrency || 'USD');
    }
    const total = unreal + real;
    return {
      unrealized: { usd: unreal, base: _toBase(unreal) },
      realized:   { usd: real,   base: _toBase(real) },
      total:      { usd: total,  base: _toBase(total) },
      currency: _baseCcy(),
      basis: 'open-positions-cost',
    };
  }

  /* ── 4. Return % (cost basis) ───────────────────────────────────────────── */
  function calculateReturnPercent(list) {
    const arr = Array.isArray(list) ? list : _assets();
    const contrib = calculateContributions(arr).usd;
    const gain    = calculateGainLoss(arr).total.usd;
    return {
      byCost: contrib > 0 ? (gain / contrib) * 100 : null,
      currency: _baseCcy(),
      note: 'cost-basis return; the time-window return is owned by the chart pipeline (computeRangePnL).',
    };
  }

  /* ── 5. Allocation ──────────────────────────────────────────────────────── */
  function calculateAllocation(list, opts) {
    opts = opts || {};
    const by  = opts.by || 'category';
    const arr = Array.isArray(list) ? list : _assets();

    let total = 0;
    for (const a of arr) total += _valUSD(a);

    let items = [];
    if (by === 'location') {
      items = []; // reserved for AURIX-WEALTH-LOCATION (Fase 2)
    } else if (by === 'asset') {
      for (const a of arr) {
        const v = _valUSD(a);
        if (v > 0) items.push({ key: String(a.ticker || a.symbol || '').toUpperCase(), label: a.name || a.ticker || a.symbol || '', usd: v });
      }
    } else { // 'category'
      const meta = _meta();
      const buckets = {};
      for (const a of arr) {
        const v = _valUSD(a);
        if (v <= 0) continue;
        const t = (a.type && meta[a.type]) ? a.type : 'other';
        buckets[t] = (buckets[t] || 0) + v;
      }
      for (const t in buckets) {
        if (!Object.prototype.hasOwnProperty.call(buckets, t)) continue;
        items.push({ key: t, label: (meta[t] && meta[t].label) || t, color: meta[t] && meta[t].color, usd: buckets[t] });
      }
    }

    for (const it of items) { it.base = _toBase(it.usd); it.pct = total > 0 ? (it.usd / total) * 100 : 0; }
    items.sort((a, b) => b.usd - a.usd);
    if (opts.topN) items = items.slice(0, opts.topN);

    return { by, total: { usd: total, base: _toBase(total) }, items };
  }

  /* ── Aggregate snapshot ─────────────────────────────────────────────────── */
  function computeSnapshot(list) {
    const arr = Array.isArray(list) ? list : _assets();
    return {
      netWorth:      calculateNetWorth(arr),
      contributions: calculateContributions(arr),
      gainLoss:      calculateGainLoss(arr),
      returnPercent: calculateReturnPercent(arr),
      allocation:    calculateAllocation(arr, { by: 'category' }),
      version: 1,
      computedAt: _now(),
    };
  }

  /* ── Per-asset position (AURIX-ASSET-DETAIL-1, Fase A) ──────────────────── */
  function _findById(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i]; return null; }
  function _effType(a, meta) { return (a.type && meta[a.type]) ? a.type : 'other'; }

  // Everything the asset-detail screen needs, computed here (the screen only
  // consumes). Currency-correct (USD canonical + base). Unknown/ineligible
  // figures are null so the UI can render "—" instead of fabricating.
  function getPosition(assetId, list) {
    var arr = Array.isArray(list) ? list : _assets();
    var a = _findById(arr, assetId);
    if (!a) return null;
    var meta = _meta();
    var cur = String(a.assetCurrency || 'USD').toUpperCase();
    var valueUSD = _valUSD(a);
    var qty = Number(a.qty || 0);
    var invested = _isInvested(a) && Number(a.costBasis || 0) > 0;
    var costUSD = invested ? _toUSD(Number(a.costBasis || 0), cur) : 0;
    var avgUSD = (invested && qty > 0) ? costUSD / qty : null;
    var curUnitUSD = qty > 0 ? valueUSD / qty : null;
    var glUSD = invested ? valueUSD - costUSD : null;
    var glPct = (invested && costUSD > 0) ? (glUSD / costUSD) * 100 : null;
    var myType = _effType(a, meta);
    var catUSD = 0;
    for (var i = 0; i < arr.length; i++) { var v = _valUSD(arr[i]); if (v > 0 && _effType(arr[i], meta) === myType) catUSD += v; }
    var weightCat = catUSD > 0 ? (valueUSD / catUSD) * 100 : null;
    var realizedUSD = _toUSD(Number(a.realizedPnL || 0), cur);
    var pair = function (usd) { return { usd: usd, base: _toBase(usd) }; };
    return {
      assetId: a.id, ticker: a.ticker, name: a.name, type: a.type,
      category: { key: myType, label: (meta[myType] && meta[myType].label) || myType },
      currency: _baseCcy(),
      value: pair(valueUSD),
      quantity: qty,
      avgBuyPrice:  avgUSD == null ? null : pair(avgUSD),
      currentPrice: curUnitUSD == null ? null : pair(curUnitUSD),
      gainLoss:     glUSD == null ? null : { abs: pair(glUSD), pct: glPct },
      realized:     pair(realizedUSD),
      weightInCategory: weightCat,
      isInvested: invested,
      computedAt: _now(),
    };
  }

  // Up to 3 deterministic, structured insights (kind + numbers). The UI maps
  // each kind to localized copy — no inference, no fabrication. Honest "—"
  // becomes the 'insufficient' kind when nothing reliable exists.
  function positionInsights(assetId, list) {
    var p = getPosition(assetId, list);
    if (!p) return [];
    var out = [];
    if (p.isInvested && p.avgBuyPrice && p.currentPrice && p.gainLoss) {
      out.push({ kind: 'costVsMarket', ticker: p.ticker, avgBase: p.avgBuyPrice.base, currentBase: p.currentPrice.base,
                 pct: Math.abs(p.gainLoss.pct || 0), dir: (p.gainLoss.abs.usd >= 0 ? 'above' : 'below') });
    }
    if (p.realized && p.realized.usd > 0.005) {
      out.push({ kind: 'realized', name: p.name || p.ticker, amountBase: p.realized.base });
    }
    if (p.weightInCategory != null) {
      out.push({ kind: 'weightCategory', ticker: p.ticker, category: p.category.label, pct: p.weightInCategory });
    }
    return out.length ? out.slice(0, 3) : [{ kind: 'insufficient' }];
  }

  /* ── Dev-only parity self-test ──────────────────────────────────────────── */
  function _approx(a, b, tol) { return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= (tol == null ? 0.01 : tol); }

  function selfTest() {
    const R = [];
    const ok = (name, cond, extra) => R.push(Object.assign({ test: name, pass: !!cond }, extra || {}));

    // Live parity vs legacy functions (only when there is a real portfolio).
    try {
      const live = _assets();
      if (live.length) {
        if (typeof totalValueBase === 'function')
          ok('netWorth.base == totalValueBase()', _approx(calculateNetWorth().base, totalValueBase()));
        if (typeof totalCostBasisBase === 'function')
          ok('contributions.base == totalCostBasisBase()', _approx(calculateContributions().base, totalCostBasisBase()));
        if (typeof computeRangePnL === 'function') {
          const pnl = computeRangePnL('all');
          if (pnl) ok('netWorth-contrib == computeRangePnL(all).abs',
            _approx(calculateNetWorth().base - calculateContributions().base, pnl.abs, 0.5));
        }
        if (typeof buildPortfolioAllocations === 'function' && typeof totalValueUSD === 'function') {
          const legacy = buildPortfolioAllocations(live, totalValueUSD());
          const mine   = calculateAllocation(live, { by: 'asset' });
          ok('allocation(asset) count == buildPortfolioAllocations', legacy.length === mine.items.length);
        }
        if (typeof _donutDist !== 'undefined' && Array.isArray(_donutDist) && _donutDist.length) {
          const alloc = calculateAllocation(live, { by: 'category' });
          let match = true;
          for (const d of _donutDist) {
            const it = alloc.items.find(x => x.key === d.type);
            if (!it || !_approx(it.base, d.valueBase, 0.5)) { match = false; break; }
          }
          ok('allocation(category) == _donutDist', match);
        }
      } else {
        ok('live parity skipped (empty portfolio)', true, { skipped: true });
      }
    } catch (e) { ok('live parity threw', false, { error: e && e.message }); }

    // Synthetic fixture: per-type rules + self-consistency (currency-correct).
    try {
      const fx = [
        { ticker: 'BTC',  type: 'crypto',      qty: 1,    price: 50000,  costBasis: 40000,  assetCurrency: 'USD' },
        { ticker: 'AAPL', type: 'stock',       qty: 10,   price: 200,    costBasis: 1500,   assetCurrency: 'USD' },
        { ticker: 'EURX', type: 'stock',       qty: 10,   price: 100,    costBasis: 800,    assetCurrency: 'EUR' },
        { ticker: 'CASH', type: 'cash',        qty: 1000, price: 1,      costBasis: 1000,   assetCurrency: 'EUR' },
        { ticker: 'FLAT', type: 'real_estate', qty: 1,    price: 200000, costBasis: 180000, assetCurrency: 'EUR' },
        { ticker: 'XAU',  type: 'metal',       qty: 100,  price: 2,      costBasis: 150,    assetCurrency: 'USD' },
      ];
      const contrib = calculateContributions(fx);
      ok('fixture: contributions exclude cash + real_estate (covered=4)', contrib.coveredAssetCount === 4);
      const gl = calculateGainLoss(fx);
      ok('fixture: total == unrealized + realized', _approx(gl.total.usd, gl.unrealized.usd + gl.realized.usd));
      const cat = calculateAllocation(fx, { by: 'category' });
      ok('fixture: category pct sums ~100', _approx(cat.items.reduce((s, i) => s + i.pct, 0), 100, 0.1));
      ok('fixture: allocation(location) empty (Fase 2)', calculateAllocation(fx, { by: 'location' }).items.length === 0);
      ok('fixture: returnPercent.byCost is finite', Number.isFinite(calculateReturnPercent(fx).byCost));
    } catch (e) { ok('fixture threw', false, { error: e && e.message }); }

    const pass = R.every(r => r.pass);
    try {
      console.log('%c[wealthEngine] self-test ' + (pass ? 'PASS' : 'FAIL'),
        'color:' + (pass ? '#27c768' : '#e0664a') + ';font-weight:700', R);
    } catch (_) {}
    return { pass, results: R };
  }

  /* ── Single public namespace ────────────────────────────────────────────── */
  global.wealthEngine = {
    version: 1,
    calculateNetWorth,
    calculateContributions,
    calculateGainLoss,
    calculateReturnPercent,
    calculateAllocation,
    computeSnapshot,
    getPosition,
    positionInsights,
    selfTest,
    // AURIX-CLOSED-POSITIONS-1: read accessors. activeAssets() is the default
    // input for every calculation above (includeClosed = false). allAssets()
    // exposes the full set incl. closed positions, so a future historical
    // surface can call e.g. calculateGainLoss(wealthEngine.allAssets()) to opt
    // into includeClosed = true without changing the engine's defaults.
    activeAssets: _assets,
    allAssets:    _allAssets,
    // AURIX-PORTFOLIO-CHART-CASHFLOW-AWARE-1: cashflow-aware evolution math.
    // The pure implementations live in wealthLedger (the source of truth for
    // capital flows + base-currency conversion); the engine exposes them so
    // callers have one math namespace. Late-bound because the ledger script
    // loads after the engine. Returns null if the ledger isn't present.
    buildEvolutionSeries: function (portfolioHistory, events) {
      var L = (typeof window !== 'undefined') ? window.wealthLedger : null;
      return (L && typeof L.buildEvolutionSeries === 'function') ? L.buildEvolutionSeries(portfolioHistory, events) : null;
    },
    buildCashflowSeries: function (events) {
      var L = (typeof window !== 'undefined') ? window.wealthLedger : null;
      return (L && typeof L.buildCashflowSeries === 'function') ? L.buildCashflowSeries(events) : null;
    },
    calculateNetContributionsAt: function (events, ts) {
      var L = (typeof window !== 'undefined') ? window.wealthLedger : null;
      return (L && typeof L.calculateNetContributionsAt === 'function') ? L.calculateNetContributionsAt(events, ts) : null;
    },
  };

  // Auto-run the self-test once in dev. Note: at load the portfolio is usually
  // still empty (loads after auth), so live parity will show "skipped"; the
  // synthetic-fixture checks always run. Re-run wealthEngine.selfTest() in the
  // console after the portfolio has loaded for full live parity.
  try {
    var _dev = (typeof IS_DEV !== 'undefined') && IS_DEV;
    if (_dev) {
      if (typeof document !== 'undefined' && document.readyState !== 'complete') {
        global.addEventListener('load', function () { try { global.wealthEngine.selfTest(); } catch (_) {} });
      } else {
        global.wealthEngine.selfTest();
      }
    }
  } catch (_) {}

})(typeof window !== 'undefined' ? window : this);
