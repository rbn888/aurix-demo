// services/history.js
// ─────────────────────────────────────────────────────────────────────────────
// Real portfolio history using CoinGecko market_chart API.
//
// Replaces the simulated/sparse local snapshot data with actual historical
// prices × held quantities, keyed by the existing range IDs (24h / 7d /
// 30d / 1y) that the chart system already understands.
//
// Integration: sets window._liveHistory[range] = [{ts, value}] in USD.
// getChartData() in app.js checks this map first; when it is populated the
// chart renders real data.  When it is absent (range not yet fetched, or
// non-crypto portfolio) getChartData() falls back to local snapshots exactly
// as before — no behaviour change for existing users.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Shared cross-script cache exposed on window so getChartData() can read it.
window._liveHistory       = window._liveHistory       || {};
// "ok" | "fallback" | null — set after each fetch so callers can inspect.
window._liveHistoryStatus = window._liveHistoryStatus || null;

// ── Range → CoinGecko "days" parameter ───────────────────────────────────
// 'all' is intentionally absent — it uses cost-basis comparison, not a
// time-boxed chart, so falling back to local history is correct.
const RANGE_DAYS = {
  '24h': 1,
  '7d':  7,
  '30d': 30,
  '1y':  365,
};

// ── Fetch raw price history for a single coin ─────────────────────────────
// Returns the same shape CoinGecko emits — proxied via /api/prices/history
// so the browser never talks to providers directly.
async function fetchHistory(id, days) {
  // AURIX-APP-DOMAIN-READY-1: API origin from the single source of truth
  // (window.AURIX_API_BASE); default = current Vercel project during migration.
  const _apiBase = (typeof window !== 'undefined' && typeof window.AURIX_API_BASE === 'string')
    ? window.AURIX_API_BASE
    : 'https://demo-api.aurix.invalid';
  const res = await fetch(
    `${_apiBase}/api/prices/history` +
    `?id=${encodeURIComponent(id)}&days=${encodeURIComponent(days)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (res.status === 429) throw new Error('rate_limit');
  if (!res.ok)            throw new Error(`http_${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.prices) ? data.prices : []; // [[ts_ms, usd_price], ...]
}

// ── Time-grid normalisation ───────────────────────────────────────────────
// CoinGecko returns slightly different timestamps per coin (e.g. one coin at
// 14:02:07, another at 14:03:54 for the same nominal 5-min candle).  Rounding
// to the nearest 5-minute bucket ensures cross-coin timestamps align so the
// additive merge doesn't create phantom spikes.
const INTERVAL = 5 * 60 * 1000; // 5 minutes in ms

function normalizeTime(ts) {
  return Math.floor(ts / INTERVAL) * INTERVAL;
}

// ── Merge per-coin value timelines into a single portfolio timeline ────────
function mergeHistories(histories) {
  const buckets = {};

  histories.forEach(h => {
    h.forEach(({ time, value }) => {
      const t = normalizeTime(time);
      buckets[t] = (buckets[t] || 0) + value;
    });
  });

  return Object.entries(buckets)
    .map(([time, value]) => ({ ts: Number(time), value: +value.toFixed(2) }))
    .sort((a, b) => a.ts - b.ts);
}

// ── Spike / outlier removal ────────────────────────────────────────────────
// Drops any point where the portfolio value jumps by more than 50% relative
// to the previous accepted point.  This removes artefacts from missing data
// or misaligned merges without touching genuine large-but-real moves.
function removeOutliers(data) {
  if (data.length < 2) return data;
  const cleaned = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const prev   = cleaned[cleaned.length - 1];
    const curr   = data[i];
    const change = prev.value > 0
      ? Math.abs(curr.value - prev.value) / prev.value
      : 0;
    if (change < 0.5) cleaned.push(curr);
  }
  return cleaned;
}

// ── Series-level validation gate ─────────────────────────────────────────
// Returns false if the data is too sparse OR if any consecutive pair still
// contains a >50% jump.  After removeOutliers the second condition should
// never fire; the length check catches cases where too many points were
// dropped, leaving a series too thin to render meaningfully.
function isValidSeries(data) {
  if (!data || data.length < 10) return false;
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (!prev.value || !curr.value) return false;
    const change = Math.abs(curr.value - prev.value) / prev.value;
    if (change > 0.5) return false;
  }
  return true;
}

// ── Compute absolute and % PnL over a data series ─────────────────────────
function calculatePnL(data) {
  if (!data || data.length < 2) return null;
  const first = data[0].value;
  const last  = data[data.length - 1].value;
  if (first <= 0) return null;
  return {
    absolute:   +(last - first).toFixed(2),
    percentage: +((last - first) / first * 100).toFixed(2),
  };
}

// ── Fetch and merge historical portfolio value for a given range ───────────
// Returns [{ts, value}] in USD, or null if no crypto assets / fetch fails.
async function fetchPortfolioHistory(range) {
  const days = RANGE_DAYS[range];
  if (!days) return null;

  if (typeof assets === 'undefined') return null;
  const cryptos = assets.filter(a => a.type === 'crypto' && a.coinId && a.qty > 0);
  if (!cryptos.length) return null;

  let fulfilled;
  try {
    const results = await Promise.allSettled(
      cryptos.map(async a => {
        const prices = await fetchHistory(a.coinId, days);
        // Sort ascending before mapping so normalizeTime buckets fill correctly.
        prices.sort((a, b) => a[0] - b[0]);
        return prices.map(([time, price]) => ({ time, value: price * a.qty }));
      })
    );
    fulfilled = results
      .filter(r => r.status === 'fulfilled' && r.value.length > 0)
      .map(r => r.value);
  } catch (e) {
    console.warn('History fetch failed', e);
    return null;
  }

  if (!fulfilled.length) return null;

  const raw     = mergeHistories(fulfilled);
  const cleaned = removeOutliers(raw);

  // Validation gate: only use the cleaned series if it passes the full check.
  // If it does not (too sparse, or residual spikes), fall back to the raw merge
  // so the chart still renders something rather than silently going blank.
  if (isValidSeries(cleaned)) {
    window._liveHistoryStatus = 'ok';
    return cleaned;
  }

  console.warn('[history] Invalid chart data — using fallback');
  window._liveHistoryStatus = 'fallback';
  return raw.length >= 2 ? raw : null;
}

// ── Load history for a range, cache it, and refresh the chart ─────────────
async function loadHistoryForRange(range) {
  if (!RANGE_DAYS[range]) return; // 'all' — no CoinGecko equivalent

  // Serve from cache on subsequent clicks (no re-fetch needed)
  if (window._liveHistory[range]) {
    if (typeof updateChart     === 'function') updateChart(true);
    if (typeof updatePerformance === 'function') updatePerformance();
    return;
  }

  try {
    const data = await fetchPortfolioHistory(range);
    if (data && data.length >= 2) {
      window._liveHistory[range] = data;
      if (typeof updateChart     === 'function') updateChart(true);
      if (typeof updatePerformance === 'function') updatePerformance();
    }
  } catch {
    // Silently fall back to local history on network / rate-limit errors.
  }
}

// ── Hook into range buttons ───────────────────────────────────────────────
// Adds a second listener alongside the existing one in app.js.  Both fire
// on each click; the existing listener updates activeRange and renders local
// data immediately, then this one updates the chart again once CoinGecko
// data arrives (or instantly if already cached).
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => loadHistoryForRange(btn.dataset.range));
});

// ── Bootstrap: fetch the initial active range on page load ────────────────
// app.js has already executed by this point, so all globals are available.
if (typeof activeRange !== 'undefined') {
  loadHistoryForRange(activeRange);
}
