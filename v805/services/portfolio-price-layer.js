/* ============================================================================
   services/portfolio-price-layer.js — AURIX-PORTFOLIO-CHART-ENGINE-1 · Fase B

   THE PRICE LAYER + CLIENT CACHE for the Portfolio Chart Engine (PCE).

   Fetches the per-asset historical price series the engine needs to reconstruct
   net worth, on top of the EXISTING Market history infrastructure
   (`window.AurixChartAdapters.{yahoo,crypto}HistoryAdapter`). It adds three
   things the engine requires and the adapters don't provide on their own:
     1. a client-side cache (per provider:key:range) with TTL,
     2. in-flight de-duplication (concurrent requests for the same series share
        one network call; holdings sharing a symbol fetch once),
     3. concurrency-capped fan-out for a whole portfolio, abortable, with
        per-symbol error isolation (one failure never fails the chart).

   FASE B SCOPE — strictly the price/cache layer. This file:
     • is COMPLETELY DORMANT: NOT loaded by index.html, nothing calls it →
       Aurix's visible behaviour is unchanged; no network request is issued
       until a later phase wires it in;
     • does NO rendering and NO composition (that is the engine / Fase C/D);
     • injects its fetcher (dependency inversion) so the pure cache/dedupe/
       concurrency logic is deterministic and node-testable. The real fetcher
       (`makeAdapterFetcher`) wraps AurixChartAdapters and runs only in-browser.

   FIDELITY NOTE: the normalized series preserves the provider's quote
   `currency` (Yahoo may return EUR for a European listing; CoinGecko is USD).
   The engine's FX layer (Fase C) converts to base — this layer never silently
   assumes USD. It also never fabricates points: a failed/empty fetch yields an
   empty series + an error flag, never a synthetic line.
   ============================================================================ */
(function (global) {
  'use strict';

  // TTL per range — mirrors the server-side cache in api/prices/history-yahoo.js
  // so the client doesn't re-hit the proxy more often than the data changes.
  var TTL_BY_RANGE = {
    '24h':  60 * 1000,
    '7d':   5  * 60 * 1000,
    '30d':  30 * 60 * 1000,
    '1y':   6  * 60 * 60 * 1000,
    'all':  24 * 60 * 60 * 1000
  };
  var DEFAULT_TTL = 5 * 60 * 1000;
  var DEFAULT_CONCURRENCY = 4;   // SPEC 4.1G — smaller fan-out → fewer CoinGecko 429s (PCE-only path; Yahoo barely affected)
  var MAX_ENTRIES = 200;            // bound memory (simple LRU by insertion order)

  function _now(injected) { return (typeof injected === 'number') ? injected : Date.now(); }
  function _ttl(range) { return TTL_BY_RANGE.hasOwnProperty(range) ? TTL_BY_RANGE[range] : DEFAULT_TTL; }
  function _cacheKey(provider, key, range) { return String(provider) + ':' + String(key) + ':' + String(range); }

  /* ── Normalize an adapter result to the engine's contract ─────────────────
     adapter result: { series:[{time(ms),value,...}], meta:{currency,granularity,completeness} }
     →               { series:[{t,v}], currency, granularity, completeness }    */
  function normalizeAdapterResult(res) {
    var r = res || {};
    var raw = Array.isArray(r.series) ? r.series : [];
    var series = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!p || typeof p.time !== 'number' || typeof p.value !== 'number' || !isFinite(p.value)) continue;
      series.push({ t: p.time, v: p.value });
    }
    var meta = r.meta || {};
    return {
      series: series,
      currency: (meta.currency && /^[A-Z]{3}$/.test(meta.currency)) ? meta.currency : 'USD',
      granularity: meta.granularity || null,
      completeness: (typeof meta.completeness === 'number') ? meta.completeness : null
    };
  }

  /* ── Cache state ──────────────────────────────────────────────────────────
     Pure in-memory store. Composed-series localStorage memo lives in Fase C.   */
  var _cache = new Map();     // cacheKey → { data, fetchedAt }
  var _inflight = new Map();  // cacheKey → Promise<data>

  function _evictIfNeeded() {
    while (_cache.size > MAX_ENTRIES) {
      var oldest = _cache.keys().next().value;   // insertion-order = oldest
      _cache.delete(oldest);
    }
  }
  function _isFresh(entry, range, now) {
    return entry && (now - entry.fetchedAt) < _ttl(range);
  }

  /* ── getSeries — single series, cached + de-duplicated ─────────────────────
     opts: { provider, key, range, fetcher, now?, signal?, force? }
       fetcher: async ({provider,key,range,signal}) → adapter-shaped result
     Returns: Promise<{ series, currency, granularity, completeness, fetchedAt, cached }>  */
  function getSeries(opts) {
    var o = opts || {};
    var ck = _cacheKey(o.provider, o.key, o.range);
    var now = _now(o.now);

    if (!o.force) {
      var hit = _cache.get(ck);
      if (_isFresh(hit, o.range, now)) {
        return Promise.resolve(Object.assign({}, hit.data, { fetchedAt: hit.fetchedAt, cached: true }));
      }
      var pending = _inflight.get(ck);
      if (pending) return pending;
    }

    var fetcher = o.fetcher;
    if (typeof fetcher !== 'function') {
      return Promise.reject(new Error('price-layer: no fetcher injected'));
    }

    var p = Promise.resolve()
      .then(function () { return fetcher({ provider: o.provider, key: o.key, range: o.range, signal: o.signal }); })
      .then(function (res) {
        var data = normalizeAdapterResult(res);
        // SPEC 4.1G — never cache an EMPTY series: a transient rate-limit /
        // upstream error (429/502) must not get pinned for the whole TTL and keep
        // showing empty-feed after the network recovers. Only real data is cached;
        // empties are re-fetched on the next request.
        if (data.series && data.series.length) { _cache.set(ck, { data: data, fetchedAt: now }); _evictIfNeeded(); }
        _inflight.delete(ck);
        return Object.assign({}, data, { fetchedAt: now, cached: false });
      })
      .catch(function (err) {
        _inflight.delete(ck);
        throw err;
      });

    _inflight.set(ck, p);
    return p;
  }

  /* ── _pool — concurrency-capped runner ─────────────────────────────────── */
  function _pool(items, limit, worker) {
    var results = new Array(items.length);
    var idx = 0;
    function run() {
      if (idx >= items.length) return Promise.resolve();
      var i = idx++;
      return Promise.resolve()
        .then(function () { return worker(items[i], i); })
        .then(function (v) { results[i] = { ok: true, value: v }; },
              function (e) { results[i] = { ok: false, error: e }; })
        .then(run);
    }
    var runners = [];
    var n = Math.max(1, Math.min(limit, items.length));
    for (var k = 0; k < n; k++) runners.push(run());
    return Promise.all(runners).then(function () { return results; });
  }

  /* ── fetchMany — whole-portfolio fan-out (dedup + concurrency + isolation) ──
     opts: { requests:[{provider,key,range}], fetcher, now?, signal?, concurrency? }
       (requests sharing the same provider:key:range are fetched ONCE)
     Returns: Promise<{ byKey:{ key → data }, errors:{ key → message }, coverage }>  */
  function fetchMany(opts) {
    var o = opts || {};
    var reqs = Array.isArray(o.requests) ? o.requests : [];
    // De-dup by cacheKey; keep first occurrence's descriptor.
    var uniq = {};
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i];
      if (!r || r.key == null) continue;
      var ck = _cacheKey(r.provider, r.key, r.range);
      if (!uniq[ck]) uniq[ck] = r;
    }
    var list = Object.keys(uniq).map(function (ck) { return uniq[ck]; });
    var limit = o.concurrency || DEFAULT_CONCURRENCY;

    return _pool(list, limit, function (r) {
      return getSeries({ provider: r.provider, key: r.key, range: r.range,
                         fetcher: o.fetcher, now: o.now, signal: o.signal });
    }).then(function (results) {
      var byKey = {}, errors = {}, ok = 0;
      for (var j = 0; j < list.length; j++) {
        var key = list[j].key;
        var res = results[j];
        if (res && res.ok) { byKey[key] = res.value; ok++; }
        else { errors[key] = (res && res.error && res.error.message) || 'fetch-failed'; }
      }
      return {
        byKey: byKey,
        errors: errors,
        coverage: list.length ? +(ok / list.length).toFixed(3) : 1
      };
    });
  }

  /* ── Default browser fetcher (wraps AurixChartAdapters) ─────────────────────
     Injected in integration. Never executed under node / in self-tests.        */
  function makeAdapterFetcher() {
    return function (req) {
      var A = (typeof window !== 'undefined') && window.AurixChartAdapters;
      if (!A) return Promise.reject(new Error('AurixChartAdapters unavailable'));
      if (req.provider === 'crypto') {
        return A.cryptoHistoryAdapter({ coinId: req.key, range: req.range, signal: req.signal });
      }
      return A.yahooHistoryAdapter({ symbol: req.key, range: req.range, signal: req.signal });
    };
  }

  function clear() { _cache.clear(); _inflight.clear(); }
  function stats() { return { entries: _cache.size, inflight: _inflight.size, maxEntries: MAX_ENTRIES }; }

  /* ── Self-test (deterministic, fake fetcher + fake clock; node-runnable) ─── */
  function selfTest() {
    var R = [], ok = true;
    function check(name, cond) { R.push({ name: name, pass: !!cond }); if (!cond) ok = false; }

    function fakeResult(n) {
      var series = [];
      for (var i = 0; i < n; i++) series.push({ time: i * 1000, value: 100 + i });
      return { series: series, meta: { currency: 'EUR', granularity: '5m', completeness: 1 } };
    }

    var chain = Promise.resolve();
    var calls;

    // 1. miss → fetch → hit (no second fetch within TTL)
    chain = chain.then(function () {
      clear(); calls = 0;
      var fetcher = function () { calls++; return Promise.resolve(fakeResult(3)); };
      return getSeries({ provider: 'yahoo', key: 'AAPL', range: '24h', fetcher: fetcher, now: 1000 })
        .then(function (d) {
          check('normalize {time,value}→{t,v}', d.series.length === 3 && d.series[0].t === 0 && d.series[0].v === 100);
          check('preserve non-USD currency', d.currency === 'EUR');
          check('first fetch not cached', d.cached === false);
          return getSeries({ provider: 'yahoo', key: 'AAPL', range: '24h', fetcher: fetcher, now: 1000 + 30000 });
        })
        .then(function (d2) {
          check('TTL hit served from cache', d2.cached === true);
          check('fetcher called once within TTL', calls === 1);
        });
    });

    // 2. TTL expiry → refetch
    chain = chain.then(function () {
      var fetcher = function () { calls++; return Promise.resolve(fakeResult(3)); };
      return getSeries({ provider: 'yahoo', key: 'AAPL', range: '24h', fetcher: fetcher, now: 1000 + 999999 })
        .then(function (d) { check('refetch after TTL expiry', d.cached === false && calls === 2); });
    });

    // 3. in-flight dedupe: two concurrent calls → one fetch
    chain = chain.then(function () {
      clear();
      var n = 0;
      var fetcher = function () { n++; return new Promise(function (res) { setTimeout(function () { res(fakeResult(2)); }, 5); }); };
      var a = getSeries({ provider: 'crypto', key: 'bitcoin', range: '7d', fetcher: fetcher, now: 1 });
      var b = getSeries({ provider: 'crypto', key: 'bitcoin', range: '7d', fetcher: fetcher, now: 1 });
      return Promise.all([a, b]).then(function () { check('in-flight dedupe → single fetch', n === 1); });
    });

    // 4. fetchMany: shared symbol fetched once + error isolation + coverage
    chain = chain.then(function () {
      clear();
      var hits = {};
      var fetcher = function (req) {
        hits[req.key] = (hits[req.key] || 0) + 1;
        if (req.key === 'BAD') return Promise.reject(new Error('boom'));
        return Promise.resolve(fakeResult(2));
      };
      return fetchMany({
        fetcher: fetcher, now: 1, concurrency: 2,
        requests: [
          { provider: 'yahoo', key: 'AAPL', range: '24h' },
          { provider: 'yahoo', key: 'AAPL', range: '24h' },   // duplicate
          { provider: 'yahoo', key: 'MSFT', range: '24h' },
          { provider: 'yahoo', key: 'BAD',  range: '24h' }
        ]
      }).then(function (out) {
        check('fetchMany dedupes shared symbol', hits['AAPL'] === 1);
        check('fetchMany returns good keys', !!out.byKey['AAPL'] && !!out.byKey['MSFT']);
        check('fetchMany isolates failure', !out.byKey['BAD'] && out.errors['BAD'] === 'boom');
        check('fetchMany coverage = 2/3', out.coverage === 0.667);
      });
    });

    return chain.then(function () {
      try { console.log('[AurixPCE/price-layer] self-test ' + (ok ? 'PASS' : 'FAIL')); } catch (_) {}
      if (!ok) { try { console.log(R.filter(function (r) { return !r.pass; })); } catch (_) {} }
      return { pass: ok, results: R };
    });
  }

  /* ── Public namespace ────────────────────────────────────────────────────── */
  global.AurixPriceLayer = Object.freeze({
    version: 1,
    TTL_BY_RANGE: TTL_BY_RANGE,
    normalizeAdapterResult: normalizeAdapterResult,
    getSeries: getSeries,
    fetchMany: fetchMany,
    makeAdapterFetcher: makeAdapterFetcher,
    clear: clear,
    stats: stats,
    selfTest: selfTest
  });

  // Node: run the async self-test ONLY when executed directly (never on require,
  // so importing this module has no side effects on the shared cache). Browser: inert.
  if (typeof window === 'undefined' && typeof process !== 'undefined' &&
      typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    selfTest().then(function (r) { if (!r.pass && typeof process.exit === 'function') process.exit(1); });
  }

})(typeof window !== 'undefined' ? window : this);
