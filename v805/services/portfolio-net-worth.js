/* ============================================================================
   services/portfolio-net-worth.js — AURIX-PORTFOLIO-CHART-ENGINE-1 · Fase C

   THE RECONSTRUCTION ORCHESTRATOR. `buildNetWorthSeries()` ties together the
   pure math+time core (Fase A / A.1), the price layer (Fase B), the existing
   per-asset transactions and the wealth-ledger cash events to produce a REAL
   reconstructed net-worth series:

       netWorth(t) = Σ qtyᵢ(t)·precioᵢ(t)·fx(divisaᵢ→base) + cash(t)

   on the DEFINITIVE base-currency contract (A.1): every input is converted to
   the base currency HERE, before composition; the engine itself never does FX
   and never assumes any currency.

   FASE C SCOPE — the orchestrator only. This file:
     • is COMPLETELY DORMANT: NOT loaded by index.html, nothing calls it, no
       network request is issued → Aurix's visible behaviour is unchanged;
     • does NO rendering and touches NO surface (Dashboard/Category/Workspace/
       Wealth Evolution), aurix-chart-core, snapshots, Supabase or persistence;
     • injects ALL its dependencies (engine, price layer, fetcher, fx, resolver,
       current values, cash events) → decoupled from app.js and node-testable.
       In integration the real ones are injected (AurixChartAdapters fetcher,
       _aurixAssetPickAdapter resolver, usdToEur fx, assetValueUSD→base values).

   FIDELITY RULES (enforced here): convert per asset by its quote currency before
   composing; aggregate cash per currency ONCE; never fabricate, never smooth,
   never interpolate outside coverage, never invent historical FX. When a
   conversion uses a current (non-historical) rate, mark fxApproximated → the
   engine caps confidence at 'partial'. When coverage is too low → 'insufficient'.
   ============================================================================ */
(function (global) {
  'use strict';

  function _isFiniteNum(x) { return typeof x === 'number' && isFinite(x); }

  // Resolve the engine + price layer (injected, else the browser globals).
  function _engine(o) { return o.engine || global.AurixPortfolioEngine || null; }
  function _priceLayer(o) { return o.priceLayer || global.AurixPriceLayer || null; }

  function _insufficient(meta) {
    return {
      series: [],
      meta: Object.assign({
        pointCount: 0, coverage: 0, confidence: 'insufficient',
        fxApproximated: false, anchored: false, source: 'reconstructed'
      }, meta || {}),
      overlays: [],
      annotations: []
    };
  }

  /* ── buildNetWorthSeries — the PCE entry point (generic, async) ─────────────
     opts:
       assets         : arbitrary list of asset objects (full portfolio OR a
                        filtered subset — Dashboard / Category / Workspace / WE)
       range, granularity, now, asOf, signal, baseCurrency
       engine         : AurixPortfolioEngine (default: window global)
       priceLayer     : AurixPriceLayer       (default: window global)
       fetcher        : price fetcher          (default: priceLayer.makeAdapterFetcher())
       resolveHolding : asset → {mode,provider?,key?} (default: engine.defaultResolveHolding)
       transactionsOf : asset → transactions[] (default: a.transactions)
       cashEvents     : wealth-ledger events array (deposit/withdrawal/opening/...)
       currentValueOf : asset → BASE value (live) — static value + market fallback
       fxToBase       : (currency) → factor to base | null (unknown). Current rate
                        in v1 → any non-base conversion ⇒ fxApproximated. (default:
                        ccy===base ? 1 : null)
       nowValue       : live total (BASE) to anchor ONLY the last point
       concurrency    : price fan-out cap
     Returns: Promise< { series, meta, overlays, annotations } >  (engine envelope)  */
  // SPEC 4.1H — Last Known Price carry-forward (forward-fill ONLY). Robustness
  // for transient feed gaps: within an ALREADY-FETCHED historical market series,
  // hold the last VALID price across null/missing points. Hard rules:
  //   • forward-fill only — leading nulls (before any real price) stay null (NO backfill)
  //   • step, never interpolate (carried value = exact last real price)
  //   • requires ≥1 real point — a fully empty/all-null series stays as-is (NO fabrication)
  //   • operates on the {t,v} price series; never touches live pricing / valuation / engine math
  // Returns { series, carried } where `carried` = number of points filled.
  function _carryForwardSeries(series) {
    var arr = Array.isArray(series) ? series : [];
    var hasValid = false;
    for (var i = 0; i < arr.length; i++) { if (arr[i] && _isFiniteNum(arr[i].v)) { hasValid = true; break; } }
    if (!hasValid) return { series: arr, carried: 0 };   // empty / all-null → unchanged (no fabrication)
    var out = new Array(arr.length);
    var last = null, carried = 0;
    for (var j = 0; j < arr.length; j++) {
      var p = arr[j];
      if (p && _isFiniteNum(p.v)) { last = p.v; out[j] = p; }
      else if (last !== null) { out[j] = { t: (p && p.t), v: last, _carriedForward: true }; carried++; }
      else { out[j] = p; }   // leading gap before any real price → keep (no backfill)
    }
    return { series: out, carried: carried };
  }

  async function buildNetWorthSeries(opts) {
    var o = opts || {};
    var engine = _engine(o);
    var priceLayer = _priceLayer(o);
    if (!engine || !priceLayer) return _insufficient({ reason: 'engine-unavailable' });

    var base = String(o.baseCurrency || 'USD').toUpperCase();
    var range = o.range || '24h';
    var assets = Array.isArray(o.assets) ? o.assets : [];
    var resolveHolding = (typeof o.resolveHolding === 'function') ? o.resolveHolding : engine.defaultResolveHolding;
    var transactionsOf = (typeof o.transactionsOf === 'function') ? o.transactionsOf : function (a) { return a && a.transactions; };
    var currentValueOf = (typeof o.currentValueOf === 'function') ? o.currentValueOf : function () { return 0; };
    var fxToBase = (typeof o.fxToBase === 'function') ? o.fxToBase : function (ccy) { return (String(ccy).toUpperCase() === base) ? 1 : null; };
    var fetcher = o.fetcher || (priceLayer.makeAdapterFetcher && priceLayer.makeAdapterFetcher());

    // 1. Temporal grid (multi-resolution, bounded, ends at now).
    if (!assets.length) return _insufficient({ range: range, reason: 'no-assets' });

    var grid = engine.buildGrid({ range: range, granularity: o.granularity, now: o.now, firstTs: o.firstTs });
    if (!Array.isArray(grid) || grid.length < 2) return _insufficient({ range: range, reason: 'no-grid' });

    // 2. Classify holdings + collect price requests (dedup happens in the layer).
    var holdings = [];
    var requests = [];
    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var cls = resolveHolding(asset) || { mode: 'static' };
      if (cls.mode === 'market') {
        holdings.push({
          asset: asset,
          classification: cls,
          qtyTimeline: engine.buildQuantityTimeline(transactionsOf(asset)),
          currentValue: currentValueOf(asset)
        });
        if (cls.key != null) requests.push({ provider: cls.provider, key: cls.key, range: range });
      } else if (cls.mode === 'cash') {
        holdings.push({ asset: asset, classification: { mode: 'cash' } });  // ignored in compose; cash via cashBaseAt
      } else {
        holdings.push({ asset: asset, classification: { mode: 'static' }, currentValue: currentValueOf(asset) });
      }
    }

    var fxApproximated = false;
    var _fxDropped = {};   // SPEC 4.1D diagnostic — keys dropped for unknown FX

    // 3. Fetch price series (Fase B: dedup + concurrency + error isolation),
    //    then CONVERT each series to base by its OWN quote currency.
    var priceByKey = {};
    if (requests.length) {
      var priceRes = await priceLayer.fetchMany({
        requests: requests, fetcher: fetcher, range: range,
        now: o.now, signal: o.signal, concurrency: o.concurrency
      });
      var byKey = priceRes && priceRes.byKey || {};
      for (var k in byKey) {
        if (!Object.prototype.hasOwnProperty.call(byKey, k)) continue;
        var entry = byKey[k];
        var ccy = String(entry.currency || 'USD').toUpperCase();
        var factor = (ccy === base) ? 1 : fxToBase(ccy);
        if (!_isFiniteNum(factor)) { priceByKey[k] = []; _fxDropped[k] = ccy; continue; }   // unknown FX → uncovered, never guess
        if (factor !== 1) fxApproximated = true;                       // current-rate conversion → approximate
        var src = Array.isArray(entry.series) ? entry.series : [];
        if (factor === 1) { priceByKey[k] = src; }
        else {
          var conv = new Array(src.length);
          for (var s = 0; s < src.length; s++) conv[s] = { t: src[s].t, v: src[s].v * factor };
          priceByKey[k] = conv;
        }
      }
    }

    // 4. Cash: aggregate per currency ONCE, converted to base (no double count).
    var cashBaseAt = null;
    var cashEvents = Array.isArray(o.cashEvents) ? o.cashEvents : [];
    if (cashEvents.length) {
      var cashTl = engine.buildCashTimeline(cashEvents);
      var fxByCurrency = {};
      var ccys = cashTl.byCurrency ? Object.keys(cashTl.byCurrency) : [];
      for (var c = 0; c < ccys.length; c++) {
        var cc = ccys[c];
        if (cc === base) { fxByCurrency[cc] = 1; continue; }
        var f = fxToBase(cc);
        if (_isFiniteNum(f)) { fxByCurrency[cc] = f; fxApproximated = true; }
        // unknown FX currency → omitted by buildCashBaseAt (never guessed)
      }
      cashBaseAt = engine.buildCashBaseAt(cashTl, fxByCurrency, base);
    }

    // SPEC 4.1H — Last Known Price carry-forward over each market price series,
    // AFTER fetch and BEFORE compose. Dense feeds (CoinGecko/Yahoo) have no
    // internal nulls → usually a no-op; it only acts on genuinely gappy series.
    // Empty series and leading gaps are untouched (no fabrication / no backfill).
    var _cfByKey = {}, _cfTotal = 0, _cfAssets = 0;
    for (var pk in priceByKey) {
      if (!Object.prototype.hasOwnProperty.call(priceByKey, pk)) continue;
      var _cf = _carryForwardSeries(priceByKey[pk]);
      priceByKey[pk] = _cf.series;
      if (_cf.carried > 0) { _cfByKey[pk] = _cf.carried; _cfTotal += _cf.carried; _cfAssets++; }
    }

    // 5. Compose on the definitive base-currency contract.
    var result = engine.composeNetWorth({
      grid: grid,
      holdings: holdings,
      priceByKey: priceByKey,
      cashBaseAt: cashBaseAt,
      nowValue: o.nowValue,
      range: range,
      granularity: o.granularity,
      baseCurrency: base,
      asOf: o.asOf,
      fxApproximated: fxApproximated
    });

    // SPEC 4.1D — enrich the engine's read-only coverageByAsset with asset
    // identity, the currency, the FX-unsupported reason (known only here, not in
    // the pure engine), and current weight %. Purely additive metadata: it never
    // alters series/coverage/confidence/value.
    try {
      var cba = result && result.meta && result.meta.coverageByAsset;
      if (Array.isArray(cba) && cba.length) {
        var _tcv = 0;
        for (var ti = 0; ti < holdings.length; ti++) {
          var _hv = _num((holdings[ti] && holdings[ti].currentValue), NaN);
          if (!_isFiniteNum(_hv)) { try { _hv = _num(currentValueOf(holdings[ti] && holdings[ti].asset), 0); } catch (_) { _hv = 0; } }
          holdings[ti]._cv = _hv; _tcv += (_hv > 0 ? _hv : 0);
        }
        for (var ei = 0; ei < cba.length; ei++) {
          var er = cba[ei];
          var ha = (er.index >= 0 && holdings[er.index]) ? holdings[er.index].asset : null;
          if (ha) {
            // SPEC 4.1E — read-only identity fields so the founder overlay can
            // name the empty-feed rows (no more "?"). Purely diagnostic.
            er.assetId      = (ha.id != null) ? ha.id : (ha.assetId != null ? ha.assetId : null);
            er.coinId       = ha.coinId || null;
            er.ticker       = ha.ticker || null;
            er.marketSymbol = ha.marketSymbol || null;
            er.symbol   = ha.ticker || ha.symbol || ha.marketSymbol || null;
            er.name     = ha.name || null;
            er.type     = ha.type || null;
            er.currency = (ha.assetCurrency || ha.currency || null);
            var _cv = (er.index >= 0 && holdings[er.index]) ? holdings[er.index]._cv : 0;
            er.currentWeightPct = (_tcv > 0 && _isFiniteNum(_cv)) ? +((_cv / _tcv) * 100).toFixed(2) : null;
          }
          if (er.feedStatus === 'empty-feed' && er.key != null && _fxDropped[er.key]) {
            er.feedStatus = 'fx-unsupported';
            if (!er.currency) er.currency = _fxDropped[er.key];
          }
          // SPEC 4.1H — surface carry-forward per asset (read-only diagnostic).
          var _cfp = (er.key != null && _cfByKey[er.key]) ? _cfByKey[er.key] : 0;
          er.carriedForwardPoints = _cfp;
          if (_cfp > 0 && (er.feedStatus === 'ok' || er.feedStatus === 'leading-edge-gap')) er.feedStatus = 'carried-forward';
        }
      }
      // SPEC 4.1H — fleet-level CF telemetry + honest confidence: any carry-forward
      // means the series is not 100% live-measured → never report 'complete'.
      if (result && result.meta) {
        result.meta.carriedForwardPoints = _cfTotal;
        result.meta.carriedForwardAssets = _cfAssets;
        if (_cfTotal > 0 && result.meta.confidence === 'complete') result.meta.confidence = 'partial';
      }
    } catch (_) { /* diagnostic enrichment must never break the build */ }

    return result;
  }

  /* ── Self-test (deterministic; injects real engine + price layer + fakes) ─── */
  async function selfTest() {
    var R = [], ok = true;
    function check(name, cond) { R.push({ name: name, pass: !!cond }); if (!cond) ok = false; }

    var engine = (typeof require === 'function') ? require('./portfolio-chart-engine.js') : global.AurixPortfolioEngine;
    var priceLayer = (typeof require === 'function') ? require('./portfolio-price-layer.js') : global.AurixPriceLayer;
    if (engine && engine.AurixPortfolioEngine) engine = engine.AurixPortfolioEngine;
    if (priceLayer && priceLayer.AurixPriceLayer) priceLayer = priceLayer.AurixPriceLayer;

    // Fake fetcher: returns a 2-point series in the requested key's currency.
    function fakeFetcher(byKeyCcy, byKeySeries) {
      return function (req) {
        return Promise.resolve({
          series: byKeySeries[req.key] || [],
          meta: { currency: byKeyCcy[req.key] || 'USD', granularity: '5m', completeness: 1 }
        });
      };
    }
    // base EUR; USD→EUR = 0.9
    var fxToBase = function (ccy) { return ccy === 'EUR' ? 1 : ccy === 'USD' ? 0.9 : null; };

    var common = {
      engine: engine, priceLayer: priceLayer, baseCurrency: 'EUR', range: '24h',
      granularity: 'intraday', now: 200, fxToBase: fxToBase,
      currentValueOf: function (a) { return a.__cv || 0; }
    };

    // A. EUR stock (no FX) + USD stock (FX approx) + EUR cash + real estate (static)
    var assets = [
      { type: 'stock', ticker: 'EURX', __cv: 200, transactions: [{ type: 'buy', qty: 2, price: 90, ts: 100 }] },
      { type: 'stock', ticker: 'USDX', __cv: 90,  transactions: [{ type: 'buy', qty: 1, price: 100, ts: 100 }] },
      { type: 'cash', assetCurrency: 'EUR' },
      { type: 'real_estate', __cv: 300000 }
    ];
    var fetcher = fakeFetcher(
      { EURX: 'EUR', USDX: 'USD' },
      { EURX: [{ time: 100, value: 90 }, { time: 200, value: 100 }], USDX: [{ time: 100, value: 100 }, { time: 200, value: 100 }] }
    );
    var cashEvents = [{ type: 'deposit', amount: 1000, currency: 'EUR', ts: 100 }];

    var resA = await buildNetWorthSeries(Object.assign({}, common, {
      assets: assets, fetcher: fetcher, cashEvents: cashEvents
    }));
    // t=200: EURX 2×100=200(EUR) + USDX 1×100×0.9=90 + cash 1000 + RE 300000 = 301290
    var lastA = resA.series[resA.series.length - 1];
    check('builder composes reconstructed series', resA.series.length >= 2);
    check('per-asset FX: USD→EUR converted before compose', lastA.v === 301290);
    check('FX approx (USD present) ⇒ partial', resA.meta.confidence === 'partial' && resA.meta.fxApproximated === true);

    // B. anchor only the last point
    var resB = await buildNetWorthSeries(Object.assign({}, common, {
      assets: [assets[0]], fetcher: fetcher, nowValue: 12345
    }));
    check('anchor: last point = live total', resB.series[resB.series.length - 1].v === 12345 && resB.meta.anchored === true);

    // C. single-currency, fully covered, no static, no FX ⇒ complete
    var resC = await buildNetWorthSeries(Object.assign({}, common, {
      baseCurrency: 'EUR',
      assets: [{ type: 'stock', ticker: 'EURX', transactions: [{ type: 'buy', qty: 1, price: 90, ts: 100 }] }],
      fetcher: fakeFetcher({ EURX: 'EUR' }, { EURX: [{ time: 100, value: 90 }, { time: 200, value: 100 }] })
    }));
    check('single-ccy fully covered ⇒ complete', resC.meta.confidence === 'complete' && resC.meta.fxApproximated === false);

    // D. unknown FX → that holding uncovered → coverage drops → insufficient/partial
    var resD = await buildNetWorthSeries(Object.assign({}, common, {
      assets: [{ type: 'stock', ticker: 'JPYX', __cv: 10, transactions: [{ type: 'buy', qty: 1, price: 100, ts: 100 }] }],
      fetcher: fakeFetcher({ JPYX: 'JPY' }, { JPYX: [{ time: 100, value: 100 }, { time: 200, value: 110 }] })
    }));
    check('unknown FX ⇒ not complete (uncovered)', resD.meta.confidence !== 'complete');

    // E. no assets ⇒ insufficient
    var resE = await buildNetWorthSeries(Object.assign({}, common, { assets: [] }));
    check('no assets ⇒ insufficient', resE.meta.confidence === 'insufficient');

    try { console.log('[AurixPCE/net-worth] self-test ' + (ok ? 'PASS' : 'FAIL')); } catch (_) {}
    if (!ok) { try { console.log(R.filter(function (r) { return !r.pass; })); } catch (_) {} }
    return { pass: ok, results: R };
  }

  /* ── Public namespace ────────────────────────────────────────────────────── */
  global.AurixNetWorth = Object.freeze({
    version: 1,
    buildNetWorthSeries: buildNetWorthSeries,
    selfTest: selfTest
  });

  // Node: run the async self-test ONLY when executed directly (never on require).
  // Browser: inert (and in this phase the file is not even loaded).
  if (typeof window === 'undefined' && typeof process !== 'undefined' &&
      typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    selfTest().then(function (r) { if (!r.pass && typeof process.exit === 'function') process.exit(1); });
  }

})(typeof window !== 'undefined' ? window : this);
