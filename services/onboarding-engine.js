'use strict';
/**
 * Aurix Onboarding / Activation engine.
 *
 * Deterministic state machine + hybrid persistence (localStorage primary,
 * Supabase optional via best-effort upsert on a `user_onboarding` table —
 * silently no-op if the table is absent). Decoupled from UI: this module
 * never touches the DOM. It exposes a single global `window.AurixOnboarding`
 * with the API contract defined in the spec (section 6).
 *
 * UI bindings (modal mount/unmount, language switching, add-asset call,
 * skip button, etc.) live in app.js and subscribe via:
 *   window.addEventListener('aurix:onboarding-state', e => e.detail)
 */
(function () {
  const LS = {
    completed:   'aurix_onboarding_completed',
    step:        'aurix_onboarding_step',
    preferences: 'aurix_onboarding_preferences',
  };

  const STATES = Object.freeze({
    NOT_STARTED: 'NOT_STARTED',
    LANGUAGE:    'LANGUAGE',
    WELCOME:     'WELCOME',
    INTERESTS:   'INTERESTS',
    EXPERIENCE:  'EXPERIENCE',
    // ONBOARDING-PROFILE-UI-1 — single premium step that collects
    // riskProfile (required, defaults to 'balanced') and ageBand
    // (optional, defaults to 'prefer_not_say'). Sits AFTER experience
    // because the user has already declared a posture by then; this
    // step refines the signal tone without feeling like a quiz.
    PROFILE:     'PROFILE',
    ACTIVATION:  'ACTIVATION',
    SUCCESS:     'SUCCESS',
    COMPLETED:   'COMPLETED',
  });

  // ── ONBOARDING-EXCELLENCE-V1 ─────────────────────────────────────
  // Forward order — back-navigation uses ORDER.indexOf to find the previous.
  // El recorrido pasa de 7 estados visibles a 4 momentos. Los estados retirados
  // NO se borran de STATES: siguen existiendo para poder MIGRAR a quien quedó
  // parado en ellos, y sus datos siguen siendo válidos y editables en Ajustes.
  //   • INTERESTS  → vive ahora dentro de WELCOME (una pantalla, no dos).
  //   • EXPERIENCE → `experience` no gobernaba ningún comportamiento.
  //   • PROFILE    → `ageBand` tampoco, y `riskProfile` sólo matizaba el tono de
  //                  una frase: no se pregunta antes de haber entregado valor.
  const ORDER = [
    STATES.LANGUAGE,
    STATES.WELCOME,
    STATES.ACTIVATION,
    STATES.SUCCESS,
  ];

  // Estados que ya no forman parte del recorrido → dónde continúa cada uno. Un
  // usuario a mitad NUNCA puede quedar atrapado en un paso que dejó de existir:
  // el que aún no había elegido intereses vuelve a WELCOME (allí están), y el que
  // ya los eligió sigue hacia ACTIVATION, que es lo único que le queda por hacer.
  const RETIRED_STEP_MIGRATION = Object.freeze({
    [STATES.INTERESTS]:  STATES.WELCOME,
    [STATES.EXPERIENCE]: STATES.ACTIVATION,
    [STATES.PROFILE]:    STATES.ACTIVATION,
  });
  function _migrateRetiredStep(step) {
    return RETIRED_STEP_MIGRATION[step] || step;
  }

  // ── Runtime flags (spec §7) ──────────────────────────────────────
  // Mutable on window so the legacy global pattern in app.js can read them.
  if (typeof window._aurixOnboardingInProgress === 'undefined') {
    window._aurixOnboardingInProgress = false;
  }
  if (typeof window._aurixOnboardingGeneration === 'undefined') {
    window._aurixOnboardingGeneration = 0;
  }
  window._aurixIsOnboardingStale = function (gen) {
    return gen !== window._aurixOnboardingGeneration;
  };

  // In-memory mirror of the persisted record. Source of truth for the UI.
  // INVESTOR-PROFILE-1 — riskProfile + ageBand are optional additive
  // fields. Missing values stay null (the signal layer applies safe
  // defaults — balanced / intermediate / prefer_not_say — at read time).
  // Existing flows that ignore these fields keep working unchanged.
  let _state = {
    state:        STATES.NOT_STARTED,
    completed:    false,
    language:     null,
    interests:    [],
    experience:   null,
    riskProfile:  null,
    ageBand:      null,
    completedAt:  null,
  };
  let _hydrated = false;

  // ONBOARDING-1B: visible sync diagnostics. UX stays silent if the
  // user_onboarding table is missing, but `__aurixOnboardingDebug()` must
  // surface every attempt so developers can detect the schema gap.
  const _sync = {
    attempted:        false,
    success:          false,
    lastError:        null,
    lastAttemptAt:    null,
    lastSuccessAt:    null,
  };

  // ── Helpers ──────────────────────────────────────────────────────
  function _safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function _safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function _safeRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function _emit(eventName, detail) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: detail || {} }));
    } catch (_) {}
  }

  function _emitState() {
    _emit('aurix:onboarding-state', getSnapshot());
  }

  // Analytics hooks (spec §26) — no-op stubs, callers should never need a guard.
  function _analytics(event, payload) {
    if (typeof window.aurixAnalytics === 'function') {
      try { window.aurixAnalytics(event, payload || {}); } catch (_) {}
    }
  }

  function _readAssetsLength() {
    // Single, trusted source of truth: the canonical "aurix_assets" catalog.
    // Resilient to the legacy "portfolio_assets" key too.
    try {
      const raw = localStorage.getItem('aurix_assets');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.length;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem('portfolio_assets');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.length;
        if (parsed && Array.isArray(parsed.assets)) return parsed.assets.length;
      }
    } catch (_) {}
    // Fall back to the in-memory global if present (e.g. boot already ran load()).
    if (Array.isArray(window.assets)) return window.assets.length;
    return 0;
  }

  // ── Persistence (hybrid) ─────────────────────────────────────────
  function _readLocal() {
    const completed = _safeGet(LS.completed) === '1';
    const step = _safeGet(LS.step) || STATES.NOT_STARTED;
    let prefs = {};
    try { prefs = JSON.parse(_safeGet(LS.preferences) || '{}') || {}; } catch (_) {}
    return {
      // ONBOARDING-EXCELLENCE-V1 — migración en la LECTURA: quien quedó parado en
      // un paso retirado entra ya en el estado válido, sin pantalla intermedia.
      state:        completed ? STATES.COMPLETED : _migrateRetiredStep(step),
      completed,
      language:     prefs.language     || null,
      interests:    Array.isArray(prefs.interests) ? prefs.interests : [],
      experience:   prefs.experience   || null,
      // INVESTOR-PROFILE-1 — additive optional fields.
      riskProfile:  prefs.riskProfile  || null,
      ageBand:      prefs.ageBand      || null,
      completedAt:  prefs.completedAt  || null,
    };
  }

  function _writeLocal(s) {
    if (s.completed) _safeSet(LS.completed, '1');
    else             _safeRemove(LS.completed);
    _safeSet(LS.step, s.state || STATES.NOT_STARTED);
    _safeSet(LS.preferences, JSON.stringify({
      language:    s.language,
      interests:   s.interests || [],
      experience:  s.experience,
      riskProfile: s.riskProfile || null,
      ageBand:     s.ageBand     || null,
      completedAt: s.completedAt || null,
    }));
  }

  // Best-effort Supabase upsert. Silently no-ops to the user if the
  // client, user, or table are missing — but every attempt is recorded
  // in `_sync` so `__aurixOnboardingDebug()` can expose the failure.
  // localStorage remains the source of truth; backend is a sync mirror.
  async function _syncRemote(s) {
    _sync.attempted     = true;
    _sync.lastAttemptAt = new Date().toISOString();
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        _sync.success = false;
        _sync.lastError = 'supabase client unavailable';
        return;
      }
      if (typeof currentUser === 'undefined' || !currentUser) {
        _sync.success = false;
        _sync.lastError = 'no authenticated user';
        return;
      }
      const { error } = await supabaseClient
        .from('user_onboarding')
        .upsert({
          user_id:                currentUser.id,
          onboarding_completed:   !!s.completed,
          onboarding_step:        s.state || null,
          preferred_language:     s.language || null,
          tracked_asset_types:    s.interests || [],
          experience_level:       s.experience || null,
          onboarding_completed_at: s.completedAt || null,
          updated_at:             new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (error) {
        _sync.success   = false;
        _sync.lastError = error.message || String(error);
      } else {
        _sync.success       = true;
        _sync.lastError     = null;
        _sync.lastSuccessAt = new Date().toISOString();
      }
    } catch (e) {
      _sync.success   = false;
      _sync.lastError = (e && e.message) ? e.message : String(e);
    }
  }

  async function _readRemote() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) return null;
      if (typeof currentUser     === 'undefined' || !currentUser)   return null;
      const { data, error } = await supabaseClient
        .from('user_onboarding')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();
      if (error || !data) return null;
      return {
        state:        data.onboarding_completed ? STATES.COMPLETED : (data.onboarding_step || STATES.NOT_STARTED),
        completed:    !!data.onboarding_completed,
        language:     data.preferred_language || null,
        interests:    Array.isArray(data.tracked_asset_types) ? data.tracked_asset_types : [],
        experience:   data.experience_level || null,
        completedAt:  data.onboarding_completed_at || null,
      };
    } catch (_) { return null; }
  }

  // ── Public: hydration ────────────────────────────────────────────
  async function hydrateOnboardingState() {
    const local = _readLocal();
    // Local always wins for `completed=true` so a logged-out skip
    // survives a reload even before remote loads.
    let merged = local;
    const remote = await _readRemote();
    if (remote) {
      // Backend takes priority when it reports completion (cross-device).
      if (remote.completed) merged = remote;
      // Otherwise prefer remote step only if local has nothing meaningful.
      else if (!local.completed && local.state === STATES.NOT_STARTED) {
        merged = remote;
      }
    }
    // Auto-infer from portfolio (spec §2 failsafe).
    if (!merged.completed && _readAssetsLength() > 0) {
      merged = { ...merged, state: STATES.COMPLETED, completed: true, completedAt: merged.completedAt || new Date().toISOString() };
      _writeLocal(merged);
      _syncRemote(merged);
    }
    _state = merged;
    _hydrated = true;
    return getSnapshot();
  }

  // ── Public: predicate (spec §2) ──────────────────────────────────
  function shouldShowOnboarding(user, assetsArg) {
    if (!user || user.authenticated === false) return false;
    if (window._aurixResetInProgress)   return false;
    if (window._aurixOnboardingInProgress) return false;
    if (_state.completed) return false;
    const len = Array.isArray(assetsArg) ? assetsArg.length : _readAssetsLength();
    if (len > 0) {
      // Failsafe — never show onboarding if a portfolio already exists.
      // Mark complete so the predicate is stable across calls.
      completeOnboarding({ silent: true });
      return false;
    }
    return true;
  }

  // ── Public: lifecycle ────────────────────────────────────────────
  function startOnboarding() {
    if (window._aurixOnboardingInProgress) return getSnapshot();
    window._aurixOnboardingGeneration++;
    window._aurixOnboardingInProgress = true;
    _state = { ..._state, state: STATES.LANGUAGE, completed: false };
    _writeLocal(_state);
    _analytics('onboarding_started', {});
    _emitState();
    return getSnapshot();
  }

  function setStep(step) {
    if (!ORDER.includes(step) && step !== STATES.COMPLETED) return getSnapshot();
    _state = { ..._state, state: step };
    _writeLocal(_state);
    // ONBOARDING-EXCELLENCE-V1 — el paso también viaja al backend. Antes sólo se
    // escribía en local, así que `onboarding_step` remoto se quedaba en el valor
    // de la última preferencia guardada: un segundo dispositivo no reanudaba donde
    // el usuario lo había dejado. Es el mismo upsert idempotente que ya existía
    // (mismo `onConflict: user_id`), no una ruta nueva, y es fail-soft: sin red el
    // comportamiento local es exactamente el de siempre.
    _syncRemote(_state);
    _emitState();
    return getSnapshot();
  }

  function nextStep() {
    const idx = ORDER.indexOf(_state.state);
    if (idx < 0) return setStep(STATES.LANGUAGE);
    const next = ORDER[idx + 1];
    if (!next) return completeOnboarding();
    return setStep(next);
  }

  function previousStep() {
    const idx = ORDER.indexOf(_state.state);
    if (idx <= 0) return getSnapshot();
    return setStep(ORDER[idx - 1]);
  }

  function setLanguage(language) {
    if (!language) return getSnapshot();
    _state = { ..._state, language };
    _writeLocal(_state);
    _syncRemote(_state);
    _analytics('language_selected', { language });
    _emitState();
    return getSnapshot();
  }

  function savePreferences(data) {
    const next = { ..._state };
    if (data && Array.isArray(data.interests)) {
      next.interests = data.interests.slice();
      _analytics('interests_selected', { interests: next.interests });
    }
    if (data && typeof data.experience === 'string') {
      next.experience = data.experience;
      _analytics('experience_selected', { experience: data.experience });
    }
    if (data && typeof data.language === 'string') {
      next.language = data.language;
    }
    // INVESTOR-PROFILE-1 — accept the new fields. Allow null to clear.
    if (data && typeof data.riskProfile !== 'undefined') {
      next.riskProfile = (typeof data.riskProfile === 'string' && data.riskProfile) ? data.riskProfile : null;
      _analytics('risk_profile_selected', { riskProfile: next.riskProfile });
    }
    if (data && typeof data.ageBand !== 'undefined') {
      next.ageBand = (typeof data.ageBand === 'string' && data.ageBand) ? data.ageBand : null;
      _analytics('age_band_selected', { ageBand: next.ageBand });
    }
    _state = next;
    _writeLocal(_state);
    _syncRemote(_state);
    _emitState();
    return getSnapshot();
  }

  // ── ONBOARDING-EXCELLENCE-V1 — DIFERIR NO ES COMPLETAR ────────────
  // `skipOnboarding()` llamaba a `completeOnboarding()`: un toque en la esquina
  // superior marcaba COMPLETED de forma permanente, en local Y en remoto, y el
  // usuario no volvía a ver el onboarding nunca — pudiendo quedarse sin añadir su
  // primer activo. Era la mayor fuga de activación del flujo.
  // Diferir CONSERVA el paso en curso y no toca `completed`, así que la próxima
  // entrada reanuda exactamente donde estaba. Sin diálogo de confirmación: el
  // usuario que pulsa "Lo haré más tarde" ya ha decidido.
  function deferOnboarding() {
    _analytics('onboarding_deferred', { fromState: _state.state });
    // El estado permanece tal cual (no se avanza ni se retrocede) y se persiste
    // para que la reanudación sea determinista también tras cerrar la pestaña.
    _writeLocal(_state);
    _syncRemote(_state);
    _emitState();
    return getSnapshot();
  }
  // Compat: cualquier llamador antiguo de `skipOnboarding()` obtiene la semántica
  // nueva. No queda ninguna ruta que marque COMPLETED sin haber terminado.
  function skipOnboarding() {
    return deferOnboarding();
  }

  function completeOnboarding(opts) {
    const silent = !!(opts && opts.silent);
    const completedAt = new Date().toISOString();
    _state = { ..._state, state: STATES.COMPLETED, completed: true, completedAt };
    _writeLocal(_state);
    _syncRemote(_state);
    window._aurixOnboardingInProgress = false;
    if (!silent) _analytics('completed', { at: completedAt });
    _emitState();
    return getSnapshot();
  }

  function clearOnboardingState() {
    _safeRemove(LS.completed);
    _safeRemove(LS.step);
    _safeRemove(LS.preferences);
    _state = {
      state:       STATES.NOT_STARTED,
      completed:   false,
      language:    null,
      interests:   [],
      experience:  null,
      riskProfile: null,
      ageBand:     null,
      completedAt: null,
    };
    window._aurixOnboardingInProgress = false;
    _emitState();
    return getSnapshot();
  }

  function getSnapshot() {
    return {
      state:       _state.state,
      completed:   _state.completed,
      language:    _state.language,
      interests:   _state.interests.slice(),
      experience:  _state.experience,
      riskProfile: _state.riskProfile,
      ageBand:     _state.ageBand,
      completedAt: _state.completedAt,
      hydrated:    _hydrated,
    };
  }

  // ── Event integration (spec §20) ────────────────────────────────
  // Listen for the first asset added. When the user is in ACTIVATION,
  // transition to SUCCESS. Auto-complete trigger (spec §19B).
  window.addEventListener('aurix:asset-added', function () {
    // ONBOARDING-1B §4: ignore late events if onboarding has already
    // completed (silently no-op so the user can keep adding assets
    // post-onboarding without re-triggering the success flow).
    if (_state.completed) return;
    // Only act if onboarding is in flight. Avoid clobbering a clean
    // post-completion state when the user adds more assets later.
    if (!window._aurixOnboardingInProgress) return;
    if (_state.state === STATES.ACTIVATION) {
      setStep(STATES.SUCCESS);
      // ONBOARDING-EXCELLENCE-V1 — evento semántico del funnel. Reutiliza el
      // `_analytics` que ya existía (window.aurixAnalytics): sin proveedor nuevo.
      _analytics('first_asset_added', { fromState: STATES.ACTIVATION });
      _analytics('activation_completed', {});
    }
  });

  // Reset integration (spec §4) — when the atomic reset wipes storage,
  // a custom event is dispatched so the engine clears its in-memory copy.
  window.addEventListener('aurix:reset', function () {
    clearOnboardingState();
  });

  // ── Public surface ──────────────────────────────────────────────
  window.AurixOnboarding = {
    STATES,
    ORDER,
    LS_KEYS:               Object.values(LS),
    shouldShowOnboarding,
    hydrateOnboardingState,
    startOnboarding,
    nextStep,
    previousStep,
    setStep,
    setLanguage,
    savePreferences,
    skipOnboarding,
    deferOnboarding,
    completeOnboarding,
    clearOnboardingState,
    getSnapshot,
  };

  // ONBOARDING-1B §1 / 2B §17: developer-facing diagnostics. Returns a
  // snapshot of local persistence + the last Supabase sync attempt +
  // UI runtime flags (awaiting-asset etc.) when the UI module is loaded.
  // Never exposes auth tokens, session secrets, or raw user records.
  // DEBUG-HARDEN-1: only attached on localhost / dev hosts / explicit
  // localStorage.aurix_debug=1 opt-in. Production keeps this name
  // `undefined` on window.
  function _isDebugHost() {
    try {
      const h = String((window.location && window.location.hostname) || '').toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
      if (h.endsWith('.local')) return true;
      if (h.startsWith('dev.') || h.startsWith('dev-') || h.includes('-dev.') || h.includes('.dev.')) return true;
    } catch (_) {}
    try { if (localStorage.getItem('aurix_debug') === '1') return true; } catch (_) {}
    return false;
  }
  if (!_isDebugHost()) return;
  window.__aurixOnboardingDebug = function () {
    const local = _readLocal();
    // Optional UI snapshot from the wiring IIFE in app.js.
    let ui = null;
    try {
      if (typeof window._aurixOnbUiState === 'function') {
        ui = window._aurixOnbUiState();
      }
    } catch (_) { ui = null; }
    return {
      // Local persistence (source of truth)
      local: {
        completed:   local.completed,
        step:        local.state,
        preferences: {
          language:   local.language,
          interests:  local.interests,
          experience: local.experience,
          completedAt: local.completedAt,
        },
      },
      // Backend sync diagnostics
      backend: {
        attempted:     _sync.attempted,
        success:       _sync.success,
        lastError:     _sync.lastError,
        lastAttemptAt: _sync.lastAttemptAt,
        lastSuccessAt: _sync.lastSuccessAt,
        clientPresent: (typeof supabaseClient !== 'undefined' && !!supabaseClient),
        userPresent:   (typeof currentUser !== 'undefined' && !!currentUser),
      },
      // Runtime
      currentState: _state.state,
      hydrated:     _hydrated,
      inProgress:   !!window._aurixOnboardingInProgress,
      generation:   window._aurixOnboardingGeneration | 0,
      // UI-level flags surfaced by the wiring layer (null if not loaded)
      ui:           ui,
    };
  };
})();
