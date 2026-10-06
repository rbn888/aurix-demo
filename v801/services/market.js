'use strict';

// Market System — fetches BTC data and returns structured signals.
// Isolated: no UI, no DOM, no portfolio logic.

async function getMarketSignals() {
  // Proxied via /api/prices so the browser never talks to CoinGecko directly.
  // Reuses the existing pricing gateway endpoint — no new backend route.
  let res;
  try {
    // AURIX-APP-DOMAIN-READY-1: API origin from the single source of truth
    // (window.AURIX_API_BASE); default = current Vercel project during migration.
    const _apiBase = (typeof window !== 'undefined' && typeof window.AURIX_API_BASE === 'string')
      ? window.AURIX_API_BASE
      : 'https://demo-api.aurix.invalid';
    res = await fetch(_apiBase + '/api/prices', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ providers: ['coingecko:bitcoin'] }),
    });
  } catch (err) {
    throw new Error('Market fetch failed: ' + err.message);
  }

  if (!res.ok) {
    throw new Error('Market API error: ' + res.status);
  }

  const data   = await res.json();
  const change = data?.prices?.['coingecko:bitcoin']?.change24h;

  if (change == null) {
    throw new Error('Market data invalid: missing btc change');
  }

  const abs = Math.abs(change);

  const trend =
    change > 2  ? 'up'   :
    change < -2 ? 'down' :
                  'neutral';

  const volatility =
    abs > 5 ? 'high'   :
    abs > 2 ? 'medium' :
              'low';

  const momentum = abs > 4 ? 'strong' : 'weak';

  return { trend, volatility, momentum };
}
