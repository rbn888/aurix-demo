/* ─────────────────────────────────────────────────────────────────
   AurixChartCore — CHART-2 isolated prototype.

   ONE chart engine, MANY surfaces (future). Today: prototype only.

   Public API (attached to window.AurixCharts):
     createChart(container, options) → controller
     createSparkline(container, options) → controller    // sugar for variant: 'sparkline'
     createMockSeries(opts) → AurixSeries
     mountDemo() / destroyDemo()
     isReady() → boolean   (LightweightCharts loaded?)

   Controller contract:
     setData(series, meta?) | setRange(range) | setCurrency(currency)
     setState(state)        | resize()        | destroy()

   No production surface is touched by this module. The legacy Chart.js
   instances and SVG sparklines continue to render as before.
   ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── Theme tokens ────────────────────────────────────────────────
  // AURIX-CHARTS-2 — premium palette. Line is now slightly desaturated
  // for a calmer Apple-Stocks / Bloomberg-lite look; area gradient
  // alphas tuned down so the fill reads as breath, not as neon glow.
  // A dedicated `flat` pair handles the post-reset baseline so the
  // neutral state never reuses up/down hue.
  const THEME = Object.freeze({
    bg:        'transparent',
    text:      'rgba(220, 230, 250, 0.42)',
    textHi:    'rgba(225, 233, 255, 0.92)',
    line:      'rgba(138, 166, 255, 0.92)',          // Aurix blue
    lineUp:    'rgba(63, 191, 127, 0.94)',           // emerald
    lineDown:  'rgba(224, 90, 90, 0.94)',            // refined red
    lineFlat:  'rgba(180, 196, 224, 0.78)',          // calm gray-blue
    areaTop:   'rgba(138, 166, 255, 0.22)',
    areaBot:   'rgba(138, 166, 255, 0.00)',
    areaTopUp: 'rgba(63, 191, 127, 0.18)',
    areaTopDn: 'rgba(224, 90, 90, 0.16)',
    areaTopFlat:'rgba(180, 196, 224, 0.10)',
    grid:      'rgba(255, 255, 255, 0.035)',
    crosshair: 'rgba(138, 166, 255, 0.42)',
    border:    'rgba(255, 255, 255, 0.06)',
  });

  // ── Internal state ──────────────────────────────────────────────
  const _instances = new Set();
  let _stylesInjected = false;
  let _libLoadWarned  = false;

  function _isLangEs() {
    try {
      return (typeof lang !== 'undefined' && lang === 'es')
          || String(document.documentElement.lang || '').toLowerCase().startsWith('es');
    } catch (_) { return false; }
  }

  function _isReady() {
    return typeof window !== 'undefined'
        && typeof window.LightweightCharts === 'object'
        && typeof window.LightweightCharts.createChart === 'function';
  }

  // ── Inject scoped styles for chart chrome (states, badges, etc.).
  //    Self-contained inside this module so the engine is genuinely
  //    isolated — no styles.css edits.
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = `
      .aurix-chart-host { position: relative; width: 100%; min-height: 0; overflow: hidden; }
      .aurix-chart-host[data-variant="sparkline"] { min-height: 0; }
      .aurix-chart-canvas { position: absolute; inset: 0; }
      .aurix-chart-state {
        position: absolute; inset: 0;
        display: none;
        align-items: center; justify-content: center;
        pointer-events: none;
        font-family: inherit;
        font-size: 12.5px;
        color: rgba(220,230,250,0.55);
        letter-spacing: 0.005em;
        text-align: center;
        padding: 12px;
      }
      /* AURIX-CHART-RELIABILITY-GATE-1 · PARTE C — premium "building history"
         surface. Stacked, centered, calm. Reads as reassurance, not error. */
      .aurix-chart-state--rich {
        flex-direction: column;
        gap: 6px;
        padding: 16px 22px;
        max-width: 340px;
        margin: 0 auto;
      }
      .aurix-chart-state--rich .aurix-empty-title {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: rgba(228,235,255,0.90);
      }
      .aurix-chart-state--rich .aurix-empty-body {
        font-size: 12px;
        line-height: 1.45;
        color: rgba(214,225,248,0.62);
      }
      .aurix-chart-state--rich .aurix-empty-note {
        font-size: 11px;
        line-height: 1.4;
        color: rgba(200,212,238,0.40);
      }
      /* AURIX-CHART-PREMIUM-POLISH-WEB-MOBILE — discreet building microcopy. Pinned
         to the bottom-left, low-contrast, single line. Sits over the calm ghost
         grid (loading skin) so the 'building' state reads as a quiet financial
         placeholder, never a dominant text block in the middle of the chart. */
      .aurix-chart-state--note {
        align-items: flex-end;
        justify-content: flex-start;
        padding: 0 14px 12px;
      }
      .aurix-coverage-note {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 11.5px;
        letter-spacing: 0.01em;
        color: rgba(210,222,245,0.52);
      }
      .aurix-coverage-note::before {
        content: '';
        width: 5px; height: 5px;
        border-radius: 50%;
        background: rgba(138,166,255,0.6);
        box-shadow: 0 0 6px rgba(138,166,255,0.45);
      }
      .aurix-chart-host[data-state="loading"] .aurix-chart-state--loading,
      .aurix-chart-host[data-state="empty"]   .aurix-chart-state--empty,
      .aurix-chart-host[data-state="error"]   .aurix-chart-state--error {
        display: flex;
      }
      .aurix-chart-host[data-state="loading"] .aurix-chart-canvas,
      .aurix-chart-host[data-state="empty"]   .aurix-chart-canvas,
      .aurix-chart-host[data-state="error"]   .aurix-chart-canvas {
        opacity: 0.0;
      }
      /* AURIX-CHART-FINAL-UX-MICROFIX — the loading state must NOT show a central
         rectangle/box. Full-bleed, borderless, ULTRA-subtle shimmer integrated
         into the chart background instead. (The caller shows the per-range
         last-good line when one exists, so this only ever appears on the very
         first paint of a session — never as a flash on refresh.) Visual only:
         the loading LOGIC is unchanged. */
      .aurix-chart-skeleton {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(
          90deg,
          rgba(255,255,255,0.010) 0%,
          rgba(138,166,255,0.020) 50%,
          rgba(255,255,255,0.010) 100%
        );
        background-size: 200% 100%;
        animation: aurix-chart-shimmer 2.2s linear infinite;
      }
      /* AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — custom DOM X-axis for the portfolio
         surface. LWC's native time scale offers too few/uneven ticks on the
         densified series (often a single label), so we suppress the native labels
         and paint our own evenly-spaced, range-aware marks (real dates/times). */
      .aurix-xaxis {
        position: absolute; left: 0; right: 0; bottom: 0; height: 18px;
        pointer-events: none; z-index: 2;
      }
      .aurix-xaxis-label {
        position: absolute; bottom: 1px;
        font-size: 10px; line-height: 1;
        color: rgba(220,230,250,0.42);
        white-space: nowrap; font-variant-numeric: tabular-nums;
        transform: translateX(-50%);
      }
      .aurix-xaxis-label.edge-l { transform: none; }
      .aurix-xaxis-label.edge-r { transform: none; }
      /* AURIX-CHART-LINE-PREMIUM-DETAIL-PASS — live end-dot. Colour + halo are set
         inline (matched to the line); this owns size, centring and stacking. It is
         pointer-events:none so it never intercepts touch / swipe. */
      .aurix-chart-endpoint {
        position: absolute;
        width: 7px; height: 7px;
        margin-left: -3.5px; margin-top: -3.5px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 3;
        will-change: left, top;
      }
      @keyframes aurix-chart-shimmer {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }
      .aurix-chart-badge {
        position: absolute;
        top: 8px; right: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(225,233,255,0.78);
        background: rgba(138,166,255,0.10);
        border: 1px solid rgba(138,166,255,0.22);
        pointer-events: none;
      }
      .aurix-chart-badge[hidden] { display: none; }
      /* AURIX-CHARTS — the permanent mobile value chip was removed.
         Per spec the current value must surface only via the touch /
         long-press tooltip path, never as an always-on overlay. The
         tooltip styles below carry that responsibility. */
      .aurix-chart-tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 4;
        min-width: 100px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(14,18,28,0.92);
        border: 1px solid rgba(255,255,255,0.07);
        box-shadow: 0 12px 28px -16px rgba(4,8,16,0.85);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        font-family: inherit;
        font-size: 12px;
        color: rgba(225,233,255,0.92);
        opacity: 0;
        transform: translate(-50%, -100%) translateY(-8px);
        transition: opacity 0.12s ease;
      }
      .aurix-chart-tooltip[data-visible="true"] { opacity: 1; }
      .aurix-chart-tooltip-time {
        font-size: 10.5px;
        color: rgba(220,230,250,0.55);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin-bottom: 2px;
      }
      .aurix-chart-tooltip-value {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.005em;
        font-variant-numeric: tabular-nums;
      }
      .aurix-chart-tooltip-value.is-up   { color: #3FBF7F; }
      .aurix-chart-tooltip-value.is-down { color: #E05A5A; }
      .aurix-chart-tooltip-pct {
        margin-top: 2px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.01em;
        font-variant-numeric: tabular-nums;
        color: rgba(220,230,250,0.55);
      }
      .aurix-chart-tooltip-pct.is-up   { color: #3FBF7F; }
      .aurix-chart-tooltip-pct.is-down { color: #E05A5A; }
      /* CHART-CORE: subtle "smoothed point" indicator, only when the
         active crosshair sits over a visually normalized point. */
      .aurix-chart-tooltip-note {
        margin-top: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(220,230,250,0.50);
      }
      .aurix-chart-tooltip-note[hidden] { display: none; }
      /* CHART-4B: belt-and-braces watermark suppression. The 4.x
         attributionLogo:false option is the primary defence; this
         covers any LWC build that ignores it or any DOM element the
         library injects with a recognisable id/href. Scoped strictly
         inside .aurix-chart-host so no global selector is touched. */
      .aurix-chart-host a[href*="tradingview"],
      .aurix-chart-host #tv-attr-logo,
      .aurix-chart-host [id^="tv-attr"] {
        display: none !important;
        pointer-events: none !important;
      }
      /* CHART-4C hotfix: hard touch lock on the dashboard slider while
         the chart is in inspection mode. stopPropagation in the state
         machine already prevents the slider's listeners from running,
         but touch-action:none is the browser-level guarantee that no
         native gesture (pull-to-refresh, scroll, pinch) reclaims the
         finger. Scoped to the explicit attribute we set on enter. */
      [data-chart-inspecting="1"],
      [data-chart-inspecting="1"] * {
        touch-action: none !important;
      }
      .aurix-chart-ranges {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .aurix-chart-range {
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: rgba(220,230,250,0.6);
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 999px;
        cursor: pointer;
        font-family: inherit;
        transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      }
      .aurix-chart-range:hover {
        color: rgba(225,233,255,0.92);
        border-color: rgba(138,166,255,0.22);
        background: rgba(138,166,255,0.06);
      }
      .aurix-chart-range[aria-pressed="true"] {
        color: #fff;
        border-color: rgba(138,166,255,0.45);
        background: rgba(138,166,255,0.14);
      }
      .aurix-chart-sandbox {
        display: grid;
        grid-template-columns: 1fr;
        gap: 22px;
        padding: 22px;
        background: rgba(8,12,20,0.92);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 18px;
        color: rgba(225,233,255,0.92);
      }
      .aurix-chart-sandbox h4 {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(220,230,250,0.55);
        margin-bottom: 10px;
      }
      .aurix-chart-sandbox .demo-card {
        padding: 16px;
        border-radius: 14px;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.05);
      }
      .aurix-chart-sandbox .demo-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .aurix-chart-sandbox .demo-row .demo-card { flex: 1; }
    `;
    const style = document.createElement('style');
    style.dataset.aurixChartCore = '1';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Mock series generator (CHART-2 only) ───────────────────────
  // Deterministic-ish random walk; intentionally NOT a hard seed so
  // each call shows a slightly different shape. No business logic.
  function createMockSeries(opts) {
    const o = opts || {};
    const range  = o.range  || '7d';
    const trend  = (typeof o.trend === 'number') ? o.trend : 0.0008;
    const base   = (typeof o.base  === 'number') ? o.base  : 18450;
    const points = ({ '24h': 96, '7d': 168, '30d': 180, '3m': 180, '1y': 220, 'all': 250 })[range] || 168;
    const spanMs = ({ '24h': 24*3600e3, '7d': 7*86400e3, '30d': 30*86400e3, '3m': 90*86400e3, '1y': 365*86400e3, 'all': 730*86400e3 })[range] || 7*86400e3;
    const now    = Date.now();
    const step   = spanMs / points;
    let v = base;
    const series = [];
    for (let i = 0; i < points; i++) {
      const t = now - spanMs + i * step;
      const drift  = (Math.random() - 0.48) * base * 0.006;
      const trendy = base * trend * i;
      v = Math.max(1, v + drift + trendy * 0.02);
      series.push({ time: t, value: +v.toFixed(2) });
    }
    return {
      series,
      meta: {
        source: 'mock',
        currency: 'USD',
        asOf: now,
        granularity: range === '24h' ? '15m' : '1h',
        isSynthetic: true,
        completeness: 1,
      },
    };
  }

  // ── CHART-CORE: visual series normalizer ───────────────────────
  // Detects isolated spikes via rolling MAD + spike-revert check and
  // optionally light-smooths the long-range series. Pure visual layer:
  // NEVER mutates the caller's raw data — operates on a defensive copy
  // and exposes `normalizedTimes` so the tooltip can flag suavizado
  // points and the badge can read "Vista optimizada" when at least one
  // outlier was corrected.
  //
  // Sustained moves (deposits / withdrawals / regime changes) are
  // preserved: the spike-revert rule only triggers when BOTH neighbors
  // are close to the rolling median. First and last points are never
  // altered so the chart endpoint always matches the live KPI.
  const _SMOOTH_WIN_BY_RANGE = Object.freeze({
    '24h': 0,
    '7d':  1,
    '30d': 1,
    '3m':  2,
    '1y':  3,
    'all': 3,
  });
  function _normalizeSeries(rawPoints, cfg, range) {
    const summary = { outliers: 0, smoothed: 0 };
    const normalizedTimes = new Set();
    if (!Array.isArray(rawPoints) || rawPoints.length < 6 || !cfg) {
      return { visual: rawPoints || [], normalizedTimes, summary };
    }

    // Defensive copy so the caller's array is never mutated.
    let visual = rawPoints.map(p => ({ time: p.time, value: p.value }));
    const N = visual.length;

    // ── Pass 1: outlier detection + interpolation ─────────────────
    if (cfg.outlierFilter !== false) {
      const WIN = 4;  // 4 neighbours on each side → up to 9-point window
      const vals = visual.map(p => p.value);
      for (let i = 1; i < N - 1; i++) {
        const lo = Math.max(0, i - WIN);
        const hi = Math.min(N, i + WIN + 1);
        // Exclude the candidate itself from its own window.
        const window = [];
        for (let k = lo; k < hi; k++) {
          if (k !== i) window.push(vals[k]);
        }
        if (window.length < 4) continue;
        const sorted = window.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (!Number.isFinite(median) || median <= 0) continue;
        // Median absolute deviation around the median.
        const devs = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
        const mad = devs[Math.floor(devs.length / 2)] || 0;
        // Threshold floors at 8% of median to avoid flagging normal
        // small wiggles; MAD floor handles low-volatility ranges.
        const threshold = Math.max(mad * 6, median * 0.08);

        const v = vals[i];
        const devCur = Math.abs(v - median);
        if (devCur <= threshold) continue;

        // Spike-revert check: both neighbours must be CLOSE to the
        // rolling median for the candidate to count as isolated.
        // A sustained jump (deposit, regime change) will see at least
        // one neighbour also far from the old median → kept.
        const prev = vals[i - 1];
        const next = vals[i + 1];
        const prevDev = Math.abs(prev - median);
        const nextDev = Math.abs(next - median);
        if (prevDev >= threshold * 0.7 || nextDev >= threshold * 0.7) continue;

        // Interpolate. Keep the same `time` so LWC's x-axis is intact.
        const interpolated = (prev + next) / 2;
        visual[i] = { time: visual[i].time, value: interpolated };
        normalizedTimes.add(visual[i].time);
        vals[i] = interpolated;  // so subsequent windows see the cleaned value
        summary.outliers++;
      }
    }

    // ── Pass 2: conservative smoothing ─────────────────────────────
    if (cfg.smoothing !== false) {
      const win = _SMOOTH_WIN_BY_RANGE[range || '7d'] || 0;
      if (win > 0 && visual.length >= win * 2 + 3) {
        const smoothed = visual.map((p, i) => {
          // Anchor first + last exactly (no end-distortion, chart
          // endpoint must equal the actual current value).
          if (i === 0 || i === visual.length - 1) return p;
          const lo = Math.max(0, i - win);
          const hi = Math.min(visual.length, i + win + 1);
          let sum = 0, count = 0;
          for (let k = lo; k < hi; k++) { sum += visual[k].value; count++; }
          return { time: p.time, value: count ? (sum / count) : p.value };
        });
        summary.smoothed = visual.length - 2;
        visual = smoothed;
      }
    }

    return { visual, normalizedTimes, summary };
  }

  // ── Internal helpers ───────────────────────────────────────────
  function _msToSec(ms) { return Math.floor(ms / 1000); }

  // AURIX-CHART-AXIS-1 — range-aware X-axis tick label, in the user's LOCAL
  // timezone. `Date` + `toLocale*` are local by construction (no UTC assumption,
  // no hardcoded offset). Replaces LWC's default mixed output (a bare day number
  // "5" interleaved with times like "17:00"). Pure display — never touches data.
  //   24H            → HH:mm
  //   7D / 30D / 3M  → "5 jun"  (day + short month)
  //   6M / YTD / 1Y / TOTAL → "jun 26" (short month + 2-digit year)
  function _formatAxisTick(time, range, locale) {
    try {
      let ms;
      if (typeof time === 'number') {
        ms = time * 1000;                                   // UTCTimestamp (seconds)
      } else if (time && typeof time === 'object' && time.year) {
        ms = new Date(time.year, (time.month || 1) - 1, time.day || 1).getTime(); // BusinessDay
      } else {
        ms = Date.parse(time);
      }
      if (!Number.isFinite(ms)) return '';
      const d   = new Date(ms);
      const loc = _isLangEs() ? 'es-ES' : (locale || 'en-US');
      const r   = String(range || '').toLowerCase();
      if (r === '24h') {
        // AURIX-CHART-AXIS-2 — professionalize the 24H axis: snap the LABEL to the
        // nearest whole hour so the marks read as clean human times (08:00 · 12:00
        // · 16:00 …) instead of the raw, irregular snapshot minutes (22:39 · 07:56).
        // Data is untouched — no point is moved, added or interpolated; this is an
        // axis guide only and the crosshair tooltip still shows the exact minute.
        // Local timezone (Date + toLocale*). Adjacent ticks that round to the same
        // hour are de-duped by the per-instance tickMarkFormatter wrapper.
        const h = new Date(ms);
        if (h.getMinutes() >= 30) h.setHours(h.getHours() + 1);
        h.setMinutes(0, 0, 0);
        return h.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
      }
      if (r === '7d' || r === '30d' || r === '3m') {
        return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });   // "6 jun"
      }
      // AURIX-CHART-FINAL-UX-MICROFIX — 1A reads as clean months ("jul · sep · …");
      // TOTAL keeps the year so multi-year spans never collide ("jun 25").
      if (r === '1y') {
        return d.toLocaleDateString(loc, { month: 'short' });                   // "jun"
      }
      return d.toLocaleDateString(loc, { month: 'short', year: '2-digit' });    // "jun 25"
    } catch (_) { return ''; }
  }
  // AURIX-CHART-FINAL-UX-MICROFIX — per-range bucket key for the axis label
  // thinner. One label is emitted per bucket (first tick wins), which gives an
  // even, capped set of labels per range AND removes repeats — without snapping
  // or moving any tick (the label still sits at its real time; data untouched).
  //   24H → 4-hour blocks (≤6)   7D → day (≤7)   30D → week (≤5)
  //   1A  → 2-month blocks (≤6)  TOTAL → month
  function _axisBucketKey(ms, r) {
    const d = new Date(ms);
    if (r === '24h') {
      // AURIX-CHART-PREMIUM-POLISH-WEB-MOBILE — local-aligned absolute 4-hour blocks
      // (…00/04/08/12/16/20) → up to ~6 evenly-spaced hour labels across the window
      // instead of an over-thinned, lopsided 3 (e.g. "18:00 · 10:00 · 15:00"). The
      // labels stay at their real tick times (no point moved) and read as a clean
      // ascending time-of-day progression. LWC still decides which ticks to place;
      // this only governs how many we keep per block.
      const localMs = ms - d.getTimezoneOffset() * 60000;
      return Math.floor(localMs / (4 * 3600000));
    }
    if (r === '7d')  return d.toDateString();
    if (r === '30d' || r === '3m') return Math.floor(ms / (7 * 86400000));
    if (r === '1y')  return d.getFullYear() * 6 + Math.floor(d.getMonth() / 2);
    return d.getFullYear() * 12 + d.getMonth();   // all / default → month
  }

  function _formatTooltipTime(ms, range, variant) {
    try {
      const d   = new Date(ms);                             // local timezone
      const loc = _isLangEs() ? 'es-ES' : 'en-US';
      const r   = String(range || '').toLowerCase();
      // AURIX-CHART-AXIS-1 — the richer time/date tooltip copy is SCOPED to the
      // portfolio surface. Asset / Market (variant 'asset') keep the prior copy
      // → byte-identical, Market untouched.
      if (variant !== 'portfolio') {
        if (r === '24h') return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
        if (r === '7d')  return d.toLocaleDateString(loc, { weekday: 'short', day: '2-digit' });
        return d.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
      }
      const hm = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
      if (r === '24h') {
        // "Hoy, 17:04" when the point is on the current local day; otherwise keep
        // the date so a 24h window that crosses midnight stays unambiguous.
        const now = new Date();
        const sameDay = d.getFullYear() === now.getFullYear()
                     && d.getMonth()    === now.getMonth()
                     && d.getDate()     === now.getDate();
        if (sameDay) return (_isLangEs() ? 'Hoy, ' : 'Today, ') + hm;
        return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ', ' + hm;
      }
      if (r === '7d' || r === '30d' || r === '3m') {
        return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ', ' + hm;
      }
      // 1A / TOTAL (+ 6M/YTD) → full date, no time (the bucket is a day, not a minute).
      return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return ''; }
  }

  function _formatTooltipValue(value, currency) {
    try {
      // PORTFOLIO-CHART-FIX-3: keep the tooltip precise (2 decimals) and
      // locale-consistent with the axis. Locale follows the CURRENCY so EUR
      // reads "5.432,18 €" and USD reads "$5,432.18" regardless of UI lang.
      const cur    = (currency || 'USD').toUpperCase() === 'EUR' ? 'EUR' : 'USD';
      const locale = cur === 'EUR' ? 'es-ES' : 'en-US';
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: cur,
        useGrouping: 'always',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch (_) { return String(value); }
  }

  // ── Chart factory ──────────────────────────────────────────────
  function createChart(container, options) {
    _injectStyles();
    const opts = Object.assign({
      variant:        'portfolio',  // 'portfolio' | 'asset' | 'sparkline' | 'mini'
      height:         null,
      currency:       'USD',
      showTooltip:    true,
      showCrosshair:  true,
      showTimeScale:  true,
      showPriceScale: true,
      colorMode:      'auto',       // 'auto' | 'positive' | 'negative' | 'neutral'
      compact:        false,
      range:          '7d',
      // CHART-4C: opt-in long-press inspection for mobile. When true,
      // the chart stays touch-inert until a stationary press of
      // ~180ms; then a crosshair + tooltip activate while the finger
      // drags. Release returns to inert (page scroll/swipe normal).
      mobileInspection: false,
      // CHART-CORE: visual normalization (outlier filter + smoothing).
      // Opt-in per surface — disabled by default so existing callers
      // (asset detail, demo, sandbox) keep their current behaviour.
      // The dashboard portfolio surface opts in via _aurixDashMount.
      visualNormalization: null,
    }, options || {});

    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('AurixCharts.createChart: container element required');
    }
    if (opts.variant === 'sparkline' || opts.variant === 'mini') {
      opts.showTooltip    = !!options?.showTooltip;
      opts.showCrosshair  = !!options?.showCrosshair;
      opts.showTimeScale  = false;
      opts.showPriceScale = false;
    }

    // AURIX-MOBILE-CHART-PREMIUM-CLOSEOUT — the mobile dashboard chart is the only
    // portfolio surface mounted with long-press inspection (mobileInspection:true);
    // desktop passes false. Used to scope mobile-only presentation (no X axis,
    // always-curved line, extra bottom Y headroom) without touching desktop.
    const _isMobilePortfolio = opts.variant === 'portfolio' && !!opts.mobileInspection;

    // Host element wraps both the chart canvas and the state overlays.
    const host = document.createElement('div');
    host.className = 'aurix-chart-host';
    host.dataset.variant = opts.variant;
    host.dataset.state   = 'loading';
    if (opts.height) host.style.height = opts.height + 'px';
    else if (opts.variant === 'sparkline') host.style.height = '32px';
    else if (opts.variant === 'mini')      host.style.height = '64px';
    else                                    host.style.height = '240px';

    const canvasHolder = document.createElement('div');
    canvasHolder.className = 'aurix-chart-canvas';
    host.appendChild(canvasHolder);

    const tooltip = document.createElement('div');
    tooltip.className = 'aurix-chart-tooltip';
    tooltip.innerHTML = '<div class="aurix-chart-tooltip-time"></div><div class="aurix-chart-tooltip-value"></div>';
    if (opts.showTooltip) host.appendChild(tooltip);

    const badge = document.createElement('div');
    badge.className = 'aurix-chart-badge';
    badge.hidden = true;
    host.appendChild(badge);

    // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — custom DOM X-axis (portfolio + time
    // scale only). Painted by _renderXAxis from the REAL series; the native LWC
    // labels are suppressed (tickMarkFormatter returns '' for portfolio).
    const xaxis = (opts.variant === 'portfolio' && opts.showTimeScale) ? document.createElement('div') : null;
    if (xaxis) { xaxis.className = 'aurix-xaxis'; host.appendChild(xaxis); }

    // AURIX-CHART-LINE-PREMIUM-DETAIL-PASS — a discreet "live" end-dot at the last
    // point (portfolio surface). Pure presentation: positioned from the rendered
    // coords, pointer-events:none (never steals touch / swipe), shown only in the
    // ready state. Especially valuable on mobile where the axes are hidden.
    // AURIX-FINAL-CHART-POLISH-PASS-V2 — NO permanent end-dot. The line ends clean;
    // the contextual marker comes only from the LWC crosshair on hover / long-press.
    const endpoint = null;

    // AURIX-CHARTS — mobile current-value chip removed. The value must
    // only surface on user interaction (long-press → tooltip), never as
    // a permanent overlay on the chart. The chip element is kept null
    // here so all downstream guards (`if (_shouldShowValChip)`) become
    // no-ops; the tooltip path is unchanged.
    const valchip = null;
    const _shouldShowValChip = false;

    const loading = document.createElement('div');
    loading.className = 'aurix-chart-state aurix-chart-state--loading';
    loading.innerHTML = '<div class="aurix-chart-skeleton"></div>';
    host.appendChild(loading);

    const empty = document.createElement('div');
    empty.className = 'aurix-chart-state aurix-chart-state--empty';
    // AURIX-CHARTS-2 — portfolio empty surface reads as a calm
    // invitation, not a "no data" error. Other variants (asset /
    // sparkline / mini) keep the neutral fallback because their
    // host containers don't carry their own placeholder overlay.
    if (opts.variant === 'portfolio') {
      empty.textContent = _isLangEs()
        ? 'Tu evolución aparecerá aquí cuando añadas activos.'
        : 'Your evolution will appear here when you add assets.';
    } else {
      empty.textContent = _isLangEs() ? 'Sin datos disponibles' : 'No data available';
    }
    host.appendChild(empty);

    // AURIX-CHARTS-PREMIUM-REFINEMENT-1 · Block 7 — the portfolio empty surface
    // tells two different stories: a brand-new portfolio ("your evolution will
    // appear here") vs one that already has assets but not enough history yet
    // ("building history"). setData picks the copy via meta.emptyReason. Scoped
    // to the portfolio variant; other variants keep their neutral fallback.
    // AURIX-CHART-RELIABILITY-GATE-1 · PARTE A/C — the "building history" surface
    // is now a premium, reassuring multi-line state (title + body + note) so a
    // gated TOTAL/1A range reads as "we're generating your history", never as an
    // error or a crash. Other reasons + non-portfolio variants keep the calm
    // single-line copy. Built with DOM text nodes (no innerHTML / no injection).
    function _applyEmptyCopy(reason) {
      if (opts.variant !== 'portfolio') return;
      const es = _isLangEs();
      empty.textContent = '';
      empty.classList.remove('aurix-chart-state--rich');
      if (reason === 'low_data') {
        // AURIX-CHART-PREMIUM-POLISH-WEB-MOBILE — building is now DISCREET, never a
        // dominant block. A single low-key microcopy pinned to the bottom-left, on
        // top of the calm ghost-grid loading skin (which stays visible behind the
        // transparent host in the 'building' state). No title, no long paragraph,
        // no half-chart text mass. Only ever shown for genuine 0/1-point ranges.
        empty.classList.add('aurix-chart-state--note');
        const note = document.createElement('div');
        note.className = 'aurix-coverage-note';
        note.textContent = es ? 'Generando histórico fiable' : 'Building reliable history';
        empty.appendChild(note);
      } else {
        empty.classList.remove('aurix-chart-state--note');
        empty.textContent = es
          ? 'Tu evolución aparecerá aquí cuando añadas activos.'
          : 'Your evolution will appear here when you add assets.';
      }
    }

    const errorEl = document.createElement('div');
    errorEl.className = 'aurix-chart-state aurix-chart-state--error';
    errorEl.textContent = _isLangEs() ? 'No se pudo cargar el gráfico' : 'Chart could not be loaded';
    host.appendChild(errorEl);

    container.appendChild(host);

    // Bail out gracefully if the library never loaded — the consumer
    // still gets a controller with a sane API, but the surface shows
    // the error state and console.warn fires exactly once.
    if (!_isReady()) {
      if (!_libLoadWarned) {
        _libLoadWarned = true;
        console.warn('[AurixCharts] LightweightCharts not loaded — engine running in fallback (state=error).');
      }
      host.dataset.state = 'error';
      const controller = {
        host,
        setData: () => {},
        setRange: () => {},
        setCurrency: () => {},
        setState: (s) => { if (s) host.dataset.state = s; },
        resize: () => {},
        destroy: () => {
          if (host.parentNode) host.parentNode.removeChild(host);
          _instances.delete(controller);
        },
      };
      _instances.add(controller);
      return controller;
    }

    // ── Build the Lightweight Charts instance ───────────────────
    const LWC = window.LightweightCharts;
    // CHART-4B: premium compact currency formatter for the right axis
    // and any LWC-driven numeric output. State is kept in a closure so
    // setCurrency() rebinds it without recreating the chart.
    let _formatterCurrency = (opts.currency || 'USD').toUpperCase();
    // PORTFOLIO-CHART-FIX-3: premium, locale-consistent axis formatter.
    // Locale follows the CURRENCY (EUR→es-ES, USD→en-US) so we never mix an
    // "€5.4K" style with es-ES numbers. Below 1M shows whole grouped units
    // with NO K (EUR "5.400 €", USD "$5,400"); at/above 1M shows compact
    // millions (EUR "1,2 M €", USD "$1.2M"). Sub-1000 values keep up to 2
    // decimals so low-value asset/sparkline series stay readable.
    const _compactCurrency = (value, currency) => {
      const cur = (currency || _formatterCurrency) === 'EUR' ? 'EUR' : 'USD';
      if (!Number.isFinite(value)) return '';
      const locale = cur === 'EUR' ? 'es-ES' : 'en-US';
      const abs = Math.abs(value);
      try {
        if (abs >= 1_000_000) {
          return new Intl.NumberFormat(locale, {
            style: 'currency', currency: cur,
            notation: 'compact', compactDisplay: 'short',
            minimumFractionDigits: 0, maximumFractionDigits: 1,
          }).format(value);
        }
        return new Intl.NumberFormat(locale, {
          style: 'currency', currency: cur,
          useGrouping: 'always',
          minimumFractionDigits: 0,
          maximumFractionDigits: abs >= 1_000 ? 0 : 2,
        }).format(value);
      } catch (_) {
        const sym = cur === 'EUR' ? '€' : '$';
        return sym + value.toFixed(2);
      }
    };
    const _priceFormatter = v => _compactCurrency(v, _formatterCurrency);

    // AURIX-CHART-FINAL-UX-MICROFIX — per-instance, per-render-pass dedup memory
    // for the axis labels. Sets are reset whenever the tick stream restarts
    // (time goes backwards = a new left→right render pass).
    let _axisLastMs = -1;
    let _axisSeenBuckets = null;
    let _axisSeenLabels  = null;

    const chart = LWC.createChart(canvasHolder, {
      width:  canvasHolder.clientWidth  || 320,
      height: canvasHolder.clientHeight || 240,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor:  THEME.text,
        fontFamily: 'inherit',
        // Block 3 (scoped to portfolio): axis labels one step more discreet so
        // they don't compete with the curve, while staying legible on iPhone
        // retina (priority #11/#12). Other variants keep 11 unchanged.
        fontSize:   opts.variant === 'portfolio' ? 10 : 11,
        // CHART-4B: suppress the Lightweight Charts attribution logo so
        // the surface reads as Aurix-native. Library supports this in
        // 4.x; older builds silently ignore the option and we'll catch
        // them via the scoped CSS guard below.
        attributionLogo: false,
      },
      // CHART-4B: pass the compact currency formatter into the chart's
      // localization layer. Right axis ticks and any LWC-default tooltip
      // (we override with our own DOM tooltip) will use it.
      localization: {
        priceFormatter: _priceFormatter,
      },
      grid: {
        // AURIX-WEB-POLISH-1: optional per-instance grid color (desktop dashboard
        // passes a more discrete value so data outshines the guide lines). Falls
        // back to THEME.grid → all other charts byte-identical.
        vertLines: { color: opts.showPriceScale ? ((typeof opts.gridColor === 'string') ? opts.gridColor : THEME.grid) : 'rgba(0,0,0,0)' },
        horzLines: { color: opts.showPriceScale ? ((typeof opts.gridColor === 'string') ? opts.gridColor : THEME.grid) : 'rgba(0,0,0,0)' },
      },
      rightPriceScale: {
        visible: !!opts.showPriceScale,
        borderVisible: false,
        // AURIX-CHART-WEB-SCALE-1 — the dashboard (robustScale) chart now carries
        // its real vertical breathing room in the autoscale domain provider, so
        // here it only needs small SYMMETRIC pixel margins to keep the curve off
        // the literal edges and stop it reading as "pinned to the top". Other
        // charts keep the prior asymmetric margins (byte-identical).
        // AURIX-CHART-AXIS-1 — symmetric label breathing room (real padding lives in
        // the domain provider, so this is purely so the price labels clear the pane).
        // AURIX-CHART-PREMIUM-POLISH-WEB-MOBILE — the TOP right-axis label (e.g.
        // "7.120 €") was being clipped against the pane top on web. Bump the top
        // margin 0.08 → 0.16 so the highest gridline label always sits fully inside
        // the plot; bottom stays tight so the curve keeps its vertical presence.
        scaleMargins: (opts.visualNormalization && opts.visualNormalization.robustScale)
          ? { top: 0.16, bottom: 0.08 }
          : { top: 0.10, bottom: 0.04 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: !!opts.showTimeScale,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        // AURIX-CHART-AXIS-1 — axis polish SCOPED to the portfolio surface
        // (dashboard + category-perf, both variant 'portfolio'). Asset / Market
        // (variant 'asset') and sparkline/mini keep LWC's default labels + edge
        // behaviour → byte-identical, Market untouched.
        //   • AURIX-CHART-FINAL-RENDER-FIX: fixLeftEdge/fixRightEdge are now OFF.
        //     With them ON, LWC framed the visible range to the full first/last BAR
        //     ([-0.5, N-0.5]), re-introducing a half-bar margin on each side that
        //     OVERRODE _fitView's setVisibleLogicalRange([0, N-1]). Invisible on a
        //     dense window (0.5/N ≈ 0) but on a sparse range (30D/1A with few points)
        //     it left the line as a short centred stub. OFF + scroll/scale locked
        //     means the endpoints pin exactly to the plot edges and stay there, so
        //     every range fills the same full width.
        //   • AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT: native LWC time labels are
        //     SUPPRESSED for the portfolio surface (tickMarkFormatter → '') because
        //     LWC offers too few/uneven ticks on the densified series (often a single
        //     label). The bottom strip stays reserved (visible:true) and our own
        //     evenly-spaced DOM axis (_renderXAxis) paints the real range-aware marks.
        ...(opts.variant === 'portfolio' ? {
          fixLeftEdge: false,
          fixRightEdge: false,
          lockVisibleTimeRangeOnResize: false,
          tickMarkFormatter: function () { return ''; },
        } : {}),
      },
      crosshair: opts.showCrosshair
        ? {
            mode: LWC.CrosshairMode ? LWC.CrosshairMode.Magnet : 1,
            vertLine: { color: THEME.crosshair, style: 2, width: 1, labelVisible: false },
            horzLine: { color: THEME.crosshair, style: 2, width: 1, labelVisible: false },
          }
        : { mode: 0 },
      // CHART-4B: sparkline is inert; all other surfaces keep LWC's default
      // interaction. AURIX-CHART-FINAL-RENDER-FIX — the portfolio dashboard framing
      // is enforced programmatically (the [0, N-1] pin in _fitView, re-applied after
      // layout), NOT by locking interaction: locking handleScale also tends to make
      // LWC ignore setVisibleLogicalRange, which is exactly what kept 30D/1A from
      // filling. So interaction stays enabled and the pin is the single source of
      // truth for the framing.
      handleScroll: opts.variant === 'sparkline' ? false : true,
      handleScale:  opts.variant === 'sparkline' ? false : true,
    });

    // AURIX-CHARTS-2 — portfolio surface gets a slightly heavier
    // stroke + larger crosshair marker so the line reads premium on
    // both retina desktop and dense mobile. Sparkline + mini stay
    // razor-thin so they feel like cell glyphs, not micro-charts.
    // AURIX-WEB-POLISH-1: optional per-instance lineWidth override (desktop
    // dashboard passes a slightly heavier stroke). Falls back to the variant
    // defaults → asset/category/sparkline/mobile charts byte-identical.
    const _portfolioLineWidth = (typeof opts.lineWidth === 'number' && opts.lineWidth > 0) ? opts.lineWidth
                              : (opts.variant === 'portfolio') ? 2.25
                              : (opts.variant === 'asset')     ? 2
                              :                                  1.5;
    const _portfolioMarkerR   = (opts.variant === 'portfolio') ? 4
                              : (opts.variant === 'asset')     ? 3
                              :                                  3;

    // AURIX-CHART-WEB-SCALE-1 — institutional Y-axis domain. Opt-in via
    // visualNormalization.robustScale (the dashboard portfolio chart, web AND
    // mobile — so the two surfaces stay coherent by construction, no duplicated
    // logic). LWC's raw autoscale hugs the data min/max, so on a TALL web chart a
    // real intraday drop renders as a near-vertical plunge pinned to the edges,
    // while the SHORTER mobile chart looked calmer with the very same data. This
    // provider reshapes ONLY the visible value domain (never the data):
    //
    //   1. PADDING — expand the domain by a fraction of the visible range
    //      (institutional ~10% each side), with an absolute floor (fraction of
    //      the anchor) so a near-flat series still gets breathing room. The curve
    //      no longer touches the top/bottom and a big move reads clearly without
    //      looking like an artificial cut.
    //   2. MIN DOMAIN WIDTH — for very small real moves, floor the TOTAL domain
    //      width so a +0.1% blip is a gentle ripple, not a wall.
    //
    // It ONLY ever WIDENS the domain → a genuine -5% day is never compressed or
    // hidden, just framed with calm padding. No point is added, moved, removed or
    // interpolated; values are untouched (Fidelity > Aesthetics).
    const _shouldUseMinPadding = !!(opts.visualNormalization && opts.visualNormalization.robustScale);
    const _PAD_FRAC_OF_RANGE   = 0.07;    // AURIX-FINAL-CHART-POLISH-PASS-V2 — less air, more line presence (was 0.10)
    const _PAD_MIN_FRAC_ANCHOR = 0.006;   // absolute floor (0.6% of value) so near-flat ranges aren't zero-padded
    let _scaleHints = null;
    // AURIX-CHART-LINE-RANGE-POLISH — number of points currently plotted, so the
    // view-framing helper can pin the endpoints to the plot edges.
    let _barCount = 0;
    // AURIX-CHART-FINAL-RENDER-FIX — ascending array of the plotted point times (in
    // seconds). Lets the axis thinner select EVENLY-SPACED ticks by POSITION (index)
    // instead of by time bucket — a time bucket collapses to a single label when a
    // sparse range spans only a few days, which is what made 30D/1A axes look bare.
    let _renderTimesSec = null;
    // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — empirically (headless Chrome render of
    // the real engine) Lightweight Charts reserves a structural HALF-BAR margin at
    // each plot edge that NO logical-range trick removes: with N points the first
    // point sits ~1/(2N) in from the edge, so setVisibleLogicalRange([0,N-1]) had no
    // visible effect (it reported [0,N-1] but the render kept fitContent's framing).
    // That is why sparse 30D/1A/TOTAL never filled. The fix is _densifyForDisplay
    // (below): a sparse line is UPSAMPLED along its own real segments so N is large,
    // 1/(2N) ≈ 0 and fitContent fills the width. So _fitView is now simply
    // fitContent for every surface.
    let _fitModeApplied = 'none';
    function _fitView() {
      try { chart.timeScale().fitContent(); _fitModeApplied = 'fitContent'; } catch (_) {}
      try { _renderXAxis(); } catch (_) {}
      try { _renderEndpoint(); } catch (_) {}
    }
    // AURIX-CHART-LINE-PREMIUM-DETAIL-PASS — same rgb, new alpha (for the end-dot halo).
    function _rgbaAlpha(color, a) {
      const m = String(color || '').match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
      return color;
    }
    // Position the live end-dot at the last plotted point, coloured to match the
    // line. Hidden unless the chart is in the ready state with ≥1 real point.
    function _renderEndpoint() {
      if (!endpoint) return;
      try {
        const real = (_state && Array.isArray(_state.data)) ? _state.data : [];
        const N = Array.isArray(_renderTimesSec) ? _renderTimesSec.length : 0;
        const last = real.length ? real[real.length - 1] : null;
        if (host.dataset.state !== 'ready' || !N || !last || !Number.isFinite(last.value)) {
          endpoint.style.display = 'none';
          return;
        }
        const x = chart.timeScale().timeToCoordinate(_renderTimesSec[N - 1]);
        const y = series.priceToCoordinate(last.value);
        if (x == null || y == null) { endpoint.style.display = 'none'; return; }
        endpoint.style.left = x + 'px';
        endpoint.style.top  = y + 'px';
        endpoint.style.background = _lineColorNow;
        endpoint.style.boxShadow = `0 0 0 3px ${_rgbaAlpha(_lineColorNow, 0.18)}, 0 0 11px 1px ${_rgbaAlpha(_lineColorNow, 0.45)}`;
        endpoint.style.display = '';
      } catch (_) { endpoint.style.display = 'none'; }
    }
    // Display-only line densifier. Samples ALONG the existing real segments (linear),
    // so every added point lies exactly on the line already drawn between two real
    // measured points — it adds NO new information and invents NO snapshot. Endpoints
    // stay exactly on real points. The headline + tooltips read the REAL series
    // (_state.data); this only changes how finely the SAME line is sampled so it
    // fills the plot. Applied to the portfolio surface when the series is sparse.
    function _densifyForDisplay(arr) {
      const TARGET = 48;
      if (!Array.isArray(arr) || arr.length < 2 || arr.length >= 24) return arr;
      const t0 = arr[0].time, t1 = arr[arr.length - 1].time, span = t1 - t0;
      if (!(span > 0)) return arr;
      const out = []; let j = 0;
      for (let s = 0; s < TARGET; s++) {
        const t = t0 + span * s / (TARGET - 1);
        while (j < arr.length - 1 && arr[j + 1].time < t) j++;
        const a = arr[j], b = arr[Math.min(j + 1, arr.length - 1)];
        const f = (b.time > a.time) ? Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time))) : 0;
        out.push({ time: Math.round(t), value: a.value + (b.value - a.value) * f });
      }
      for (let i = 1; i < out.length; i++) if (out[i].time <= out[i - 1].time) out[i].time = out[i - 1].time + 1;
      return out;
    }
    // Nearest REAL data point (in _state.data, ms) to a given ms — so tooltips snap
    // to real snapshots even when the visible line was densified for display.
    function _nearestRealPoint(ms) {
      const d = _state && Array.isArray(_state.data) ? _state.data : [];
      let near = null, best = Infinity;
      for (const p of d) {
        if (!p || typeof p.time !== 'number' || typeof p.value !== 'number') continue;
        const diff = Math.abs(p.time - ms);
        if (diff < best) { best = diff; near = p; }
      }
      return near;
    }
    // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — paint the custom DOM X-axis: up to 5
    // evenly-spaced, range-aware marks sampled from the REAL series (start · quarters
    // · end), positioned across the actual plot width (host minus the right price
    // scale). Honest real dates/times; nothing invented. Re-run on data + resize.
    // AURIX-CHART-XAXIS-TIME-1 / AURIX-CHART-XAXIS-PREMIUM-1 — institutional, range-aware
    // time marks within the real [t0,t1] span. Placed by elapsed-time fraction in
    // _renderXAxis (anchored on the two real endpoints' coordinates). Display-only:
    // reads no data, creates no point, never implies history outside [t0,t1].
    //   24H  → round hours (UNCHANGED, founder-approved)
    //   7D/30D → evenly-spaced day+month marks (always include first/last visible day)
    //   1Y/TOTAL → MONTH unit always (month+year + wider steps on long TOTAL spans)
    function _axisTimeTicks(r, t0, t1) {
      const HOUR = 3600000, DAY = 86400000;
      const loc  = _isLangEs() ? 'es-ES' : 'en-US';
      const span = t1 - t0, spanDays = span / DAY;
      const fH  = (ms) => { try { return new Date(ms).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
      const fD  = (ms) => { try { return new Date(ms).toLocaleDateString(loc, { day: 'numeric', month: 'short' }); } catch (_) { return ''; } };
      const fM  = (ms) => { try { return new Date(ms).toLocaleDateString(loc, { month: 'short' }); } catch (_) { return ''; } };
      const fMY = (ms) => { try { return new Date(ms).toLocaleDateString(loc, { month: 'short', year: '2-digit' }); } catch (_) { return ''; } };
      const out = [];
      const add = (ms, label) => { if (label && ms >= t0 - 1000 && ms <= t1 + 1000) out.push({ ms, label }); };
      if (r === '24h') {
        // 24H — founder-approved, UNCHANGED. Round-hour marks aligned to a stepH multiple.
        const spanH = span / HOUR;
        const stepH = spanH <= 4 ? 1 : spanH <= 9 ? 2 : spanH <= 15 ? 3 : 6;
        const d = new Date(t0); d.setMinutes(0, 0, 0);
        d.setHours(Math.ceil(d.getHours() / stepH) * stepH, 0, 0, 0); // align to a stepH multiple from midnight
        while (d.getTime() < t0) d.setHours(d.getHours() + stepH);
        for (let ms = d.getTime(); ms <= t1; ) { add(ms, fH(ms)); const n = new Date(ms); n.setHours(n.getHours() + stepH); ms = n.getTime(); }
      } else if (r === '7d' || r === '30d' || r === '3m') {
        // Day ranges: evenly-spaced (by time) day+month marks. frac 0 / 1 pin the FIRST
        // (t0) and LAST (t1) visible day, so the earliest relevant day (e.g. 6 Jun) never
        // drops; the count scales with the span (young → 2-3 days; a full 30D → ~weekly).
        // Honest — each mark is a real instant inside the visible window.
        const want = (r === '7d') ? 5 : 6;
        const K = Math.max(2, Math.min(want, Math.round(spanDays) + 1));
        for (let k = 0; k < K; k++) { const ms = t0 + span * k / (K - 1); add(ms, fD(ms)); }
      } else {
        // 1Y / TOTAL: MONTH unit always (never loose days, even when history is young).
        // First (partial) month sits at t0; then 1st-of-month boundaries. Long TOTAL
        // escalates to month+year and wider month steps. Marks stay inside the real span.
        const longTotal = (r === 'all' || r === 'total') && spanDays >= 365 * 1.6;
        const fmtM = longTotal ? fMY : fM;
        const stepMo = spanDays >= 365 * 4 ? 12 : spanDays >= 365 * 1.6 ? 3 : spanDays >= 250 ? 2 : 1;
        add(t0, fmtM(t0));
        const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0);
        do { d.setMonth(d.getMonth() + stepMo); } while (d.getTime() <= t0);
        for (; d.getTime() <= t1; d.setMonth(d.getMonth() + stepMo)) add(d.getTime(), fmtM(d.getTime()));
      }
      // Guarantee a drawable axis. Day/24H ranges fall back to day/hour endpoints; month
      // ranges keep the month unit (a single-month span shows that one month).
      if (out.length < 2) {
        const monthRange = (r === '1y' || r === 'all' || r === 'total');
        const f = (r === '24h') ? fH : monthRange ? (((r === 'all' || r === 'total') && spanDays >= 365 * 1.6) ? fMY : fM) : fD;
        const a = f(t0), b = f(t1);
        out.length = 0; add(t0, a); if (b !== a) add(t1, b);
      }
      return out;
    }
    function _renderXAxis() {
      if (!xaxis) return;
      const real = (_state && Array.isArray(_state.data))
        ? _state.data.filter(p => p && Number.isFinite(p.time) && Number.isFinite(p.value) && p.value > 0)
        : [];
      if (real.length < 2 || host.dataset.state !== 'ready') { xaxis.textContent = ''; return; }
      let rightW = 0;
      try { rightW = (chart.priceScale && chart.priceScale('right').width()) || 0; } catch (_) {}
      const plotW = Math.max(0, host.clientWidth - rightW);
      if (plotW < 40) { xaxis.textContent = ''; return; }
      const r  = String((_state && _state.range) || '').toLowerCase();
      const t0 = real[0].time, t1 = real[real.length - 1].time;   // ms
      if (!(t1 > t0)) { xaxis.textContent = ''; return; }
      const ticks = _axisTimeTicks(r, t0, t1);
      // AURIX-CHART-XAXIS-VISIBLE-FIX — place by TIME FRACTION between the two real
      // endpoints' coordinates. timeToCoordinate() returns null for arbitrary times
      // that are not exact bars (round hours rarely are) → querying each tick made the
      // whole axis disappear. The endpoints t0/t1 ARE exact bars, so their coordinate
      // is valid (same call _renderEndpoint relies on); we anchor on them and
      // interpolate ticks by elapsed-time fraction → always visible AND time-spaced.
      const t0s = Math.floor(t0 / 1000), t1s = Math.floor(t1 / 1000);
      let leftX = null, rightX = null;
      try { leftX  = chart.timeScale().timeToCoordinate(t0s); } catch (_) {}
      try { rightX = chart.timeScale().timeToCoordinate(t1s); } catch (_) {}
      if (leftX  == null || !Number.isFinite(leftX))  leftX  = 0;
      if (rightX == null || !Number.isFinite(rightX)) rightX = plotW;
      const denom = (t1 - t0) || 1;
      const placed = [];
      for (let i = 0; i < ticks.length; i++) {
        const frac = (ticks[i].ms - t0) / denom;            // elapsed-time fraction
        let x = leftX + frac * (rightX - leftX);
        if (!Number.isFinite(x)) continue;
        x = Math.max(0, Math.min(plotW, x));
        placed.push({ x: x, label: ticks[i].label });
      }
      // De-crowd: drop labels closer than 44px or adjacent duplicates (keep the last).
      xaxis.textContent = '';
      let lastX = -1e9, lastLabel = null;
      for (let i = 0; i < placed.length; i++) {
        const x = placed[i].x, label = placed[i].label;
        if (label === lastLabel) continue;
        if ((x - lastX) < 44 && i !== placed.length - 1) continue;
        lastX = x; lastLabel = label;
        const span = document.createElement('span');
        span.className = 'aurix-xaxis-label';
        span.textContent = label;
        if (x <= 6)              { span.classList.add('edge-l'); span.style.left = '2px'; }
        else if (x >= plotW - 6) { span.classList.add('edge-r'); span.style.left = Math.max(0, plotW - 2) + 'px'; span.style.transform = 'translateX(-100%)'; }
        else                     { span.style.left = x + 'px'; }
        xaxis.appendChild(span);
      }
    }
    function _scalePaddingProvider(baseImpl) {
      const original = (typeof baseImpl === 'function') ? (baseImpl() || null) : baseImpl;
      if (!original || !original.priceRange) return original || null;
      if (!_scaleHints) return original;
      const { firstValue, lastValue, anchor } = _scaleHints;
      if (!Number.isFinite(anchor)     || anchor     <= 0) return original;
      if (!Number.isFinite(firstValue) || firstValue <= 0) return original;
      if (!Number.isFinite(lastValue))                     return original;
      let lo = Number(original.priceRange.minValue);
      let hi = Number(original.priceRange.maxValue);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return original;

      // 1. Institutional padding — fraction of the visible range, floored on the anchor.
      const range = hi - lo;
      const pad   = Math.max(range * _PAD_FRAC_OF_RANGE, anchor * _PAD_MIN_FRAC_ANCHOR);
      lo -= pad;
      hi += pad;

      // 2. Minimum TOTAL domain width for tiny moves (calm small ripples).
      const movePct = Math.abs((lastValue - firstValue) / firstValue * 100);
      let minWidth = 0;
      if      (movePct < 0.5) minWidth = anchor * 0.010;   // ≈1.0% total
      else if (movePct < 1.5) minWidth = anchor * 0.020;   // ≈2.0% total
      if (minWidth > 0 && (hi - lo) < minWidth) {
        const grow = (minWidth - (hi - lo)) / 2;
        lo -= grow;
        hi += grow;
      }

      // 3. AURIX-CHART-UX-1 #3 — snap the domain to a "nice" round step so the
      // right-axis divisions read clean (…5800 · 6000 · 6200…). Targets ~4
      // divisions; floors the low / ceils the high to multiples of the step, so
      // it ONLY ever widens the domain (never compresses the curve). Pure
      // presentation — does not touch any data point.
      const span = hi - lo;
      if (span > 0) {
        const rawStep = span / 4;
        const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        const unit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
        const step = unit * mag;
        if (Number.isFinite(step) && step > 0) {
          lo = Math.floor(lo / step) * step;
          hi = Math.ceil(hi / step) * step;
        }
      }

      // AURIX-CHART-FINAL-RENDER-FIX — explicit generous TOP pixel margin so the
      // highest right-axis price label (e.g. "11.000 €") is NEVER clipped against the
      // pane top, no matter how high the value climbs. When a custom
      // autoscaleInfoProvider is set these provider margins are the authoritative
      // label-clearance control (they supersede the fractional scaleMargins for this
      // series). Bottom stays tight so the curve keeps its vertical presence.
      // Mobile gets extra BOTTOM headroom too so the lowest right-axis label never
      // clips against the pane bottom (mobile-scoped; desktop bottom unchanged).
      // AURIX-FINAL-CHART-POLISH-PASS-V2 — mobile has no axis labels to clear, so
      // tighten its top/bottom margins → the line fills ~70-75% of the card. Desktop
      // keeps generous top room so the highest price label never clips.
      return { priceRange: { minValue: lo, maxValue: hi }, margins: { above: _isMobilePortfolio ? 14 : 34, below: _isMobilePortfolio ? 12 : 8 } };
    }

    // AURIX-CHARTS-PREMIUM-REFINEMENT-1 — portfolio-only visual tuning. SCOPED to
    // variant 'portfolio' so asset/category/sparkline charts (shared engine +
    // shared THEME) stay byte-for-byte untouched. Goal (priority #13): the curve
    // is the protagonist. We soften the area gradient so the line reads stronger
    // by contrast, and drop the floating last-value label (it duplicates the Hero
    // Card). The LINE itself is left identical to THEME — no hue/weight change,
    // no data smoothing (visualNormalization stays off). Fidelity over aesthetics.
    const _isPortfolio = opts.variant === 'portfolio';
    // AURIX-WEB-POLISH-1: optional per-instance area gradient override
    // (opts.areaColors = {base,up,down,flat[,bot]}). The desktop dashboard passes
    // a slightly deeper fill for more premium depth. Falls back to the variant
    // defaults → asset/category/sparkline/mobile charts byte-identical.
    const _ac = (opts.areaColors && typeof opts.areaColors === 'object') ? opts.areaColors : null;
    const _area = _ac
      ? { base: _ac.base, up: _ac.up, down: _ac.down, flat: _ac.flat, bot: (_ac.bot != null ? _ac.bot : THEME.areaBot) }
      : _isPortfolio
        ? { base: 'rgba(138, 166, 255, 0.15)', up: 'rgba(63, 191, 127, 0.13)', down: 'rgba(224, 90, 90, 0.12)', flat: 'rgba(180, 196, 224, 0.07)', bot: THEME.areaBot }
        : { base: THEME.areaTop, up: THEME.areaTopUp, down: THEME.areaTopDn, flat: THEME.areaTopFlat, bot: THEME.areaBot };

    // AURIX-CHART-LINE-PREMIUM-DETAIL-PASS — optional per-instance line colours so
    // the portfolio surface can use a slightly more vivid Aurix green WITHOUT
    // touching the shared THEME (Market / asset / sparkline stay byte-identical).
    // Falls back to THEME for any tone not provided.
    const _LC     = (opts.lineColors && typeof opts.lineColors === 'object') ? opts.lineColors : {};
    const _lcBase = _LC.base || THEME.line;
    const _lcUp   = _LC.up   || THEME.lineUp;
    const _lcDown = _LC.down || THEME.lineDown;
    const _lcFlat = _LC.flat || THEME.lineFlat;
    let _lineColorNow = _lcBase;   // tracked so the live end-dot matches the line

    const series = chart.addAreaSeries({
      lineColor:       _lcBase,
      lineWidth:       _portfolioLineWidth,
      lineType:        (LWC.LineType && LWC.LineType.Curved != null) ? LWC.LineType.Curved : 0,
      topColor:        _area.base,
      bottomColor:     _area.bot,
      priceLineVisible: false,
      // Block 2: hide the floating last-value label on the portfolio surface
      // (asset/mini keep it; sparkline never had it). Value lives in the Hero Card.
      lastValueVisible: opts.variant !== 'sparkline' && opts.variant !== 'portfolio',
      crosshairMarkerVisible: opts.variant !== 'sparkline',
      crosshairMarkerRadius:  _portfolioMarkerR,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBorderColor: 'rgba(14,18,28,0.92)',
      // CHART-4B: custom series-level price format so the price scale
      // marker label (the floating chip next to the crosshair) also
      // uses Aurix compact currency, not Lightweight Charts' default.
      priceFormat: {
        type: 'custom',
        formatter: _priceFormatter,
        minMove: 0.01,
      },
    });

    // CHART-SCALE-1 — opt-in min y-domain padding. Applied after series
    // creation so the literal above stays focused on visual options.
    if (_shouldUseMinPadding) {
      try { series.applyOptions({ autoscaleInfoProvider: _scalePaddingProvider }); } catch (_) {}
    }

    // AURIX-MOBILE-CHART-HIDE-AXES — minimalist premium MOBILE chart: hide the right
    // price axis (no side amounts) so the LINE is the protagonist. We hide it via
    // the price scale's `visible:false` (NOT showPriceScale:false) on purpose — the
    // engine gates the subtle GRID colour on opts.showPriceScale, so keeping that
    // true preserves the grid while this only removes the axis labels/border. With
    // the axis hidden LWC reclaims its width, so the plot uses the full width (no
    // empty gutter). Autoscale padding still applies → vertical room is unchanged.
    // Desktop (not _isMobilePortfolio) keeps the right axis untouched.
    if (_isMobilePortfolio) {
      try { chart.priceScale('right').applyOptions({ visible: false }); } catch (_) {}
    }

    // Apply colorMode shading at series level.
    // AURIX-CHARTS-2 — 'neutral' (flat baseline) now uses a dedicated
    // gray-blue token pair so a post-reset chart never repaints in
    // red and never sits on the same hue as a true positive run.
    function _applyColor(mode) {
      let lc, top;
      if (mode === 'positive')      { lc = _lcUp;   top = _area.up;   }
      else if (mode === 'negative') { lc = _lcDown; top = _area.down; }
      else if (mode === 'neutral')  { lc = _lcFlat; top = _area.flat; }
      else                          { lc = _lcBase; top = _area.base; }
      _lineColorNow = lc;
      series.applyOptions({ lineColor: lc, topColor: top, bottomColor: _area.bot });
      try { _renderEndpoint(); } catch (_) {}
    }
    if (opts.colorMode && opts.colorMode !== 'auto') _applyColor(opts.colorMode);

    // ── Tooltip wiring ──────────────────────────────────────────
    let _state = {
      currency: opts.currency,
      range:    opts.range,
      data:     [],
      meta:     null,
    };

    // CHART-4C hotfix: shared tooltip renderer reachable from BOTH
    // the LWC subscribeCrosshairMove callback (desktop hover) AND the
    // mobile inspection state machine. Previously the handler bailed
    // on `!param.point`, which is undefined when LWC fires the
    // callback from a programmatic setCrosshairPosition() call — so
    // the tooltip never rendered for the mobile path. Now the state
    // machine can call _renderTooltip(value, timeMs, xClient) directly.
    const _ttTimeEl = (opts.showTooltip)
      ? (tooltip.innerHTML =
          '<div class="aurix-chart-tooltip-time"></div>' +
          '<div class="aurix-chart-tooltip-value"></div>' +
          '<div class="aurix-chart-tooltip-pct"></div>' +
          // CHART-CORE: appears only when the active point was visually
          // normalized (interpolated over an outlier). Premium, muted,
          // never alarming.
          '<div class="aurix-chart-tooltip-note" hidden></div>',
         tooltip.querySelector('.aurix-chart-tooltip-time'))
      : null;
    const _ttValEl = opts.showTooltip ? tooltip.querySelector('.aurix-chart-tooltip-value') : null;
    const _ttPctEl = opts.showTooltip ? tooltip.querySelector('.aurix-chart-tooltip-pct')   : null;
    const _ttNoteEl= opts.showTooltip ? tooltip.querySelector('.aurix-chart-tooltip-note')  : null;

    function _renderTooltip(value, timeMs, xClient, yClient) {
      if (!opts.showTooltip || !_ttTimeEl || !_ttValEl) return;
      _ttTimeEl.textContent = _formatTooltipTime(timeMs, _state.range, opts.variant);
      _ttValEl.textContent  = _formatTooltipValue(value, _state.currency);
      // CHART-CORE: note line if this exact timestamp was visually
      // normalized. Set hidden=true (not text='') so future logic can
      // hide via the attribute alone.
      if (_ttNoteEl) {
        const isNormalized = _state.normalizedTimes &&
                             _state.normalizedTimes.has(timeMs);
        if (isNormalized) {
          _ttNoteEl.textContent = _isLangEs() ? 'Dato suavizado' : 'Smoothed data';
          _ttNoteEl.hidden = false;
        } else {
          _ttNoteEl.hidden = true;
        }
      }
      const first = _state.data[0]?.value;
      const dir = first == null
        ? 'flat'
        : (value > first ? 'up' : (value < first ? 'down' : 'flat'));
      _ttValEl.classList.toggle('is-up',   dir === 'up');
      _ttValEl.classList.toggle('is-down', dir === 'down');
      if (_ttPctEl) {
        if (first != null && first > 0) {
          const pct = ((value - first) / first) * 100;
          const sign = pct >= 0 ? '+' : '';
          _ttPctEl.textContent = `${sign}${pct.toFixed(2)}%`;
          _ttPctEl.classList.toggle('is-up',   pct > 0.005);
          _ttPctEl.classList.toggle('is-down', pct < -0.005);
        } else {
          _ttPctEl.textContent = '';
        }
      }
      const hostRect = host.getBoundingClientRect();
      const ttW = tooltip.offsetWidth  || 120;
      const ttH = tooltip.offsetHeight || 56;
      const localX = (typeof xClient === 'number') ? (xClient - hostRect.left) : (hostRect.width / 2);
      // y: prefer the supplied yClient (desktop hover provides it);
      // mobile inspection passes only x → pin tooltip near the top.
      const localY = (typeof yClient === 'number')
        ? Math.max(ttH + 6, yClient - hostRect.top)
        : (ttH + 16);
      const left = Math.max(ttW / 2 + 6, Math.min(hostRect.width - ttW / 2 - 6, localX));
      tooltip.style.left = left + 'px';
      tooltip.style.top  = localY + 'px';
      tooltip.dataset.visible = 'true';
    }
    function _hideTooltip() {
      if (tooltip) tooltip.dataset.visible = 'false';
    }

    // CHART-7A: engine-level tooltip lifecycle correctness.
    //
    // Bug fixed here: previous CHART-4C guard kept the tooltip alive
    // when LWC fired subscribeCrosshairMove on desktop pointer-exit
    // (param.time / point / seriesData ALL undefined). The handler
    // bailed out before any _hideTooltip() call → stale tooltip.
    //
    // Fix model:
    //   • _inspectionActive flag set by the mobile state machine
    //     while it owns the tooltip lifecycle (long-press → release).
    //     subscribeCrosshairMove returns early when this is true so
    //     mobile rendering is never overridden.
    //   • When _inspectionActive is false (desktop or mobile-idle),
    //     ANY invalid payload (no time, no data, no point) hides
    //     the tooltip immediately. No exit case slips through.
    //   • Belt-and-braces pointerleave + mouseleave on the host so
    //     even an LWC build that ever misses the leave callback
    //     still cleans up via the DOM.
    //   • destroy() unconditionally hides + clears crosshair so the
    //     last surface state never leaks past teardown.
    let _inspectionActive = false;

    if (opts.showTooltip && opts.showCrosshair) {
      chart.subscribeCrosshairMove(param => {
        // Mobile inspection owns the tooltip — never touch it from
        // this callback during a programmatic setCrosshairPosition.
        if (_inspectionActive) return;
        if (!param || !param.time || !param.point || !param.seriesData?.size) {
          _hideTooltip();
          return;
        }
        const data = param.seriesData.get(series);
        if (!data || typeof data.value !== 'number') {
          _hideTooltip();
          return;
        }
        // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — the visible line may be densified, so
        // snap the tooltip to the nearest REAL snapshot (honest date + value), never
        // an interpolated display sample.
        const rawMs = (typeof param.time === 'number' ? param.time * 1000 : Date.parse(param.time));
        const near  = (opts.variant === 'portfolio') ? _nearestRealPoint(rawMs) : null;
        const val   = near ? near.value : data.value;
        const ms    = near ? near.time  : rawMs;
        _renderTooltip(val, ms, undefined, undefined);
        // Snap x/y to the actual pointer for premium desktop hover.
        const hostRect = host.getBoundingClientRect();
        tooltip.style.left = Math.max(60, Math.min(hostRect.width - 60, param.point.x)) + 'px';
        tooltip.style.top  = Math.max(60, param.point.y) + 'px';
      });
    }

    // Belt-and-braces leave handlers. Cover the case where LWC's
    // subscribeCrosshairMove doesn't fire (or fires too late) on a
    // fast pointer exit, a modal close that detaches the host, or a
    // window blur. Both events are needed: pointerleave for modern
    // browsers, mouseleave as a fallback for any environment that
    // doesn't synthesize pointer events for a particular input.
    let _onHostLeave = null;
    if (opts.showTooltip) {
      _onHostLeave = () => {
        if (_inspectionActive) return;  // mobile owns its own teardown
        _hideTooltip();
        try { if (typeof chart.clearCrosshairPosition === 'function') chart.clearCrosshairPosition(); } catch (_) {}
      };
      host.addEventListener('pointerleave', _onHostLeave);
      host.addEventListener('mouseleave',   _onHostLeave);
    }

    // ── CHART-4C: mobile inspection state machine ───────────────
    // Premium long-press → crosshair/tooltip → release flow. Opt-in
    // via opts.mobileInspection.
    //
    // Two CHART-4C hotfixes:
    //   1. Listeners attach to the first ancestor whose computed
    //      pointer-events is NOT 'none'. host.parentNode is the
    //      caller's container which is pointer-events:none on mobile,
    //      so listeners attached there never fire (the element isn't
    //      a hit-test target and the cascade hides descendants too).
    //   2. We drive the crosshair via chart.setCrosshairPosition() /
    //      clearCrosshairPosition() — the official LWC API. Synthetic
    //      MouseEvents don't trigger LWC's touch-mode crosshair.
    //      setCrosshairPosition fires subscribeCrosshairMove on its
    //      own, so the existing DOM tooltip handler still lights up.
    let _mInsCleanup = null;
    if (opts.mobileInspection) {
      // Find the first ancestor that can actually receive touches.
      let TARGET = host.parentNode;
      try {
        let cur = host.parentNode;
        const docView = (cur && cur.ownerDocument && cur.ownerDocument.defaultView) || window;
        while (cur && cur instanceof Element) {
          const cs = docView.getComputedStyle(cur);
          if (cs && cs.pointerEvents !== 'none') { TARGET = cur; break; }
          cur = cur.parentNode;
        }
      } catch (_) { /* fall back to host.parentNode */ }

      if (TARGET) {
        const MOVE_TOL = 10;
        const PRESS_MS = 180;
        let pressTimer  = 0;
        let startX = 0, startY = 0;
        let curX = 0,   curY = 0;
        let inspecting = false;
        let suppressNextClick = false;

        const _canvasEl = () => canvasHolder.querySelector('canvas');

        // Walk up to find the nearest dashboard slider root so we can
        // mark inspection on it. CSS / other JS observers can hook
        // [data-chart-inspecting="1"] to lock animations / gestures
        // beyond what stopPropagation already covers.
        const _findSliderRoot = () => {
          let cur = host;
          while (cur && cur instanceof Element) {
            if (cur.id === 'portfolioMobileSlider' ||
                cur.classList?.contains('portfolio-mobile-slider') ||
                cur.classList?.contains('mobile-slider-track')) return cur;
            cur = cur.parentNode;
          }
          return null;
        };
        const sliderRoot = _findSliderRoot();

        // Snap a clientX to the nearest data bar, tell LWC to render
        // its crosshair, AND render our DOM tooltip directly (the LWC
        // subscribeCrosshairMove callback fires with no point info on
        // programmatic setCrosshairPosition, so we cannot rely on it).
        const _crosshairAt = (clientX) => {
          if (!Array.isArray(_state.data) || !_state.data.length) return;
          const c = _canvasEl();
          if (!c) return;
          const rect = c.getBoundingClientRect();
          const x = clientX - rect.left;
          if (x < 0 || x > rect.width) return;
          let tAtX;
          try { tAtX = chart.timeScale().coordinateToTime(x); } catch (_) { return; }
          if (tAtX == null) return;
          const tSec = typeof tAtX === 'number'
            ? tAtX
            : Math.floor(Date.parse(tAtX) / 1000);
          // Linear nearest-neighbour over _state.data (always ≤ a
          // few hundred points after dedupe — fast enough per touch).
          let nearest = null, bestDiff = Infinity;
          for (const p of _state.data) {
            if (!p || typeof p.time !== 'number' || typeof p.value !== 'number') continue;
            const pSec = Math.floor(p.time / 1000);
            const diff = Math.abs(pSec - tSec);
            if (diff < bestDiff) { bestDiff = diff; nearest = p; }
          }
          if (!nearest) return;
          try {
            chart.setCrosshairPosition(nearest.value, Math.floor(nearest.time / 1000), series);
          } catch (_) {}
          // Render our DOM tooltip directly — bypasses the subscribe
          // callback whose param.point is undefined on programmatic
          // crosshair updates.
          _renderTooltip(nearest.value, nearest.time, clientX, undefined);
        };
        const _clearCrosshair = () => {
          try { chart.clearCrosshairPosition(); } catch (_) {}
          _hideTooltip();
        };

        const enter = (x) => {
          inspecting = true;
          // CHART-7A: flip the engine-wide inspection flag so the
          // subscribeCrosshairMove handler stops touching the tooltip
          // while mobile is in charge.
          _inspectionActive = true;
          host.dataset.inspecting = 'true';
          // Mark the dashboard slider root so any external listener
          // (and our touch-action CSS guard below) can lock swipe.
          if (sliderRoot) sliderRoot.setAttribute('data-chart-inspecting', '1');
          _crosshairAt(x);
        };
        const exit = () => {
          if (!inspecting) return;
          inspecting = false;
          _inspectionActive = false;
          delete host.dataset.inspecting;
          if (sliderRoot) sliderRoot.removeAttribute('data-chart-inspecting');
          _clearCrosshair();
        };

        const onTouchStart = (e) => {
          if (inspecting) return;
          if (!e.touches || e.touches.length !== 1) return;
          const t = e.touches[0];
          // Only react when the touch actually started over the
          // chart host's bounding box. The ancestor target may cover
          // a larger area (e.g. the whole card) — we don't want a
          // press on the header / controls to enter inspection.
          const r = host.getBoundingClientRect();
          if (t.clientX < r.left || t.clientX > r.right ||
              t.clientY < r.top  || t.clientY > r.bottom) {
            return;
          }
          startX = curX = t.clientX;
          startY = curY = t.clientY;
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => {
            pressTimer = 0;
            enter(curX);
          }, PRESS_MS);
        };
        const onTouchMove = (e) => {
          if (!e.touches || e.touches.length === 0) return;
          const t = e.touches[0];
          curX = t.clientX;
          curY = t.clientY;
          if (inspecting) {
            // Block page scroll AND prevent the ancestor carousel /
            // slider listeners from seeing this event. preventDefault
            // alone is not enough — the dashboard slider sets its own
            // isDragging=true on touchstart and would still apply a
            // transform during bubble. stopPropagation cuts the
            // bubble path entirely so the slider never moves.
            try { e.preventDefault();  } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
            _crosshairAt(curX);
            return;
          }
          if (pressTimer) {
            if (Math.abs(curX - startX) > MOVE_TOL ||
                Math.abs(curY - startY) > MOVE_TOL) {
              clearTimeout(pressTimer);
              pressTimer = 0;
            }
          }
        };
        const onTouchEnd = (e) => {
          if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
          if (inspecting) {
            // Swallow the carousel's touchend so it doesn't apply a
            // final swipe based on the inspection drag's dx.
            try { if (e && e.stopPropagation) e.stopPropagation(); } catch (_) {}
            suppressNextClick = true;
            setTimeout(() => { suppressNextClick = false; }, 350);
            exit();
          }
        };
        const onClickCapture = (e) => {
          if (suppressNextClick) {
            try { e.stopPropagation(); e.preventDefault(); } catch (_) {}
          }
        };

        TARGET.addEventListener('touchstart', onTouchStart, { passive: true });
        TARGET.addEventListener('touchmove',  onTouchMove,  { passive: false });
        TARGET.addEventListener('touchend',   onTouchEnd,   { passive: true });
        TARGET.addEventListener('touchcancel',onTouchEnd,   { passive: true });
        TARGET.addEventListener('click',      onClickCapture, true);

        _mInsCleanup = () => {
          try { clearTimeout(pressTimer); } catch (_) {}
          try { exit(); } catch (_) {}
          TARGET.removeEventListener('touchstart', onTouchStart);
          TARGET.removeEventListener('touchmove',  onTouchMove);
          TARGET.removeEventListener('touchend',   onTouchEnd);
          TARGET.removeEventListener('touchcancel',onTouchEnd);
          TARGET.removeEventListener('click',      onClickCapture, true);
        };
      }
    }

    // ── ResizeObserver (responsive sizing) ─────────────────────
    // CHART-4B: throttle via requestAnimationFrame so a torrent of
    // resize events (drag-resizing the window, mobile slider
    // transitions) coalesces into a single applyOptions + fitContent
    // per frame. Prevents the brief clip / lag observed before.
    let _ro = null;
    let _resizeRafId = 0;
    const _doResize = () => {
      _resizeRafId = 0;
      const w = canvasHolder.clientWidth  || 0;
      const h = canvasHolder.clientHeight || 0;
      if (!w || !h) return;
      try { chart.applyOptions({ width: w, height: h }); } catch (_) {}
      _fitView();
    };
    if (typeof ResizeObserver === 'function') {
      _ro = new ResizeObserver(() => {
        if (_resizeRafId) return;
        _resizeRafId = requestAnimationFrame(_doResize);
      });
      _ro.observe(canvasHolder);
    }

    // ── Controller ──────────────────────────────────────────────
    // CHART-4B: helper that resolves a directional intent into the
    // colorMode the area series understands. Returns null if the hint
    // is unrecognised, so the caller falls back to 'auto' (first/last).
    function _resolveDirection(hint) {
      if (!hint) return null;
      const h = String(hint).toLowerCase();
      if (h === 'up'   || h === 'positive' || h === '+') return 'positive';
      if (h === 'down' || h === 'negative' || h === '-') return 'negative';
      if (h === 'flat' || h === 'neutral'  || h === '0') return 'neutral';
      return null;
    }

    const controller = {
      host,
      setData(seriesData, meta) {
        const arr = Array.isArray(seriesData) ? seriesData : [];
        if (!arr.length) {
          host.dataset.state = 'empty';
          _applyEmptyCopy(meta && meta.emptyReason);
          _scaleHints = null;
          _barCount = 0;
          _renderTimesSec = null;
          series.setData([]);
          try { _renderEndpoint(); } catch (_) {}
          if (_shouldShowValChip) valchip.hidden = true;
          return;
        }
        // Lightweight Charts wants UTC seconds + ascending order.
        const formatted = arr
          .filter(p => p && typeof p.value === 'number' && Number.isFinite(p.value))
          .map(p => ({ time: _msToSec(p.time), value: p.value }))
          .sort((a, b) => a.time - b.time);
        if (!formatted.length) {
          host.dataset.state = 'empty';
          _applyEmptyCopy(meta && meta.emptyReason);
          _scaleHints = null;
          _barCount = 0;
          _renderTimesSec = null;
          series.setData([]);
          try { _renderEndpoint(); } catch (_) {}
          if (_shouldShowValChip) valchip.hidden = true;
          return;
        }
        // Dedupe identical timestamps (LWC requires strictly ascending).
        const deduped = [];
        let lastT = -1;
        for (const p of formatted) {
          if (p.time === lastT) continue;
          deduped.push(p);
          lastT = p.time;
        }
        // CHART-CORE: visual normalization layer. Runs only when the
        // caller opts in via opts.visualNormalization.enabled and the
        // series has enough points. Operates on a copy of `deduped`
        // (which is itself a copy of the caller's raw series) so no
        // upstream data is mutated. Direction colour + ready badge
        // still derive from the VISUAL endpoints — by design, because
        // those are what the user sees.
        const useNorm = opts.visualNormalization && opts.visualNormalization.enabled;
        let visualSeries = deduped;
        let normTimes = null;
        let normSummary = { outliers: 0, smoothed: 0 };
        if (useNorm) {
          try {
            const result = _normalizeSeries(deduped, opts.visualNormalization, _state.range);
            // Re-format for LWC (sec-grained, ascending). Times stay
            // identical to the input so the LWC bar grid is preserved.
            visualSeries = result.visual;
            normTimes    = result.normalizedTimes;
            normSummary  = result.summary;
          } catch (err) {
            console.warn('[aurix-chart] normalization fail:', err && err.message);
            visualSeries = deduped;
            normTimes    = null;
          }
        }
        // CHART-SCALE-1 — refresh scale hints from the VISUAL endpoints
        // before setData triggers the autoscale recompute. First / last
        // drive the % move threshold; last drives the symmetric padding
        // anchor so the chart endpoint stays aligned with the live KPI.
        if (_shouldUseMinPadding) {
          const fv = visualSeries[0].value;
          const lv = visualSeries[visualSeries.length - 1].value;
          if (Number.isFinite(fv) && Number.isFinite(lv)) {
            _scaleHints = { firstValue: fv, lastValue: lv, anchor: lv };
          } else {
            _scaleHints = null;
          }
        }
        // AURIX-CHART-INSTITUTIONAL-PHASE2 — a structural jump (deposit / buy /
        // sell) renders as a clean step (Linear) instead of a smooth curve that
        // would overshoot and read as market performance. Portfolio surface only;
        // ordinary market series stay Curved. Driven by meta.straight from the app.
        // AURIX-MOBILE-CHART-PREMIUM-CLOSEOUT — MOBILE always uses a smooth Curved
        // line (never the straight step): on a small surface the step reads as an
        // angular "wall", and forcing one consistent mode also kills the recta↔curva
        // flicker between refreshes. Desktop keeps the institutional step behaviour
        // (meta.straight) unchanged. Display-only — no data is smoothed.
        if (opts.variant === 'portfolio' && LWC.LineType && meta) {
          try {
            const wantStraight = meta.straight && !_isMobilePortfolio;
            series.applyOptions({
              lineType: wantStraight
                ? (LWC.LineType.Simple  != null ? LWC.LineType.Simple  : 0)
                : (LWC.LineType.Curved  != null ? LWC.LineType.Curved  : 0),
            });
          } catch (_) {}
        }
        // Some LWC builds reject duplicate times — the dedupe above
        // already guarantees uniqueness, but normalization can
        // theoretically produce equal values; it never changes time.
        // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — densify the VISIBLE line for the
        // portfolio surface so a sparse range fills the plot (see _densifyForDisplay).
        // _state.data keeps the REAL series, so headline + tooltips never read a
        // densified value. Other variants render the real series unchanged.
        const renderSeries = (opts.variant === 'portfolio') ? _densifyForDisplay(visualSeries) : visualSeries;
        series.setData(renderSeries);
        _barCount = renderSeries.length;
        _renderTimesSec = renderSeries.map(p => p.time);  // for position-even axis ticks
        // Direction (colour) inferred from the VISUAL series so the
        // chart line + label-area gradient match what the user sees.
        const hinted = meta && (meta.direction || meta.directionHint);
        const resolved = _resolveDirection(hinted);
        if (resolved) {
          _applyColor(resolved === 'neutral' ? 'neutral' : resolved);
        } else if (opts.colorMode === 'auto') {
          const first = visualSeries[0].value;
          const last  = visualSeries[visualSeries.length - 1].value;
          _applyColor(last >= first ? 'positive' : 'negative');
        }
        _state.data = arr;
        _state.meta = meta || null;
        _state.normalizedTimes  = normTimes;
        _state.normalizationSummary = normSummary;
        _state.rawSnapshot = deduped;  // pre-normalization, sec-grained
        // CHART-MICRO-POLISH-1 — remove the "Vista optimizada" /
        // "Optimized view" / "Estimación" / "Estimate" badges from the
        // user-facing dashboard. They read as engine/debug labels in a
        // premium financial UI and added noise on 1A / TOTAL ranges
        // where the visual-normalization layer kicks in. The badge node
        // stays in the DOM so all callers (`badge.hidden = ...`) remain
        // valid; we just keep it hidden by default. Under the explicit
        // debug gate `localStorage.aurix_debug === '1'` the previous
        // labels are still surfaced so engineers can confirm a
        // normalization pass without touching code.
        let _isDebug = false;
        try { _isDebug = (window.localStorage && window.localStorage.getItem('aurix_debug') === '1'); } catch (_) {}
        if (_isDebug && meta && meta.isSynthetic) {
          badge.hidden = false;
          badge.textContent = _isLangEs() ? 'Estimación' : 'Estimate';
        } else if (_isDebug && useNorm && normSummary.outliers > 0) {
          badge.hidden = false;
          badge.textContent = _isLangEs() ? 'Vista optimizada' : 'Optimized view';
        } else {
          badge.hidden = true;
        }
        // AURIX-CHARTS-2 — paint the mobile current-value chip with the
        // latest series value. Tone tracks the resolved direction (up /
        // down / neutral) so the chip and the line read the same story.
        if (_shouldShowValChip) {
          const lastVal = visualSeries[visualSeries.length - 1].value;
          valchip.textContent = _compactCurrency(lastVal, _formatterCurrency);
          valchip.classList.toggle('is-up',   resolved === 'positive');
          valchip.classList.toggle('is-down', resolved === 'negative');
          valchip.hidden = false;
        }
        host.dataset.state = 'ready';
        // AURIX-CHART-FINAL-RENDER-FIX — pin now, and AGAIN after layout settles.
        // At first paint (and on a hidden mobile slide) the canvas width can still
        // be 0/stale, so a single synchronous pin frames against the wrong width and
        // the sparse line looks half-empty. Re-applying on the next frame + a macro
        // tick makes the full-width framing land reliably.
        _fitView();
        try { requestAnimationFrame(_fitView); } catch (_) {}
        try { setTimeout(_fitView, 0); } catch (_) {}
      },
      setRange(range) {
        _state.range = String(range || '7d');
      },
      setCurrency(currency) {
        const next = String(currency || 'USD').toUpperCase();
        _state.currency = next;
        _formatterCurrency = next;
        // Re-apply localization so the right-axis re-formats with the
        // new currency symbol. Lightweight Charts re-runs the
        // priceFormatter on next tick after applyOptions.
        try {
          chart.applyOptions({
            localization: { priceFormatter: _priceFormatter },
          });
        } catch (_) {}
      },
      // CHART-4B: explicit color direction setter — callable by
      // consumers that compute their own KPI direction (e.g. the
      // dashboard). Idempotent; pass null/'' to revert to auto on the
      // next setData call.
      setDirection(direction) {
        const resolved = _resolveDirection(direction);
        if (resolved) _applyColor(resolved === 'neutral' ? 'neutral' : resolved);
      },
      // CHART-CORE: console-only diagnostics. Returns a snapshot of
      // the last normalization pass — useful to verify outlier counts
      // without DOM digging.
      getDebugInfo() {
        return {
          variant:          opts.variant,
          range:            _state.range,
          originalPoints:   Array.isArray(_state.rawSnapshot) ? _state.rawSnapshot.length : 0,
          visualPoints:     Array.isArray(_state.data) ? _state.data.length : 0,
          outliersDetected: _state.normalizationSummary ? _state.normalizationSummary.outliers : 0,
          smoothingApplied: !!(_state.normalizationSummary && _state.normalizationSummary.smoothed > 0),
          isSynthetic:      !!(_state.meta && _state.meta.isSynthetic),
        };
      },
      // AURIX-CHART-VISIBLE-ENGINE-CLOSEOUT — live view-framing snapshot so the
      // app-level [AURIX_CHART_VISIBLE_ENGINE] log can report the ACTUAL visible
      // logical range (proves whether the [0,N-1] pin stuck), the fit mode, the
      // Y margins and the X-tick mode — without the user pasting console snippets.
      getViewDebug() {
        let vlr = null;
        try {
          const r = chart.timeScale().getVisibleLogicalRange();
          if (r) vlr = { from: +Number(r.from).toFixed(2), to: +Number(r.to).toFixed(2) };
        } catch (_) {}
        return {
          fitMode: _fitModeApplied,
          visibleLogicalRange: vlr,
          barCount: _barCount,
          yMargins: _shouldUseMinPadding ? { above: 34, below: _isMobilePortfolio ? 22 : 8 } : 'default',
          xTickMode: (xaxis ? 'dom-overlay' : 'native'),
          xLabels: xaxis ? xaxis.childElementCount : 0,
          densifiedBars: _barCount,
          hostSize: { w: Math.round(host.clientWidth), h: Math.round(host.clientHeight) },
          canvasSize: { w: Math.round(canvasHolder.clientWidth), h: Math.round(canvasHolder.clientHeight) },
          state: host.dataset.state,
        };
      },
      setState(state) {
        const valid = new Set(['loading', 'empty', 'error', 'ready']);
        if (valid.has(state)) host.dataset.state = state;
        // Hide the live end-dot whenever we leave the ready state (loading/empty/
        // building/error) so it never lingers over a skin/placeholder.
        try { _renderEndpoint(); } catch (_) {}
      },
      resize() {
        const w = canvasHolder.clientWidth  || 0;
        const h = canvasHolder.clientHeight || 0;
        if (!w || !h) return;
        try { chart.applyOptions({ width: w, height: h }); } catch (_) {}
        _fitView();
      },
      destroy() {
        // CHART-7A: tooltip + crosshair must be hidden BEFORE the host
        // detaches, even when the controller is destroyed mid-hover
        // (e.g. the asset detail modal closes while the cursor is over
        // the chart). _mInsCleanup also calls exit() which clears
        // mobile inspection state, but desktop hover state lives in
        // the engine itself and needs an explicit close here.
        try { _hideTooltip(); } catch (_) {}
        try { if (typeof chart.clearCrosshairPosition === 'function') chart.clearCrosshairPosition(); } catch (_) {}
        try {
          if (_onHostLeave) {
            host.removeEventListener('pointerleave', _onHostLeave);
            host.removeEventListener('mouseleave',   _onHostLeave);
          }
        } catch (_) {}
        try { if (_mInsCleanup) _mInsCleanup(); } catch (_) {}
        try { if (_resizeRafId) cancelAnimationFrame(_resizeRafId); } catch (_) {}
        try { if (_ro) _ro.disconnect(); } catch (_) {}
        try { chart.remove(); } catch (_) {}
        if (host.parentNode) host.parentNode.removeChild(host);
        _instances.delete(controller);
      },
    };
    _instances.add(controller);
    return controller;
  }

  function createSparkline(container, options) {
    return createChart(container, Object.assign({}, options || {}, {
      variant: 'sparkline',
      showTimeScale: false,
      showPriceScale: false,
      showTooltip: !!(options && options.showTooltip),
      showCrosshair: !!(options && options.showCrosshair),
      height: (options && options.height) || 32,
    }));
  }

  // ── Range pills (optional, reusable) ───────────────────────────
  function createRangePills(container, opts) {
    _injectStyles();
    const o = Object.assign({
      ranges:  ['1D', '1W', '1M', '3M', '1Y', 'ALL'],
      initial: '1W',
      onChange: () => {},
    }, opts || {});
    const wrap = document.createElement('div');
    wrap.className = 'aurix-chart-ranges';
    wrap.setAttribute('role', 'tablist');
    const buttons = o.ranges.map(label => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'aurix-chart-range';
      b.textContent = label;
      b.setAttribute('aria-pressed', label === o.initial ? 'true' : 'false');
      b.addEventListener('click', () => {
        buttons.forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        try { o.onChange(label); } catch (_) {}
      });
      wrap.appendChild(b);
      return b;
    });
    container.appendChild(wrap);
    return {
      destroy() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); },
    };
  }

  // ── Demo / sandbox ─────────────────────────────────────────────
  let _demo = null;

  function mountDemo() {
    if (_demo) return _demo;
    _injectStyles();
    let sandbox = document.getElementById('aurixChartSandbox');
    if (!sandbox) {
      sandbox = document.createElement('div');
      sandbox.id = 'aurixChartSandbox';
      sandbox.className = 'aurix-chart-sandbox';
      sandbox.style.position = 'fixed';
      sandbox.style.right = '16px';
      sandbox.style.top   = '16px';
      sandbox.style.width = 'min(420px, calc(100vw - 32px))';
      sandbox.style.maxHeight = 'calc(100vh - 32px)';
      sandbox.style.overflowY = 'auto';
      sandbox.style.zIndex = '99999';
      sandbox.style.boxShadow = '0 24px 48px -24px rgba(4,8,16,0.95)';
      document.body.appendChild(sandbox);
    }
    sandbox.style.display = 'grid';
    sandbox.innerHTML = `
      <div>
        <button type="button" id="aurixDemoClose"
          style="float:right;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(225,233,255,0.85);cursor:pointer;font-family:inherit;font-size:12px;">
          Close
        </button>
        <h4 style="margin-right:60px;">Aurix Chart Sandbox</h4>
      </div>
      <div class="demo-card">
        <h4>Portfolio variant</h4>
        <div id="aurixDemoRangesHost"></div>
        <div id="aurixDemoPortfolio" style="height: 240px;"></div>
      </div>
      <div class="demo-card">
        <h4>Asset variant</h4>
        <div id="aurixDemoAsset" style="height: 220px;"></div>
      </div>
      <div class="demo-row">
        <div class="demo-card">
          <h4>Sparkline</h4>
          <div id="aurixDemoSparkline" style="height: 32px;"></div>
        </div>
        <div class="demo-card">
          <h4>Mini</h4>
          <div id="aurixDemoMini" style="height: 64px;"></div>
        </div>
      </div>
      <div class="demo-row">
        <div class="demo-card">
          <h4>Loading state</h4>
          <div id="aurixDemoLoading" style="height: 120px;"></div>
        </div>
        <div class="demo-card">
          <h4>Empty state</h4>
          <div id="aurixDemoEmpty" style="height: 120px;"></div>
        </div>
      </div>
      <div class="demo-card">
        <h4>Error state</h4>
        <div id="aurixDemoError" style="height: 120px;"></div>
      </div>
    `;

    // Build the demo charts.
    const portfolioMock = createMockSeries({ range: '7d', trend: 0.0010 });
    const assetMock     = createMockSeries({ range: '30d', base: 218, trend: -0.0006 });
    const sparkMock     = createMockSeries({ range: '24h', base: 100, trend: 0.0003 });
    const miniMock      = createMockSeries({ range: '7d', base: 64.50 });

    const portfolio = createChart(document.getElementById('aurixDemoPortfolio'), {
      variant: 'portfolio', height: 240, colorMode: 'auto', range: '1W',
    });
    portfolio.setData(portfolioMock.series, portfolioMock.meta);

    const asset = createChart(document.getElementById('aurixDemoAsset'), {
      variant: 'asset', height: 220, colorMode: 'auto', range: '1M',
    });
    asset.setData(assetMock.series, assetMock.meta);

    const ranges = createRangePills(document.getElementById('aurixDemoRangesHost'), {
      initial: '1W',
      onChange(label) {
        const map = { '1D': '24h', '1W': '7d', '1M': '30d', '3M': '3m', '1Y': '1y', 'ALL': 'all' };
        const r = map[label] || '7d';
        const fresh = createMockSeries({ range: r });
        portfolio.setRange(r);
        portfolio.setData(fresh.series, fresh.meta);
      },
    });

    const sparkline = createSparkline(document.getElementById('aurixDemoSparkline'), {
      colorMode: 'positive',
    });
    sparkline.setData(sparkMock.series, sparkMock.meta);

    const mini = createChart(document.getElementById('aurixDemoMini'), {
      variant: 'mini', height: 64, colorMode: 'auto',
    });
    mini.setData(miniMock.series, miniMock.meta);

    const loading = createChart(document.getElementById('aurixDemoLoading'), {
      variant: 'asset', height: 120, showTimeScale: false, showPriceScale: false,
    });
    loading.setState('loading');

    const emptyChart = createChart(document.getElementById('aurixDemoEmpty'), {
      variant: 'asset', height: 120, showTimeScale: false, showPriceScale: false,
    });
    emptyChart.setData([]);

    const errorChart = createChart(document.getElementById('aurixDemoError'), {
      variant: 'asset', height: 120, showTimeScale: false, showPriceScale: false,
    });
    errorChart.setState('error');

    const closeBtn = document.getElementById('aurixDemoClose');
    if (closeBtn) closeBtn.addEventListener('click', destroyDemo);

    _demo = {
      sandbox,
      controllers: [portfolio, asset, sparkline, mini, loading, emptyChart, errorChart],
      ranges,
    };
    return _demo;
  }

  function destroyDemo() {
    if (!_demo) return;
    try { _demo.controllers.forEach(c => { try { c.destroy(); } catch (_) {} }); } catch (_) {}
    try { _demo.ranges && _demo.ranges.destroy(); } catch (_) {}
    if (_demo.sandbox && _demo.sandbox.parentNode) {
      _demo.sandbox.parentNode.removeChild(_demo.sandbox);
    }
    _demo = null;
  }

  function destroyAll() {
    _instances.forEach(c => { try { c.destroy(); } catch (_) {} });
    _instances.clear();
    destroyDemo();
  }

  // ── Public surface ─────────────────────────────────────────────
  window.AurixCharts = Object.freeze({
    isReady:          _isReady,
    createChart,
    createSparkline,
    createRangePills,
    createMockSeries,
    mountDemo,
    destroyDemo,
    destroyAll,
    THEME,
  });

  // CHART-CORE: console-only debug surface. Read-only summary across
  // every live controller — power-user inspection, not UI.
  window.__aurixChartDebug = {
    instances() {
      const out = [];
      _instances.forEach(c => {
        if (typeof c.getDebugInfo === 'function') {
          try { out.push(c.getDebugInfo()); } catch (_) {}
        }
      });
      return out;
    },
    get lastNormalization() {
      let last = null;
      _instances.forEach(c => {
        if (typeof c.getDebugInfo !== 'function') return;
        try {
          const info = c.getDebugInfo();
          if (info && (info.outliersDetected || info.smoothingApplied)) last = info;
        } catch (_) {}
      });
      return last;
    },
  };
})();
