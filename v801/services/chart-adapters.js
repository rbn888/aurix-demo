/* ─────────────────────────────────────────────────────────────────
   AurixChartAdapters — CHART-3 historical data foundation.

   ONE chart engine, MANY data sources. This module is the data side.

   Public API (attached to window.AurixChartAdapters):

     yahooHistoryAdapter({ symbol, range, signal? })
     cryptoHistoryAdapter({ coinId, range, signal? })
     portfolioHistoryAdapter({ range })

   Every adapter returns the canonical Aurix shape:

     {
       series: [
         { time: epochMs, value, open?, high?, low?, close?, volume? }
       ],
       meta: {
         source: 'yahoo' | 'coingecko' | 'local-snapshot',
         currency: 'USD',
         granularity: '5m'|'15m'|'1h'|'1d'|'1wk',
         isSynthetic: boolean,
         completeness: number,         // 0..1
         asOf: epochMs
       }
     }

   Rules:
   - All adapters emit values in canonical USD. Base-currency conversion
     is the chart layer's job (toBase at render time).
   - Errors NEVER throw — they return an empty series + meta. The chart
     core renders the empty/error state cleanly.
   - No UI surface consumes adapters in CHART-3. This is infrastructure.

   MARKET-EXCELLENCE-B1 · DATA STATE CONTRACT
   ------------------------------------------
   "Empty series" is NOT one fact, it is three, and until B1 the adapter
   contract could not tell them apart: an empty `series` meant both "this
   asset genuinely has no price history" and "the provider was down / rate
   limited". Consumers therefore rendered a temporary CoinGecko 429 on
   ETH/ALL as "Ethereum has no historical data" — a false statement about a
   real asset. The Yahoo adapter was worse: it recorded no reason at all.

   Every adapter return now declares ONE canonical status in `meta.status`:

     'ready'        series has usable points
     'no_history'   the provider answered correctly with zero points
     'unavailable'  transport / HTTP / parse failure, rate limit, upstream
                    error — we learned NOTHING about this asset's history
     'aborted'      the caller cancelled; not a user-facing state

   `meta.error` keeps the finer-grained slug (rate-limited, http-502, …) for
   diagnostics ONLY. It is never a user-facing string.
   ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // AURIX-APP-DOMAIN-READY-1: single source of truth for the API origin
  // (window.AURIX_API_BASE, set in index.html). Default stays the current
  // Vercel project during migration; set to '' for a same-origin /api later.
  const API_BASE = (typeof window !== 'undefined' && typeof window.AURIX_API_BASE === 'string')
    ? window.AURIX_API_BASE
    : 'https://demo-api.aurix.invalid';

  // ── Range → provider arg maps ─────────────────────────────────
  // Yahoo accepts named ranges + intervals; the backend already owns
  // that mapping. Crypto / CoinGecko uses `days` — a number for fixed
  // windows, or the string 'max' for the full available history.
  // ASSET-CHARTS-1: 'all' must mean *all* available history, not 365
  // days — otherwise BTC TOTAL is indistinguishable from 1Y. CoinGecko
  // accepts days=max and returns the full series from genesis.
  const CRYPTO_DAYS = Object.freeze({
    '24h': 1, '7d': 7, '30d': 30, '3m': 90, '1y': 365, 'all': 'max',
  });

  // Coarse cumulative window in ms, used to bucket "completeness"
  // metrics for adapter responses.
  const RANGE_SPAN_MS = Object.freeze({
    '24h':       24 * 3600e3,
    '7d':    7  * 86400e3,
    '30d':  30  * 86400e3,
    '3m':   90  * 86400e3,
    '1y':  365  * 86400e3,
    'all': 730  * 86400e3,
  });

  // Expected sample count per range (rough — used for the completeness
  // metric on the meta. Never enforced.)
  const RANGE_EXPECTED = Object.freeze({
    '24h':  96,   // 5-min
    '7d':  168,
    '30d': 180,
    '3m':  180,
    '1y':  220,
    'all': 250,
  });

  function _warn(...args) { try { console.warn('[chart-adapters]', ...args); } catch (_) {} }

  // SPEC 4.1G — abort-aware delay for retry backoff. Rejects immediately if the
  // caller's AbortController fires, so retries never outlive a cancelled request.
  function _sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      const id = setTimeout(resolve, ms);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () { clearTimeout(id); reject(new Error('aborted')); }, { once: true });
      }
    });
  }
  // SPEC 4.1G — per-coin crypto feed diagnostic side-channel (write-only). The
  // founder overlay reads window.__aurixCryptoFeedDiag to distinguish a genuine
  // 'empty-feed-real' from a transient 'rate-limited' / 'upstream-error'. Touches
  // no data/persistence; keyed by lower-cased coinId.
  function _cryptoDiag(coinId, status) {
    try {
      if (typeof window === 'undefined') return;
      const g = (window.__aurixCryptoFeedDiag = window.__aurixCryptoFeedDiag || {});
      g[String(coinId || '').toLowerCase()] = { status: status, at: Date.now() };
    } catch (_) {}
  }
  // MARKET-EXCELLENCE-B1 — canonical data states. Single vocabulary shared by
  // every adapter and every consumer.
  const DATA_STATUS = Object.freeze({
    READY:       'ready',
    NO_HISTORY:  'no_history',
    UNAVAILABLE: 'unavailable',
    ABORTED:     'aborted',
  });
  // The crypto adapter's fine-grained reason → canonical status. A 200 with no
  // prices is the ONLY crypto reason that may ever mean "no history".
  const _CRYPTO_REASON_STATUS = Object.freeze({
    'empty-feed-real': DATA_STATUS.NO_HISTORY,
    'rate-limited':    DATA_STATUS.UNAVAILABLE,
    'upstream-error':  DATA_STATUS.UNAVAILABLE,
    'aborted':         DATA_STATUS.ABORTED,
  });
  function _cryptoEmpty(coinId, reason) {
    _cryptoDiag(coinId, reason);
    return {
      series: [],
      meta: {
        source: 'coingecko', currency: 'USD', granularity: '1h', isSynthetic: false,
        completeness: 0, asOf: Date.now(),
        status: _CRYPTO_REASON_STATUS[reason] || DATA_STATUS.UNAVAILABLE,
        error: reason,
      },
    };
  }

  // `status` is REQUIRED at every call site: the meaning of an empty series is
  // knowledge the producer has and the consumer cannot recover.
  function _emptyResult(source, currency, granularity, status, error) {
    return Object.freeze({
      series: [],
      meta: Object.freeze({
        source,
        currency:    (currency || 'USD').toUpperCase(),
        granularity: granularity || '1d',
        isSynthetic: false,
        completeness: 0,
        asOf: Date.now(),
        status: status || DATA_STATUS.UNAVAILABLE,
        error: error || null,
      }),
    });
  }

  function _validRange(r) {
    return typeof r === 'string' && Object.prototype.hasOwnProperty.call(RANGE_SPAN_MS, r);
  }

  function _completenessFor(seriesLen, range) {
    const expected = RANGE_EXPECTED[range] || 1;
    if (expected <= 0) return 0;
    const ratio = seriesLen / expected;
    return Math.max(0, Math.min(1, +ratio.toFixed(3)));
  }

  // ── 1. Yahoo adapter ──────────────────────────────────────────
  async function yahooHistoryAdapter(args) {
    const a = args || {};
    const symbol = String(a.symbol || '').trim();
    const range  = String(a.range  || '').toLowerCase();
    if (!symbol || !_validRange(range)) {
      // A request we could not even form says nothing about the asset.
      return _emptyResult('yahoo', 'USD', '1d', DATA_STATUS.UNAVAILABLE, 'bad-request');
    }

    let res;
    try {
      res = await fetch(
        `${API_BASE}/api/prices/history-yahoo` +
          `?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
        { signal: a.signal, headers: { Accept: 'application/json' } }
      );
    } catch (err) {
      if (a.signal && a.signal.aborted) {
        return _emptyResult('yahoo', 'USD', '1d', DATA_STATUS.ABORTED, 'aborted');
      }
      _warn('yahoo fetch fail', symbol, range, err?.message);
      return _emptyResult('yahoo', 'USD', '1d', DATA_STATUS.UNAVAILABLE, 'network-error');
    }
    if (!res.ok) {
      // The endpoint answers 200 + empty `points` for a genuine no-history and
      // 4xx/502 only for real failures, so a non-2xx is NEVER "no history".
      _warn('yahoo http', symbol, range, res.status);
      return _emptyResult('yahoo', 'USD', '1d', DATA_STATUS.UNAVAILABLE, 'http-' + res.status);
    }

    let body;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!body || body.ok !== true || !Array.isArray(body.points)) {
      return _emptyResult('yahoo', 'USD', '1d', DATA_STATUS.UNAVAILABLE, 'bad-response');
    }

    const granularity = String(body.granularity || '1d');
    const series = [];
    for (const p of body.points) {
      // The endpoint already filters non-finite close values. Belt-and-
      // braces: filter again here so the adapter contract is hard-typed.
      if (!p || typeof p.time !== 'number' || typeof p.close !== 'number' || !Number.isFinite(p.close)) continue;
      series.push({
        time:   p.time,
        value:  p.close,
        open:   Number.isFinite(p.open)   ? p.open   : null,
        high:   Number.isFinite(p.high)   ? p.high   : null,
        low:    Number.isFinite(p.low)    ? p.low    : null,
        close:  p.close,
        volume: Number.isFinite(p.volume) ? p.volume : null,
      });
    }

    // Yahoo's `meta.currency` is preserved verbatim by the backend (or
    // null if it didn't pass the ISO-4217 guard). For the adapter
    // contract, default to USD when the proxy couldn't confirm a code.
    const currency = (body.currency && /^[A-Z]{3}$/.test(body.currency))
      ? body.currency
      : 'USD';

    return {
      series,
      meta: {
        source:       'yahoo',
        currency:     currency,
        granularity:  granularity,
        isSynthetic:  false,
        completeness: _completenessFor(series.length, range),
        asOf:         Date.now(),
        // The provider answered correctly. Zero usable points here IS the real
        // answer: this symbol has no history for this range.
        status:       series.length ? DATA_STATUS.READY : DATA_STATUS.NO_HISTORY,
        error:        null,
      },
    };
  }

  /* ── MARKET-EXCELLENCE-B1.1 — ALL de cripto: ventana larga real ─────────────
     CoinGecko `market_chart?days=max` es EXCLUSIVO de Pro con la clave/tier
     actual: el proxy devuelve 502 `upstream_401` de forma determinista (medido
     2026-08-21, con el rate-limit despejado, en ethereum/bitcoin/solana). Los
     días que el tier SÍ sirve son 1/7/30/90/180/365 ⇒ el techo real es 365 días.
     Recortar ALL a 365 días NO es una solución: dejaría ALL idéntico a 1Y, que
     es exactamente el defecto que ASSET-CHARTS-1 arregló.

     La ventana larga existe en una fuente que ya está en producción y ya se usa
     para cripto en Market (el par `<TICKER>-USD` de Yahoo, HOTFIX
     MARKET-CRYPTO-HISTORY). Medido contra el endpoint real:
       ETH-USD 2017-11 → hoy (460 pts) · BTC-USD 2014-10 → hoy (144 pts)
       SOL-USD 2020-04 → hoy (334 pts) · ADA-USD 2017-11 → hoy (460 pts)
     Se pide PRIMERO esa fuente para ALL (y sólo para ALL): así no se gastan tres
     intentos + backoff contra un 401 seguro en cada apertura, que además
     consumían cuota de la clave demo compartida. Si no hay par conocido, o la
     fuente larga falla, se cae al `days=max` de siempre — que es lo que
     funcionaría con una clave Pro, sin perder capacidad.

     Nada de esto inventa un solo punto: es precio real de mercado, de otra
     fuente, declarada en `meta.source` y con la ventana real en `meta.window`. */
  function _realGranularity(series, fallback) {
    if (!Array.isArray(series) || series.length < 2) return fallback;
    const d = [];
    for (let i = 1; i < series.length; i++) d.push(series[i].time - series[i - 1].time);
    d.sort(function (x, y) { return x - y; });
    const med = d[Math.floor(d.length / 2)];
    if      (med <= 6 * 60e3)    return '5m';
    else if (med <= 30 * 60e3)   return '15m';
    else if (med <= 2 * 3600e3)  return '1h';
    else if (med <= 36 * 3600e3) return '1d';
    else if (med <= 10 * 86400e3) return '1wk';
    return '1mo';
  }
  function _windowOf(series) {
    if (!Array.isArray(series) || !series.length) return null;
    const startMs = series[0].time, endMs = series[series.length - 1].time;
    return { startMs, endMs, spanDays: Math.round((endMs - startMs) / 86400e3) };
  }
  // Devuelve la serie larga real, o null si esta fuente no puede servirla.
  async function _cryptoLongHistory(symbol, signal) {
    const r = await yahooHistoryAdapter({ symbol, range: 'all', signal });
    if (!r || !Array.isArray(r.series) || !r.series.length) return null;
    if (r.meta && r.meta.status !== DATA_STATUS.READY) return null;
    // La granularidad se MIDE, no se hereda del intervalo pedido: para spans muy
    // largos la fuente entrega pasos mensuales aunque se pidiera semanal (BTC).
    return {
      series: r.series,
      meta: {
        source:       'yahoo',
        currency:     (r.meta && r.meta.currency) || 'USD',
        granularity:  _realGranularity(r.series, (r.meta && r.meta.granularity) || '1wk'),
        isSynthetic:  false,
        completeness: 1,
        asOf:         Date.now(),
        status:       DATA_STATUS.READY,
        error:        null,
        // Ventana REAL cubierta y de dónde vino: ALL nunca se etiqueta a ciegas.
        window:       _windowOf(r.series),
        longHistoryVia: 'yahoo-pair',
      },
    };
  }

  // ── 2. Crypto adapter (CoinGecko via existing proxy) ─────────
  async function cryptoHistoryAdapter(args) {
    const a = args || {};
    const coinId = String(a.coinId || '').trim().toLowerCase();
    const range  = String(a.range  || '').toLowerCase();
    if (!coinId || !_validRange(range)) {
      return _emptyResult('coingecko', 'USD', '1h', DATA_STATUS.UNAVAILABLE, 'bad-request');
    }
    const days = CRYPTO_DAYS[range];
    if (!days) {
      return _emptyResult('coingecko', 'USD', '1h', DATA_STATUS.UNAVAILABLE, 'bad-request');
    }

    // MARKET-EXCELLENCE-B1.1 — sólo ALL, y sólo si el llamante trajo el par.
    if (range === 'all' && a.pairSymbol) {
      if (a.signal && a.signal.aborted) return _cryptoEmpty(coinId, 'aborted');
      let long = null;
      try { long = await _cryptoLongHistory(String(a.pairSymbol).toUpperCase(), a.signal); }
      catch (err) { _warn('crypto long-history fail', coinId, err?.message); }
      if (a.signal && a.signal.aborted) return _cryptoEmpty(coinId, 'aborted');
      if (long) { _cryptoDiag(coinId, 'ok'); return long; }
      // Sin ventana larga por esta vía: se sigue al camino de siempre (days=max),
      // que es el que funciona con una clave Pro.
    }

    const url = `${API_BASE}/api/prices/history` +
      `?id=${encodeURIComponent(coinId)}&days=${encodeURIComponent(days)}`;
    // SPEC 4.1G — transient CoinGecko 429/502/503/504 (rate-limit / upstream)
    // must NOT turn valid crypto into a permanent empty-feed. Retry up to twice
    // with short jittered backoff (immediate → 400-700ms → 900-1400ms), aborting
    // cleanly if the caller cancels. A 200 with no prices is a GENUINE empty
    // (not retried). On final failure we return empty WITH a distinguishable
    // reason so the overlay can show rate-limited / upstream-error vs no-history.
    const BACKOFFS  = [0, 400 + Math.floor(Math.random() * 300), 900 + Math.floor(Math.random() * 500)];
    const RETRYABLE = { 429: 'rate-limited', 502: 'upstream-error', 503: 'upstream-error', 504: 'upstream-error' };
    let lastReason  = 'upstream-error';

    for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
      if (a.signal && a.signal.aborted) return _cryptoEmpty(coinId, 'aborted');
      if (attempt > 0) {
        try { await _sleep(BACKOFFS[attempt], a.signal); }
        catch (_) { return _cryptoEmpty(coinId, 'aborted'); }
      }

      let res;
      try {
        res = await fetch(url, { signal: a.signal, headers: { Accept: 'application/json' } });
      } catch (err) {
        if (a.signal && a.signal.aborted) return _cryptoEmpty(coinId, 'aborted');
        lastReason = 'upstream-error';
        _warn('crypto fetch fail', coinId, range, err?.message);
        continue;   // network error → retry
      }

      if (res.ok) {
        let body;
        try { body = await res.json(); } catch (_) { body = null; }
        const prices = Array.isArray(body?.prices) ? body.prices : [];
        if (!prices.length) return _cryptoEmpty(coinId, 'empty-feed-real');   // 200 + no data → genuine; don't retry

        // CoinGecko granularity is implicit by `days`: <=1d → 5m, <=90d → 1h, >90d → 1d.
        const granularity = days <= 1 ? '5m' : days <= 90 ? '1h' : '1d';
        const series = [];
        for (const p of prices) {
          if (!Array.isArray(p) || p.length < 2) continue;
          const t = p[0], v = p[1];
          if (typeof t !== 'number' || typeof v !== 'number' || !Number.isFinite(v)) continue;
          series.push({ time: t, value: v });
        }
        _cryptoDiag(coinId, 'ok');
        return {
          series,
          meta: {
            source:       'coingecko',
            currency:     'USD',
            granularity:  granularity,
            isSynthetic:  false,
            completeness: _completenessFor(series.length, range),
            asOf:         Date.now(),
            status:       series.length ? DATA_STATUS.READY : DATA_STATUS.NO_HISTORY,
            error:        null,
          },
        };
      }

      // Non-2xx: retry on transient codes, stop on the rest (e.g. 400/404).
      lastReason = RETRYABLE[res.status] || 'upstream-error';
      _warn('crypto http', coinId, range, res.status);
      if (!RETRYABLE[res.status]) break;
    }

    return _cryptoEmpty(coinId, lastReason);
  }

  // ── 3. Portfolio adapter (local snapshots) ───────────────────
  // Reads the in-memory `portfolioHistory` populated by app.js's
  // recordSnapshot loop. Each entry is { ts: epochMs, value: USD }.
  // The adapter NEVER mutates the underlying array.
  function portfolioHistoryAdapter(args) {
    const a = args || {};
    const range = String(a.range || '').toLowerCase();
    if (!_validRange(range)) {
      return _emptyResult('local-snapshot', 'USD', '5m', DATA_STATUS.UNAVAILABLE, 'bad-request');
    }

    const raw = (typeof window !== 'undefined' && Array.isArray(window.portfolioHistory))
      ? window.portfolioHistory
      // app.js declares `portfolioHistory` as a top-level `let`; in
      // browser env it's reachable via `window` only when explicitly
      // attached. Fall back to globalThis lookup so the adapter still
      // sees the data when wired via consumers that pass it in.
      : (typeof globalThis !== 'undefined' && Array.isArray(globalThis.portfolioHistory))
        ? globalThis.portfolioHistory
        : [];

    // Local snapshots: an empty store is a real, known absence, not a failure.
    if (!raw.length) return _emptyResult('local-snapshot', 'USD', '5m', DATA_STATUS.NO_HISTORY);

    const now    = Date.now();
    const cutoff = range === 'all' ? 0 : (now - RANGE_SPAN_MS[range]);
    const filtered = [];
    for (const p of raw) {
      if (!p) continue;
      const t = Number(p.ts);
      const v = Number(p.value);
      if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
      if (t < cutoff) continue;
      filtered.push({ time: t, value: v });
    }
    if (!filtered.length) return _emptyResult('local-snapshot', 'USD', '5m', DATA_STATUS.NO_HISTORY);
    filtered.sort((a, b) => a.time - b.time);

    // Granularity inference from median delta between adjacent points.
    let granularity = '5m';
    if (filtered.length >= 2) {
      const deltas = [];
      for (let i = 1; i < filtered.length; i++) deltas.push(filtered[i].time - filtered[i - 1].time);
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      if      (median <= 6 * 60e3)        granularity = '5m';
      else if (median <= 30 * 60e3)       granularity = '15m';
      else if (median <= 2 * 3600e3)      granularity = '1h';
      else if (median <= 36 * 3600e3)     granularity = '1d';
      else                                granularity = '1wk';
    }

    return {
      series: filtered,
      meta: {
        source:       'local-snapshot',
        currency:     'USD',
        granularity:  granularity,
        isSynthetic:  false,
        completeness: _completenessFor(filtered.length, range),
        asOf:         now,
        status:       DATA_STATUS.READY,
        error:        null,
      },
    };
  }

  // ── Public surface (read-only) ───────────────────────────────
  window.AurixChartAdapters = Object.freeze({
    yahooHistoryAdapter,
    cryptoHistoryAdapter,
    portfolioHistoryAdapter,
    // MARKET-EXCELLENCE-B1 — the canonical status vocabulary, published so no
    // consumer has to hardcode it.
    DATA_STATUS,
    // Diagnostics — useful from console without exposing internals.
    _ranges: Object.keys(RANGE_SPAN_MS),
  });
})();
