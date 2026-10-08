/* AURIX · DEMO — preparación de escenarios (sólo build de demo).
   Todo vive en el localStorage de ESTE navegador. Nada sale del origen de la demo. */
(function () {
  'use strict';
  var R = window.__AURIX_DEMO_RUNTIME__;
  if (!R) return;
  var DAY = 864e5;

  function wipe() {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try { if (window.indexedDB && indexedDB.databases) indexedDB.databases().then(function (l) { (l || []).forEach(function (d) { try { indexedDB.deleteDatabase(d.name); } catch (_) {} }); }); } catch (_) {}
    try { if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }); } catch (_) {}
  }
  function set(k, v) { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  function lang() { return document.documentElement.getAttribute('data-lang') || 'es'; }

  // CARTERA FICTICIA. Cantidades y precios inventados; los nombres de activo son
  // reales para que la interfaz se lea como en uso, pero ninguna cifra es de nadie.
  var ASSETS = [
    { id: 'demo_msft', ticker: 'MSFT', name: 'Microsoft', type: 'stock',  qty: 30,   price: 410,   assetCurrency: 'USD' },
    { id: 'demo_aapl', ticker: 'AAPL', name: 'Apple',     type: 'stock',  qty: 40,   price: 190,   assetCurrency: 'USD' },
    { id: 'demo_vwce', ticker: 'VWCE', name: 'Vanguard FTSE All-World', type: 'etf', qty: 60, price: 118, assetCurrency: 'USD' },
    { id: 'demo_btc',  ticker: 'BTC',  name: 'Bitcoin',   type: 'crypto', qty: 0.12, price: 62000, assetCurrency: 'USD' },
    { id: 'demo_eth',  ticker: 'ETH',  name: 'Ethereum',  type: 'crypto', qty: 1.5,  price: 3000,  assetCurrency: 'USD' },
    { id: 'demo_cash', ticker: 'USD',  name: 'Efectivo',  type: 'cash',   qty: 6500, price: 1,     assetCurrency: 'USD' },
  ];
  function history(days) {
    var now = Date.now(), hist = [], cats = [];
    var w = { stock: 0.49, etf: 0.14, crypto: 0.24, liquidity: 0.13 };
    var total0 = ASSETS.reduce(function (s, a) { return s + a.qty * a.price; }, 0);
    for (var i = days; i >= 0; i--) {
      var frac = 1 - i / days;
      var total = total0 * (0.9 + 0.1 * frac + Math.sin(frac * 9) * 0.012);
      var ts = Math.round(now - i * DAY);
      hist.push({ ts: ts, value: +total.toFixed(2) });
      var row = { ts: ts, total: +total.toFixed(2), crypto: 0, stock: 0, etf: 0, fund: 0, metal: 0, real_estate: 0, liquidity: 0, other: 0 };
      Object.keys(w).forEach(function (k) { row[k] = +(total * w[k]).toFixed(2); });
      cats.push(row);
    }
    return { hist: hist, cats: cats };
  }
  function onboardingDone(uid) {
    var d = JSON.parse(localStorage.getItem('aurix_demo_db_v1') || '{}');
    d.user_onboarding = [{ user_id: uid, onboarding_completed: true, onboarding_step: 'COMPLETED', preferred_language: lang(),
      tracked_asset_types: ['stocks', 'etf', 'crypto'], experience_level: null, onboarding_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    set('aurix_demo_db_v1', d);
    set('aurix_onboarding_completed', '1');
    set('aurix_onboarding_step', 'COMPLETED');
  }
  function start(kind, plan) {
    wipe();
    set('portfolio_lang', lang());
    set('aurix_demo_state_v1', { plan: plan, persona: kind, startedAt: Date.now() });
    if (kind === 'onboarding') { location.href = 'login.html'; return; }
    var s = R.mkSession('demo@aurix.invalid');
    var uid = s.user.id;
    set('aurix_cache_owner', uid);
    onboardingDone(uid);
    if (kind === 'wealth') {
      var h = history(90);
      set('portfolio_assets', ASSETS);
      set('portfolio_history', h.hist);
      set('category_history', h.cats);
      var d = JSON.parse(localStorage.getItem('aurix_demo_db_v1') || '{}');
      d.user_portfolios = [{ user_id: uid, assets: ASSETS, holdings: [], portfolio_history: h.hist, category_history: h.cats, updated_at: new Date().toISOString() }];
      set('aurix_demo_db_v1', d);
    }
    location.href = 'index.html';
  }
  window.AurixDemoStart = { start: start, reset: function () { wipe(); location.reload(); } };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-demo]'); if (!b) return;
    var plan = (document.querySelector('input[name="demoPlan"]:checked') || { value: 'free' }).value;
    var act = b.getAttribute('data-demo');
    if (act === 'reset') { window.AurixDemoStart.reset(); return; }
    if (act === 'lang') { document.documentElement.setAttribute('data-lang', b.getAttribute('data-lang')); paint(); return; }
    start(act, plan);
  });

  var T = {
    es: { t: 'Aurix · Demo', s: 'Entorno de demostración con datos ficticios. Nada de lo que hagas aquí llega a Aurix: ni cuentas, ni correos, ni pagos.',
      on: 'Recorrer onboarding', onb: 'Empieza como una cuenta nueva: acceso por correo simulado (código ' + R.code + ') y el onboarding completo.',
      app: 'Abrir aplicación demo', appb: 'Una cuenta ya configurada con una cartera ficticia.', empty: 'Cuenta vacía', emptyb: 'Cuenta configurada sin activos: estados vacíos.',
      plan: 'Experiencia', free: 'Free', prem: 'Premium (simulado, sin suscripción real)', reset: 'Reiniciar la demo', ver: 'Versión representada',
      sim: 'Simulado o no disponible: acceso por correo (código fijo, sin envío), pagos (deshabilitados), precios y búsqueda de activos en vivo (no disponibles; se usan los precios guardados), sincronización entre dispositivos (cada navegador tiene su propia demo; base de datos falsa en este navegador), tipo de cambio EUR/USD (sin red: Ajustes dice «sin tipo» y el total convertido se marca aproximado ≈). Todos los datos son ficticios.' },
    en: { t: 'Aurix · Demo', s: 'Demo environment with fictitious data. Nothing you do here reaches Aurix: no accounts, no emails, no payments.',
      on: 'Walk through onboarding', onb: 'Start as a new account: simulated email access (code ' + R.code + ') and the full onboarding.',
      app: 'Open demo app', appb: 'An account already set up with a fictitious portfolio.', empty: 'Empty account', emptyb: 'Account set up with no assets: empty states.',
      plan: 'Experience', free: 'Free', prem: 'Premium (simulated, no real subscription)', reset: 'Reset the demo', ver: 'Version shown',
      sim: 'Simulated or unavailable: email access (fixed code, nothing sent), payments (disabled), live prices and asset search (unavailable; stored prices are used), cross-device sync (each browser has its own demo; fake database in this browser), EUR/USD exchange rate (no network: Settings says «no rate» and the converted total is marked approximate ≈). All data is fictitious.' },
  };
  function paint() {
    var l = T[lang()] || T.es;
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = l[el.getAttribute('data-t')]; });
    document.documentElement.lang = lang();
  }
  document.addEventListener('DOMContentLoaded', function () {
    var v = document.querySelector('[data-ver]'); if (v) v.textContent = 'v' + R.version + ' · ' + R.build;
    paint();
  });
})();
