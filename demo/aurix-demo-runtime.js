/* ════════════════════════════════════════════════════════════════════════════
   AURIX · RUNTIME DE DEMO — SÓLO EXISTE EN EL BUILD DE DEMO
   ════════════════════════════════════════════════════════════════════════════
   Este fichero NO forma parte del sitio de producción: `scripts/aurix-build-site.mjs`
   no lo publica (allowlist) y nada en app.js lo carga. Lo inyecta
   `scripts/aurix-build-demo.mjs` como PRIMER script de cada página del build de demo.

   Hace tres cosas, y ninguna toca un servicio real:
   1. RED: cualquier petición a otro origen se bloquea (fetch, XHR, sendBeacon,
      WebSocket, EventSource). Las de la API de Aurix se contestan aquí con
      respuestas de demo; el resto se rechaza. Además el HTML del build lleva una
      CSP con `connect-src 'self'`: aunque algo esquivase este guard, el navegador
      no saldría del origen de la demo.
   2. SUPABASE: `window.supabase.createClient` devuelve un cliente FALSO que guarda
      todo en el localStorage de ESTE navegador (por visitante, sin compartir nada).
      El acceso por correo se simula: no se envía ningún mensaje y el código es fijo.
   3. IDENTIDAD: una marca discreta «Demo · Datos ficticios · vNNN» y avisos cuando
      una función está simulada o deshabilitada (pagos, precios en vivo, búsqueda).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__AURIX_DEMO_RUNTIME__) return;

  var VERSION = '759';
  var BUILD = 'v799-ws-usability';
  var DEMO_CODE = '24681357';
  var K = { state: 'aurix_demo_state_v1', db: 'aurix_demo_db_v1', auth: 'aurix_demo_auth_v1' };
  var API_HOST = 'demo-api.aurix.invalid';
  var DEMO = window.__AURIX_DEMO_RUNTIME__ = { version: VERSION, build: BUILD, code: DEMO_CODE, blocked: [], answered: [] };

  // ── almacenamiento local de la demo ──────────────────────────────────────
  function rd(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function state() { return rd(K.state, { plan: 'free', persona: 'fresh' }); }
  DEMO.state = state;

  // ── avisos ───────────────────────────────────────────────────────────────
  function toast(msg) {
    try {
      var go = function () {
        var el = document.createElement('div');
        el.className = 'aurix-demo-toast'; el.setAttribute('role', 'status'); el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.classList.add('is-out'); }, 3600);
        setTimeout(function () { try { el.remove(); } catch (_) {} }, 4200);
      };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    } catch (_) {}
  }
  DEMO.toast = toast;
  var _toasted = {};
  function toastOnce(key, msg) { if (_toasted[key]) return; _toasted[key] = 1; toast(msg); }
  var ES = (function () { var l = null; try { l = localStorage.getItem('portfolio_lang'); } catch (_) {} return !/^en/.test(String(l || navigator.language || 'es')); })();
  var L = function (es, en) { return ES ? es : en; };

  // LATENCIA DE RED SIMULADA. Una respuesta local llega en el mismo tick, antes de que el
  // navegador termine de parsear la página; el producto asume (como en la red real) que
  // el documento ya existe cuando vuelven sus datos — p. ej. el onboarding vive en el HTML
  // DESPUÉS de app.js. Así que nada se contesta antes de DOMContentLoaded + ~80 ms.
  var _domReady = new Promise(function (r) { if (document.readyState !== 'loading') r(); else document.addEventListener('DOMContentLoaded', function () { r(); }); });
  function later(v) { return _domReady.then(function () { return new Promise(function (r) { setTimeout(function () { r(typeof v === 'function' ? v() : v); }, 60 + Math.floor(Math.random() * 60)); }); }); }
  DEMO.later = later;

  // ══════════════════════════════════════════════════════════════════════════
  // 1 · RED
  // ══════════════════════════════════════════════════════════════════════════
  function urlOf(input) {
    try { return new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href); } catch (_) { return null; }
  }
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
  }
  // La API de Aurix no existe en la demo. Cada ruta contesta lo que haría el
  // producto SIN servicio: los precios en vivo y la búsqueda quedan «no
  // disponibles» (la app conserva los precios guardados del activo) y el cobro
  // se deshabilita con un aviso. Nunca se finge que una operación se ejecutó.
  function apiRoute(u, init) {
    var p = u.pathname;
    DEMO.answered.push(p);
    if (p.indexOf('/api/billing/') === 0) {
      toast(L('Demo · los pagos están deshabilitados. No se ha creado ningún cargo ni suscripción.', 'Demo · payments are disabled. No charge or subscription was created.'));
      return json(503, { error: 'demo_billing_disabled' });
    }
    if (p === '/api/client-log') return new Response(null, { status: 204 });
    if (p.indexOf('/api/search') === 0 || p.indexOf('/api/assets/') === 0) {
      toastOnce('search', L('Demo · la búsqueda de activos en vivo no está disponible.', 'Demo · live asset search is not available.'));
      return json(503, { error: 'demo_offline' });
    }
    if (p.indexOf('/api/prices') === 0) return json(503, { error: 'demo_offline' });
    return json(503, { error: 'demo_offline' });
  }
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var u = urlOf(input);
    if (u && u.origin === location.origin) return _fetch(input, init);
    if (u && u.hostname === API_HOST) return later(function () { return apiRoute(u, init); });
    DEMO.blocked.push(u ? u.href : String(input));
    return Promise.reject(new TypeError('Aurix demo: red externa deshabilitada'));
  };
  var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (XO) window.XMLHttpRequest.prototype.open = function (m, url) {
    var u = urlOf(url);
    if (u && u.origin !== location.origin) { DEMO.blocked.push(u.href); throw new Error('Aurix demo: red externa deshabilitada'); }
    return XO.apply(this, arguments);
  };
  try {
    var SB = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { var u = urlOf(url); if (u && u.origin !== location.origin) { DEMO.blocked.push(u.href); return true; } return SB ? SB(url, data) : false; };
  } catch (_) {}
  ['WebSocket', 'EventSource'].forEach(function (n) {
    if (!window[n]) return;
    var Orig = window[n];
    window[n] = function (url) { var u = urlOf(url); if (u && u.origin !== location.origin) { DEMO.blocked.push(u.href); throw new Error('Aurix demo: ' + n + ' deshabilitado'); } return new Orig(url); };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2 · SUPABASE FALSO (localStorage de este navegador)
  // ══════════════════════════════════════════════════════════════════════════
  function db() { return rd(K.db, {}); }
  function saveDb(d) { wr(K.db, d); }
  function session() { return rd(K.auth, null); }
  var listeners = [];
  function emit(ev) { var s = session(); listeners.slice().forEach(function (cb) { try { cb(ev, s); } catch (_) {} }); }
  function mkSession(email) {
    var id = 'demo-' + Math.random().toString(36).slice(2, 10);
    var user = { id: id, email: email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', demo: true }, user_metadata: {}, created_at: new Date().toISOString() };
    var s = { access_token: 'demo-token', token_type: 'bearer', refresh_token: 'demo-refresh', expires_in: 315360000, expires_at: Math.floor(Date.now() / 1000) + 315360000, user: user };
    wr(K.auth, s); return s;
  }
  DEMO.mkSession = mkSession;

  function match(row, f) {
    var v = row[f.c];
    switch (f.op) {
      case 'eq': return String(v) === String(f.v);
      case 'neq': return String(v) !== String(f.v);
      case 'gt': return v > f.v; case 'gte': return v >= f.v;
      case 'lt': return v < f.v; case 'lte': return v <= f.v;
      case 'in': return (f.v || []).map(String).indexOf(String(v)) >= 0;
      case 'is': return f.v === null ? (v === null || v === undefined) : v === f.v;
      default: return true;
    }
  }
  function Query(table) {
    this.t = table; this.f = []; this.op = 'select'; this.payload = null; this.opts = {};
    this.ord = null; this.lim = null; this.rng = null; this.one = null; this.ret = false;
  }
  var Q = Query.prototype;
  Q.select = function (c, o) { if (this.op === 'select') this.opts = o || {}; else this.ret = true; return this; };
  Q.insert = function (r) { this.op = 'insert'; this.payload = r; return this; };
  Q.upsert = function (r, o) { this.op = 'upsert'; this.payload = r; this.conflict = (o && o.onConflict) || null; return this; };
  Q.update = function (r) { this.op = 'update'; this.payload = r; return this; };
  Q.delete = function () { this.op = 'delete'; return this; };
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is'].forEach(function (op) { Q[op] = function (c, v) { this.f.push({ c: c, op: op, v: v }); return this; }; });
  Q.filter = function (c, op, v) { this.f.push({ c: c, op: op, v: v }); return this; };
  Q.match = function (o) { var s = this; Object.keys(o || {}).forEach(function (k) { s.f.push({ c: k, op: 'eq', v: o[k] }); }); return s; };
  Q.order = function (c, o) { this.ord = { c: c, asc: !(o && o.ascending === false) }; return this; };
  Q.limit = function (n) { this.lim = n; return this; };
  Q.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.single = function () { this.one = 'single'; return this; };
  Q.maybeSingle = function () { this.one = 'maybe'; return this; };
  Q.abortSignal = function () { return this; };
  Q.then = function (res, rej) { var self = this; return later(function () { return self._run(); }).then(res, rej); };
  Q._run = function () {
    var s = session();
    if (!s) return { data: null, error: { message: 'JWT missing', code: '401' }, status: 401 };
    var uid = s.user.id, all = db(), rows = all[this.t] || [];
    // RLS de la demo: cada visitante sólo ve sus filas, igual que en producción.
    var mine = function (r) { return !('user_id' in r) || r.user_id === uid; };
    var self = this, sel = rows.filter(mine).filter(function (r) { return self.f.every(function (f) { return match(r, f); }); });
    var out;
    if (this.op === 'select') {
      if (this.ord) { var o = this.ord; sel.sort(function (a, b) { return (a[o.c] > b[o.c] ? 1 : a[o.c] < b[o.c] ? -1 : 0) * (o.asc ? 1 : -1); }); }
      if (this.rng) sel = sel.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) sel = sel.slice(0, this.lim);
      out = sel;
      if (this.opts && this.opts.head) out = null;
    } else if (this.op === 'insert' || this.op === 'upsert') {
      var list = Array.isArray(this.payload) ? this.payload : [this.payload];
      var keys = String(this.conflict || 'id').split(',').map(function (x) { return x.trim(); });
      out = [];
      list.forEach(function (r) {
        r = Object.assign({}, r); if (!('user_id' in r) && self.t !== 'billing_prices') r.user_id = uid;
        if (r.user_id !== uid && self.t !== 'billing_prices') return;
        var i = self.op === 'upsert' ? rows.findIndex(function (x) { return keys.every(function (k) { return String(x[k]) === String(r[k]); }); }) : -1;
        if (i >= 0) rows[i] = Object.assign({}, rows[i], r); else { if (!r.id && keys[0] === 'id') r.id = 'demo_' + Math.random().toString(36).slice(2, 10); rows.push(r); }
        out.push(i >= 0 ? rows[i] : r);
      });
      all[this.t] = rows; saveDb(all);
    } else if (this.op === 'update') {
      sel.forEach(function (r) { Object.assign(r, self.payload); });
      all[this.t] = rows; saveDb(all); out = sel;
    } else if (this.op === 'delete') {
      all[this.t] = rows.filter(function (r) { return sel.indexOf(r) < 0; }); saveDb(all); out = sel;
    }
    var count = Array.isArray(out) ? out.length : sel.length;
    if (this.one) {
      if (!out || !out.length) return this.one === 'maybe' ? { data: null, error: null, status: 200 } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
      return { data: out[0], error: null, status: 200, count: count };
    }
    return { data: (this.op === 'select' || this.ret) ? out : null, error: null, status: 200, count: (this.opts && this.opts.count) ? count : null };
  };

  function entitlements() {
    var prem = state().plan === 'premium';
    var canon = [];
    try { canon = Array.prototype.slice.call(_AURIX_ENT_CANON); } catch (_) {}   // eslint-disable-line no-undef
    var f = {}, src = {};
    canon.forEach(function (k) { f[k] = prem && k !== 'workspace.catalog_preview'; src[k] = 'demo'; });
    return [{ plan: prem ? 'premium' : 'free', subscription_status: prem ? 'active' : 'none', source: 'demo', valid_until: null, features: f, feature_sources: src }];
  }

  var client = {
    auth: {
      getSession: function () { return later(function () { return { data: { session: session() }, error: null }; }); },
      getUser: function () { return later(function () { var s = session(); return s ? { data: { user: s.user }, error: null } : { data: { user: null }, error: { message: 'Auth session missing!', name: 'AuthSessionMissingError' } }; }); },
      onAuthStateChange: function (cb) { listeners.push(cb); setTimeout(function () { try { cb('INITIAL_SESSION', session()); } catch (_) {} }, 0); return { data: { subscription: { unsubscribe: function () { var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } }; },
      // ACCESO POR CORREO SIMULADO: no se envía nada. El código fijo se enseña en pantalla.
      signInWithOtp: function (o) {
        var em = o && o.email; wr('aurix_demo_otp_email', em || '');
        toast(L('Demo · no se ha enviado ningún correo. Tu código de prueba es ' + DEMO_CODE + '.', 'Demo · no email was sent. Your test code is ' + DEMO_CODE + '.'));
        return new Promise(function (r) { setTimeout(function () { r({ data: { user: null, session: null }, error: null }); }, 450); });
      },
      verifyOtp: function (o) {
        return new Promise(function (r) { setTimeout(function () {
          if (!o || String(o.token || '').trim() !== DEMO_CODE) { r({ data: { user: null, session: null }, error: { message: 'Token has expired or is invalid', status: 403, code: 'otp_expired', name: 'AuthApiError' } }); return; }
          var s = mkSession((o && o.email) || rd('aurix_demo_otp_email', 'demo@aurix.invalid'));
          r({ data: { user: s.user, session: s }, error: null }); emit('SIGNED_IN');
        }, 450); });
      },
      signOut: function () { try { localStorage.removeItem(K.auth); } catch (_) {} emit('SIGNED_OUT'); return Promise.resolve({ error: null }); },
      updateUser: function () { var s = session(); return Promise.resolve({ data: { user: s ? s.user : null }, error: null }); },
      refreshSession: function () { return Promise.resolve({ data: { session: session() }, error: null }); },
      setSession: function () { return Promise.resolve({ data: { session: session() }, error: null }); },
      exchangeCodeForSession: function () { return Promise.resolve({ data: { session: session() }, error: null }); },
      resetPasswordForEmail: function () { toast(L('Demo · no se ha enviado ningún correo.', 'Demo · no email was sent.')); return Promise.resolve({ data: {}, error: null }); },
    },
    from: function (t) { return new Query(t); },
    rpc: function (name) {
      if (name === 'aurix_entitlements') return later(function () { return { data: entitlements(), error: null }; });
      // El registro histórico de correos de acceso NO se escribe en la demo: el correo no sale de este navegador.
      if (name === 'persist_access_email') return Promise.resolve({ data: null, error: null });
      if (name === 'validate_invite_code') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: { message: 'demo: rpc ' + name + ' no disponible', code: 'PGRST202' } });
    },
    channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; }, unsubscribe: function () { return Promise.resolve('ok'); } }; return c; },
    removeChannel: function () { return Promise.resolve('ok'); },
    storage: { from: function () { return { upload: function () { return Promise.resolve({ data: null, error: { message: 'demo' } }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: { message: 'demo' } }); } },
  };
  window.supabase = { createClient: function () { return client; } };

  // ══════════════════════════════════════════════════════════════════════════
  // 3 · IDENTIDAD DE LA DEMO
  // ══════════════════════════════════════════════════════════════════════════
  function badge() {
    if (document.getElementById('aurixDemoBadge')) return;
    var st = state();
    var a = document.createElement('a');
    a.id = 'aurixDemoBadge'; a.href = 'demo.html';
    a.setAttribute('aria-label', L('Demo con datos ficticios, versión ', 'Demo with fictitious data, version ') + VERSION + L('. Abrir el panel de la demo.', '. Open the demo panel.'));
    a.textContent = L('Demo · Datos ficticios · ', 'Demo · Fictitious data · ') + 'v' + VERSION + (session() ? ' · ' + (st.plan === 'premium' ? 'Premium' : 'Free') : '');
    document.body.appendChild(a);
    if (/login\.html$/.test(location.pathname)) {
      var n = document.createElement('div');
      n.className = 'aurix-demo-loginnote'; n.setAttribute('role', 'note');
      n.textContent = L('Demo: escribe cualquier correo (no se envía nada). Código de acceso: ', 'Demo: type any email (nothing is sent). Access code: ') + DEMO_CODE;
      document.body.appendChild(n);
    }
  }
  var css = '#aurixDemoBadge{position:fixed;z-index:2147483000;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 74px);'
    + 'font:600 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.02em;color:#ffd38a;background:rgba(20,16,6,.88);border:1px solid rgba(255,196,96,.45);'
    + 'padding:5px 10px;border-radius:999px;text-decoration:none;white-space:nowrap;pointer-events:auto;opacity:.92}'
    + '@media (min-width:900px){#aurixDemoBadge{bottom:14px;right:14px}}'
    + '#aurixDemoBadge:focus-visible{outline:2px solid #ffd38a;outline-offset:2px}'
    + '.aurix-demo-loginnote{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);max-width:520px;margin:0 auto;'
    + 'font:500 13px/1.4 Inter,system-ui,sans-serif;color:#ffe2ad;background:rgba(20,16,6,.92);border:1px solid rgba(255,196,96,.45);border-radius:12px;padding:10px 14px;text-align:center}'
    + 'body:has(.aurix-demo-loginnote) #aurixDemoBadge{bottom:auto;top:calc(env(safe-area-inset-top,0px) + 8px)}'
    + '.aurix-demo-toast{position:fixed;z-index:2147483001;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);max-width:min(92vw,520px);'
    + 'font:500 13px/1.4 Inter,system-ui,sans-serif;color:#fff3dc;background:rgba(28,22,8,.96);border:1px solid rgba(255,196,96,.5);border-radius:12px;padding:10px 14px;'
    + 'box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .4s}'
    + '.aurix-demo-toast.is-out{opacity:0}';
  function mount() {
    try { var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); } catch (_) {}
    badge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
