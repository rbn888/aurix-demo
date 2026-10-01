const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const SCORE_MAP     = { high: 3, medium: 2, low: 1 };

const INSIGHT_CONFIG = {
  thresholds: {
    highExposure:        60,
    veryHighExposure:    70,
    volatilityExposure:  50,
    lowLiquidity:        15,
    criticalLiquidity:   10,
  }
};

const SAFE_DEFAULT = { type: 'neutral', message: '', severity: 'low' };

function normalizeMarket(market) {
  if (!market || typeof market !== 'object') return null;
  return {
    trend:      typeof market.trend      === 'string' ? market.trend.toLowerCase()      : null,
    momentum:   typeof market.momentum   === 'string' ? market.momentum.toLowerCase()   : null,
    volatility: typeof market.volatility === 'string' ? market.volatility.toLowerCase() : null,
  };
}

function normalizePortfolio(portfolio) {
  if (!portfolio || typeof portfolio !== 'object') return null;
  return {
    cryptoExposure: typeof portfolio.cryptoExposure === 'number' && !isNaN(portfolio.cryptoExposure) ? portfolio.cryptoExposure : null,
    liquidity:      typeof portfolio.liquidity      === 'number' && !isNaN(portfolio.liquidity)      ? portfolio.liquidity      : null,
    topCryptoAsset: typeof portfolio.topCryptoAsset === 'string' ? portfolio.topCryptoAsset           : null,
    lang:           typeof portfolio.lang           === 'string' ? portfolio.lang                     : 'en',
  };
}

function generateInsight(market, portfolio) {
  market    = normalizeMarket(market);
  portfolio = normalizePortfolio(portfolio);

  try {
    const candidates = [];
    const es         = portfolio && portfolio.lang === 'es';
    const cryptoPct  = portfolio && typeof portfolio.cryptoExposure === 'number' ? Math.round(portfolio.cryptoExposure) : null;
    const liqPct     = portfolio && typeof portfolio.liquidity      === 'number' ? Math.round(portfolio.liquidity)      : null;
    const asset      = portfolio && portfolio.topCryptoAsset ? portfolio.topCryptoAsset : (es ? 'Cripto' : 'Crypto');

    // Rule 1 — High risk: strong downtrend + high exposure
    if (
      market && portfolio &&
      market.trend === 'down' &&
      market.momentum === 'strong' &&
      typeof portfolio.cryptoExposure === 'number' &&
      portfolio.cryptoExposure >= INSIGHT_CONFIG.thresholds.highExposure
    ) {
      let score = SCORE_MAP['high'];
      if (market.momentum === 'strong')                                           score += 1;
      if (portfolio.cryptoExposure > INSIGHT_CONFIG.thresholds.veryHighExposure) score += 1;
      if (typeof portfolio.liquidity === 'number' && portfolio.liquidity < 10)   score += 2;
      const msg = es
        ? `${asset} ${cryptoPct}%, mercado bajista fuerte.`
        : `${asset} at ${cryptoPct}%, strong market downtrend.`;
      candidates.push({ type: 'risk', message: msg, severity: 'high', score });
    }

    // Rule 2 — Volatility warning
    if (
      market && portfolio &&
      market.volatility === 'high' &&
      typeof portfolio.cryptoExposure === 'number' &&
      portfolio.cryptoExposure >= INSIGHT_CONFIG.thresholds.volatilityExposure
    ) {
      let score = SCORE_MAP['medium'];
      if (market.momentum === 'strong')                                           score += 1;
      if (portfolio.cryptoExposure > INSIGHT_CONFIG.thresholds.veryHighExposure) score += 1;
      if (typeof portfolio.liquidity === 'number' && portfolio.liquidity < 10)   score += 2;
      const msg = es
        ? `${asset} ${cryptoPct}% de cartera, alta volatilidad.`
        : `${asset} at ${cryptoPct}% portfolio, high volatility.`;
      candidates.push({ type: 'risk', message: msg, severity: 'medium', score });
    }

    // Rule 3 — Low liquidity
    if (
      portfolio &&
      typeof portfolio.liquidity === 'number' &&
      portfolio.liquidity <= INSIGHT_CONFIG.thresholds.lowLiquidity
    ) {
      let score = SCORE_MAP['high'];
      if (portfolio.liquidity < INSIGHT_CONFIG.thresholds.criticalLiquidity) score += 2;
      const msg = es
        ? `Liquidez ${liqPct}%. ${asset} activo dominante.`
        : `Cash ${liqPct}%. ${asset} leads portfolio.`;
      candidates.push({ type: 'liquidity', message: msg, severity: 'high', score });
    }

    // Rule 4 — Strong uptrend opportunity
    if (
      market && portfolio &&
      market.trend === 'up' &&
      market.momentum === 'strong' &&
      typeof portfolio.cryptoExposure === 'number' &&
      portfolio.cryptoExposure >= INSIGHT_CONFIG.thresholds.volatilityExposure
    ) {
      let score = SCORE_MAP['medium'];
      if (market.momentum === 'strong')                                           score += 1;
      if (portfolio.cryptoExposure > INSIGHT_CONFIG.thresholds.veryHighExposure) score += 1;
      const msg = es
        ? `${asset} ${cryptoPct}% de cartera, mercado alcista fuerte.`
        : `${asset} at ${cryptoPct}% portfolio, strong uptrend.`;
      candidates.push({ type: 'opportunity', message: msg, severity: 'medium', score });
    }

    if (candidates.length > 0) {
      const best  = candidates.sort((a, b) => b.score - a.score)[0];
      const valid = best && typeof best.message === 'string' && best.type && SCORE_MAP[best.severity];
      if (valid) return { type: best.type, message: best.message, severity: best.severity };
    }
  } catch (_) {}

  // Fallback: legacy logic
  try {
    const candidates = [];
    const asset = (portfolio && portfolio.topCryptoAsset) || 'Crypto';

    if (market && market.trend === 'down' && portfolio && portfolio.cryptoExposure > 60) {
      const pct = Math.round(portfolio.cryptoExposure);
      candidates.push({ type: 'risk', message: `${asset} at ${pct}%, declining market.`, severity: 'high' });
    }

    if (market && market.trend === 'up' && portfolio && portfolio.cryptoExposure > 60) {
      const pct = Math.round(portfolio.cryptoExposure);
      candidates.push({ type: 'opportunity', message: `${asset} at ${pct}%, rising market.`, severity: 'medium' });
    }

    if (portfolio && portfolio.liquidity < 10) {
      const pct = Math.round(portfolio.liquidity);
      candidates.push({ type: 'liquidity', message: `Cash at ${pct}%, below safe threshold.`, severity: 'medium' });
    }

    if (candidates.length === 0) {
      return { type: 'neutral', message: 'No significant signals detected.', severity: 'low' };
    }

    const result = candidates.reduce((top, current) =>
      SEVERITY_RANK[current.severity] > SEVERITY_RANK[top.severity] ? current : top
    );

    const valid = result && typeof result.message === 'string' && result.type && SEVERITY_RANK[result.severity];
    return valid ? result : SAFE_DEFAULT;
  } catch (_) {}

  return SAFE_DEFAULT;
}
