// services/prices.js
// ─────────────────────────────────────────────────────────────────────────────
// Crypto price polling has been consolidated into refreshPrices() in app.js.
// That function now handles crypto + market atomically in a single 30 s loop,
// eliminating the duplicate CoinGecko calls that caused rate-limit errors.
//
// This file is intentionally empty.  It is kept so index.html does not need
// to be modified, and can be removed once that change is made.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
