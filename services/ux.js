// UX-LOADING-1: shared async-button busy helper.
//
// Standardizes the on/off pattern that was previously ad-hoc across
// the OTP flow, add-asset forms and inline action buttons:
//   - disabled attribute (preserves form + a11y semantics)
//   - aria-busy="true" for screen readers
//   - is-loading class for the CSS opacity + cursor signal
//   - optional text swap with the original width frozen, so the
//     button never reflows the row when the label changes length
//
// Loaded synchronously before any handler that might call it (after
// config.js, before the auth/app scripts). Removable: delete this
// file plus every setButtonBusy() call site — no other surface
// depends on it.

(function () {
  'use strict';

  function setButtonBusy(btn, busy, busyText) {
    if (!btn) return;
    try {
      if (busy) {
        // Snapshot label + width ONCE per busy session, so a caller
        // that toggles busy(true) repeatedly does not overwrite the
        // original label with a previous busy label.
        if (btn.dataset._uxOrigLabel == null) {
          btn.dataset._uxOrigLabel    = btn.innerText || btn.textContent || '';
          btn.dataset._uxOrigMinWidth = btn.style.minWidth || '';
          var w = btn.offsetWidth;
          if (w > 0) btn.style.minWidth = w + 'px';
        }
        btn.setAttribute('aria-busy', 'true');
        btn.classList.add('is-loading');
        btn.disabled = true;
        if (busyText) btn.innerText = busyText;
      } else {
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-loading');
        btn.disabled = false;
        if (btn.dataset._uxOrigLabel != null) {
          btn.innerText      = btn.dataset._uxOrigLabel;
          btn.style.minWidth = btn.dataset._uxOrigMinWidth || '';
          delete btn.dataset._uxOrigLabel;
          delete btn.dataset._uxOrigMinWidth;
        }
      }
    } catch (_) { /* never block UX on helper failure */ }
  }

  window.setButtonBusy = setButtonBusy;
})();
