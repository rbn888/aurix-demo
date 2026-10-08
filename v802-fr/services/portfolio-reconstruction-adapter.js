/* ============================================================================
   services/portfolio-reconstruction-adapter.js — AURIX-PORTFOLIO-CHART-ENGINE-1 · Fase D

   THE DASHBOARD BRIDGE. Translates the app's live state into the PCE
   orchestrator's injected-dependency contract, runs the reconstruction
   (AurixNetWorth.buildNetWorthSeries → engine + price layer + adapters), applies
   the FIDELITY GATE, and maps the engine envelope into the shape the dashboard
   chart consumes ({time,value} series + headline figures), OR returns null so
   the caller falls back to snapshots.

   FASE D SCOPE — translation + decision only. This file:
     • is INERT until called: defining window.AurixPortfolioRecon has no side
       effects, issues no network request, touches no DOM/surface;
     • reads NO global app state — every input (assets, fx, current values, cash
       events, live total) is injected by the caller (app.js, which owns the
       closure where `assets`/`baseCurrency`/`usdToEur` live);
     • does NO rendering and NEVER mutates assets, portfolioHistory, snapshots,
       Supabase or persistence;
     • is the ONLY place the gate thresholds live, so fidelity policy is one edit.

   FIDELITY GATE (caller treats null as "keep snapshots"):
     • confidence === 'insufficient'  → null
     • coverage   <  COVERAGE_MIN     → null   (0.85 — confirmed Fase D)
     • pointCount <  MIN_POINTS       → null   (2)
   A 'partial' result (e.g. FX approximated, or thin cash history) is allowed
   THROUGH the gate but is flagged (confidence/fxApproximated) so the caller can
   show an honest caveat. Timeout / abort / thrown errors are handled by the
   caller, never here.
   ============================================================================ */
(function (global) {
  'use strict';

  // Confirmed Fase D thresholds. coverage >= 0.85 AND confidence != insufficient
  // AND at least MIN_POINTS real points, or we refuse to swap (snapshots win).
  var COVERAGE_MIN = 0.85;
  var MIN_POINTS   = 2;

  function _isFiniteNum(x) { return typeof x === 'number' && isFinite(x); }

  // Earliest real timestamp across all transactions + cash events. The engine is
  // deterministic and never calls the clock, so for the unbounded 'all' range it
  // needs a span: we derive it from the oldest real event (never fabricated).
  // Returns null when there is no dated history.
  function _earliestTs(assets, cashEvents) {
    var min = Infinity;
    var list = Array.isArray(assets) ? assets : [];
    for (var i = 0; i < list.length; i++) {
      var txns = (list[i] && Array.isArray(list[i].transactions)) ? list[i].transactions : [];
      for (var j = 0; j < txns.length; j++) {
        var t = txns[j];
        if (t && _isFiniteNum(t.ts) && t.ts < min) min = t.ts;
      }
    }
    var ev = Array.isArray(cashEvents) ? cashEvents : [];
    for (var k = 0; k < ev.length; k++) {
      if (ev[k] && _isFiniteNum(ev[k].ts) && ev[k].ts < min) min = ev[k].ts;
    }
    return (min === Infinity) ? null : min;
  }

  /* ── buildDashboardSeries — reconstruct + gate + map (async) ────────────────
     opts (ALL injected by the caller; this module reads no app globals):
       assets         : array of the app's asset objects (activeAssets())
       range          : '24h' | '7d' | '30d' | '1y' | 'all'
       baseCurrency   : 'USD' | 'EUR'
       signal         : AbortSignal (propagated to the price layer fan-out)
       currentValueOf : asset → live value in BASE currency
       fxToBase       : (currency) → factor to base | null (unknown ⇒ uncovered)
       cashEvents     : wealth-ledger events array (real events only — Fase D
                        does NOT seed a synthetic opening balance)
       nowValue       : live total in BASE — anchors ONLY the last point
       now            : caller-stamped clock (ms). REQUIRED — the engine never
                        calls Date.now(); without it the grid is empty.
       asOf           : caller-stamped time for the envelope meta (defaults to now)
       firstTs        : optional override for the 'all' span; otherwise derived
                        from the oldest real transaction / cash event.
     Returns: Promise< dashboardEnvelope | null >
       dashboardEnvelope = {
         series:[{time,value}], values, timestamps,
         firstValue, lastValue, deltaAbs, deltaPct, pointsCount,
         isLowData:false, source:'reconstructed',
         confidence, coverage, fxApproximated, granularity
       }
     null  ⇒ gate failed / engine unavailable ⇒ caller keeps snapshots.        */
  async function buildDashboardSeries(opts) {
    var o = opts || {};
    var NW = (typeof global !== 'undefined') && global.AurixNetWorth;
    if (!NW || typeof NW.buildNetWorthSeries !== 'function') return null;

    if (!_isFiniteNum(o.now) || o.now <= 0) return null;   // no clock ⇒ no honest grid
    var assetsIn   = Array.isArray(o.assets) ? o.assets : [];
    var cashEvents = Array.isArray(o.cashEvents) ? o.cashEvents : [];
    var firstTs    = _isFiniteNum(o.firstTs) ? o.firstTs : _earliestTs(assetsIn, cashEvents);

    var env;
    try {
      env = await NW.buildNetWorthSeries({
        assets:         assetsIn,
        range:          o.range,
        baseCurrency:   o.baseCurrency,
        signal:         o.signal,
        currentValueOf: o.currentValueOf,
        fxToBase:       o.fxToBase,
        cashEvents:     cashEvents,
        nowValue:       o.nowValue,
        now:            o.now,                                   // caller-stamped clock
        asOf:           _isFiniteNum(o.asOf) ? o.asOf : o.now,
        firstTs:        _isFiniteNum(firstTs) ? firstTs : undefined  // 'all' span
        // resolveHolding / transactionsOf intentionally omitted → the engine's
        // defaults (defaultResolveHolding, a.transactions) match the app's
        // own _aurixAssetPickAdapter classification.
      });
    } catch (_) {
      return null;   // any orchestrator failure ⇒ snapshots (caller decides UX)
    }

    if (!env || !env.meta || !Array.isArray(env.series)) return null;
    var m = env.meta;

    // ── FIDELITY GATE ──────────────────────────────────────────────────────
    if (m.confidence === 'insufficient') return null;
    if (!_isFiniteNum(m.coverage) || m.coverage < COVERAGE_MIN) return null;
    if (!_isFiniteNum(m.pointCount) || m.pointCount < MIN_POINTS) return null;

    // ── MAP engine envelope → dashboard contract ───────────────────────────
    var src = env.series;
    var series = new Array(src.length);
    var values = new Array(src.length);
    var timestamps = new Array(src.length);
    for (var i = 0; i < src.length; i++) {
      var p = src[i];
      series[i]     = { time: p.t, value: p.v };
      values[i]     = p.v;
      timestamps[i] = p.t;
    }
    if (series.length < MIN_POINTS) return null;   // defensive (gate already covers)

    return {
      series:         series,
      values:         values,
      timestamps:     timestamps,
      firstValue:     _isFiniteNum(m.firstValue) ? m.firstValue : null,
      lastValue:      _isFiniteNum(m.lastValue)  ? m.lastValue  : null,
      deltaAbs:       _isFiniteNum(m.deltaAbs)   ? m.deltaAbs   : null,
      deltaPct:       _isFiniteNum(m.deltaPct)   ? m.deltaPct   : null,
      pointsCount:    series.length,
      isLowData:      false,
      source:         'reconstructed',
      confidence:     m.confidence || null,
      coverage:       m.coverage,
      fxApproximated: !!m.fxApproximated,
      granularity:    m.granularity || null
    };
  }

  /* ── Self-test (deterministic; injects a fake AurixNetWorth) ──────────────── */
  async function selfTest() {
    var R = [], ok = true;
    function check(name, cond) { R.push({ name: name, pass: !!cond }); if (!cond) ok = false; }

    var savedNW = global.AurixNetWorth;
    function withFakeNW(envelope, fn) {
      global.AurixNetWorth = { buildNetWorthSeries: function () { return Promise.resolve(envelope); } };
      return Promise.resolve().then(fn).then(
        function (v) { global.AurixNetWorth = savedNW; return v; },
        function (e) { global.AurixNetWorth = savedNW; throw e; }
      );
    }

    var goodEnv = {
      series: [{ t: 100, v: 10 }, { t: 200, v: 12 }],
      meta: { confidence: 'complete', coverage: 1, pointCount: 2,
              firstValue: 10, lastValue: 12, deltaAbs: 2, deltaPct: 20,
              fxApproximated: false, granularity: 'intraday' }
    };

    await withFakeNW(goodEnv, function () {
      return buildDashboardSeries({ assets: [{}], range: '24h', baseCurrency: 'USD', now: 200 })
        .then(function (d) {
          check('maps {t,v}→{time,value}', d && d.series[0].time === 100 && d.series[0].value === 10);
          check('carries headline figures', d && d.lastValue === 12 && d.deltaPct === 20);
          check('source = reconstructed', d && d.source === 'reconstructed');
        });
    });

    await withFakeNW(goodEnv, function () {
      return buildDashboardSeries({ assets: [{}], range: '24h', baseCurrency: 'USD' /* no now */ })
        .then(function (d) { check('missing clock ⇒ null (no honest grid)', d === null); });
    });

    await withFakeNW(Object.assign({}, goodEnv, { meta: Object.assign({}, goodEnv.meta, { confidence: 'insufficient' }) }), function () {
      return buildDashboardSeries({ assets: [{}], range: '24h', now: 200 }).then(function (d) { check('insufficient ⇒ null', d === null); });
    });

    await withFakeNW(Object.assign({}, goodEnv, { meta: Object.assign({}, goodEnv.meta, { coverage: 0.5 }) }), function () {
      return buildDashboardSeries({ assets: [{}], range: '24h', now: 200 }).then(function (d) { check('coverage<0.85 ⇒ null', d === null); });
    });

    await withFakeNW(Object.assign({}, goodEnv, { meta: Object.assign({}, goodEnv.meta, { confidence: 'partial', coverage: 0.9, fxApproximated: true }) }), function () {
      return buildDashboardSeries({ assets: [{}], range: '24h', now: 200 }).then(function (d) { check('partial+coverage≥0.85 passes with flag', d && d.confidence === 'partial' && d.fxApproximated === true); });
    });

    global.AurixNetWorth = { buildNetWorthSeries: function () { return Promise.reject(new Error('boom')); } };
    await buildDashboardSeries({ assets: [{}], range: '24h', now: 200 }).then(function (d) { check('orchestrator throw ⇒ null', d === null); });
    global.AurixNetWorth = savedNW;

    try { console.log('[AurixPCE/recon-adapter] self-test ' + (ok ? 'PASS' : 'FAIL')); } catch (_) {}
    if (!ok) { try { console.log(R.filter(function (r) { return !r.pass; })); } catch (_) {} }
    return { pass: ok, results: R };
  }

  /* ── Public namespace ────────────────────────────────────────────────────── */
  global.AurixPortfolioRecon = Object.freeze({
    version: 1,
    COVERAGE_MIN: COVERAGE_MIN,
    MIN_POINTS: MIN_POINTS,
    buildDashboardSeries: buildDashboardSeries,
    selfTest: selfTest
  });

  // Node: run the async self-test ONLY when executed directly (never on require).
  // Browser: inert (and flag-gated by the caller in app.js).
  if (typeof window === 'undefined' && typeof process !== 'undefined' &&
      typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    selfTest().then(function (r) { if (!r.pass && typeof process.exit === 'function') process.exit(1); });
  }

})(typeof window !== 'undefined' ? window : this);
