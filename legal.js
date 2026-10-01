// ════════════════════════════════════════════════════════════════════════════
// AURIX · idioma de las páginas públicas (soporte y legales)
// ════════════════════════════════════════════════════════════════════════════
// Lo único que hace: decidir si se muestra el bloque español o el inglés, y
// recordar la elección. No hay sesión, no hay red, no hay almacenamiento de
// datos personales y no se carga nada de terceros.
//
// NO ES UN SEGUNDO OWNER DEL IDIOMA. `switchLang()` sigue siendo el owner único
// DENTRO de la app; estas páginas no pueden llamarlo (no cargan `app.js`), así
// que se limitan a LEER la preferencia ya escrita y a escribirla con las MISMAS
// claves para que la app y estas páginas no se contradigan:
//   · `portfolio_lang` — la del producto (`LANG_KEY` en app.js)
//   · `aurix_lang`     — la de la web pública (`LS_KEY` en landing/app.js)
// Prioridad: `?lang=` explícito → preferencia guardada → idioma del navegador.
(function () {
  var APP_KEY = 'portfolio_lang';
  var WEB_KEY = 'aurix_lang';
  var ok = function (v) { return v === 'es' || v === 'en' ? v : null; };

  function readStored() {
    try { return ok(localStorage.getItem(APP_KEY)) || ok(localStorage.getItem(WEB_KEY)); }
    catch (_) { return null; }   // Safari en privado lanza: no es motivo para no pintar
  }
  function fromQuery() {
    try {
      var m = /[?&]lang=([a-z]{2})/i.exec(location.search || '');
      return m ? ok(m[1].toLowerCase()) : null;
    } catch (_) { return null; }
  }
  function fromBrowser() {
    try { return /^es/i.test(navigator.language || '') ? 'es' : 'en'; } catch (_) { return 'es'; }
  }

  function apply(lang, persist) {
    document.documentElement.lang = lang;
    var btns = document.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], on = b.getAttribute('data-set-lang') === lang;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // El título de la pestaña también es contenido.
    var t = document.querySelector('[data-title-' + lang + ']');
    if (t) { try { document.title = t.getAttribute('data-title-' + lang); } catch (_) {} }
    if (persist) {
      // Se escriben las DOS claves: si sólo se escribiera una, volver a la app
      // (o a la landing) revertiría la elección que el usuario acaba de hacer.
      try { localStorage.setItem(APP_KEY, lang); localStorage.setItem(WEB_KEY, lang); } catch (_) {}
    }
    // Los enlaces internos conservan el idioma: cambiarlo en Soporte y perderlo
    // al abrir Privacidad sería cambiar de idioma a mitad de la lectura.
    var links = document.querySelectorAll('[data-lg-link]');
    for (var j = 0; j < links.length; j++) {
      links[j].href = links[j].getAttribute('data-lg-link') + '?lang=' + lang;
    }
  }

  apply(fromQuery() || readStored() || fromBrowser(), false);

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-set-lang]') : null;
    if (!b) return;
    apply(b.getAttribute('data-set-lang'), true);
  });
})();
