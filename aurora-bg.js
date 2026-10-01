/**
 * aurora-bg.js
 * Standalone animated background for the insights screen.
 * Runs in its own RAF loop — no dependency on app.js.
 */
(function () {
  'use strict';

  // ── Canvas ──────────────────────────────────────────────────
  const canvas = document.getElementById('aurora-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener('resize', resize, { passive: true });

  // ── Center ───────────────────────────────────────────────────
  const centerX = () => W / 2;
  const centerY = () => H / 2;

  // ── Pointer ──────────────────────────────────────────────────
  let pointerX = 0;
  let pointerY = 0;

  window.addEventListener('mousemove', e => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (e.touches[0]) {
      pointerX = e.touches[0].clientX;
      pointerY = e.touches[0].clientY;
    }
  }, { passive: true });

  // ── Particles ────────────────────────────────────────────────
  const isMobile  = window.innerWidth < 768;
  const FAR_COUNT  = isMobile ? 60 : 100;
  const NEAR_COUNT = isMobile ? 40 :  70;

  let particlesFar  = [];
  let particlesNear = [];

  function spawnParticle(depth) {
    const radius   = Math.min(W || window.innerWidth, H || window.innerHeight) * (depth === 1 ? 0.7 : 0.6);
    const angle    = Math.random() * Math.PI * 2;
    const distance = Math.pow(Math.random(), depth === 1 ? 1.1 : 1.3) * radius;
    const cx       = (W || window.innerWidth)  / 2;
    const cy       = (H || window.innerHeight) / 2;

    return {
      x:     cx + Math.cos(angle) * distance,
      y:     cy + Math.sin(angle) * distance,
      vx:    (Math.random() - 0.5) * (depth === 1 ? 0.15 : 0.25),
      vy:    (Math.random() - 0.5) * (depth === 1 ? 0.15 : 0.25),
      size:  depth === 1
        ? Math.random() * 1.2 + 0.3
        : Math.random() * 2.2 + 0.5,
      alpha: depth === 1
        ? Math.random() * 0.4 + 0.2
        : Math.random() * 0.7 + 0.3,
      depth,
    };
  }

  function initParticles() {
    particlesFar  = [];
    particlesNear = [];
    for (let i = 0; i < FAR_COUNT;  i++) particlesFar.push(spawnParticle(1));
    for (let i = 0; i < NEAR_COUNT; i++) particlesNear.push(spawnParticle(2));
  }

  // ── Aurora blobs ─────────────────────────────────────────────
  const BLOB_COUNT  = 6;
  const auroraBlobs = [];

  function makeBlob() {
    return {
      x:      Math.random() * window.innerWidth,
      y:      Math.random() * window.innerHeight,
      radius: 200 + Math.random() * 250,
      seed:   Math.random() * 1000,
      alpha:  0.04 + Math.random() * 0.04,
      hue:    Math.random() < 0.5 ? 185 : 155,
    };
  }

  function initBlobs() {
    for (let i = 0; i < BLOB_COUNT; i++) auroraBlobs.push(makeBlob());
  }

  // ── Glow pulses ──────────────────────────────────────────────
  const GLOW_N = 5;
  const glows  = new Array(GLOW_N);

  function makeGlow(startVisible) {
    const isCyan  = Math.random() < 0.42;
    const hue     = isCyan ? 170 + Math.random() * 30 : 220 + Math.random() * 50;
    const target  = 0.032 + Math.random() * 0.042;
    return {
      x:             Math.random() * window.innerWidth,
      y:             Math.random() * window.innerHeight * 0.85,
      radius:        130 + Math.random() * 230,
      opacity:       startVisible ? Math.random() * target : 0,
      targetOpacity: target,
      phase:         startVisible ? 'hold' : 'in',
      holdMs:        0,
      holdMax:       4000 + Math.random() * 7000,
      speed:         0.0022 + Math.random() * 0.0028,
      hue,
    };
  }

  function initGlows() {
    for (let i = 0; i < GLOW_N; i++) glows[i] = makeGlow(true);
  }

  // ── Micro sparkles ───────────────────────────────────────────
  const SPARKLE_COUNT = 15;
  const sparkles      = [];

  function makeSparkle() {
    return {
      x:    Math.random() * window.innerWidth,
      y:    Math.random() * window.innerHeight,
      seed: Math.random() * 1000,
      size: 0.5 + Math.random() * 1.0,
    };
  }

  function initSparkles() {
    for (let i = 0; i < SPARKLE_COUNT; i++) sparkles.push(makeSparkle());
  }

  // ── Visibility state ─────────────────────────────────────────
  let _active         = false;
  let lastActiveState = null;

  function setActive(val) {
    _active = val;
  }

  function isInsightsActive() {
    const el = document.getElementById('tabPlaceholder');
    return !!el &&
           el.style.display !== 'none' &&
           !!el.querySelector('.insights-screen');
  }

  function initObserver() {
    const el = document.getElementById('tabPlaceholder');
    if (!el) return;
    const obs = new MutationObserver(() => {
      setActive(isInsightsActive());
    });
    obs.observe(el, {
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  // ── Particle helpers ─────────────────────────────────────────
  const PARTICLE_MAX_DIST = () => Math.min(W, H) * 0.8;

  function updateParticle(p) {
    const cx = centerX();
    const cy = centerY();

    p.vx += (cx - p.x) * 0.000008;
    p.vy += (cy - p.y) * 0.000008;

    // Pointer repel
    const pdx   = p.x - pointerX;
    const pdy   = p.y - pointerY;
    const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pdist < 120) {
      const force = (120 - pdist) / 120;
      p.vx += pdx * force * 0.02;
      p.vy += pdy * force * 0.02;
    }

    p.vx *= 0.98;
    p.vy *= 0.98;
    p.x  += p.vx;
    p.y  += p.vy;

    // Twinkle
    p.alpha += (Math.random() - 0.5) * 0.02;
    p.alpha  = Math.max(0.1, Math.min(p.alpha, 1));

    // Recycle if escaped
    if (Math.hypot(p.x - cx, p.y - cy) > PARTICLE_MAX_DIST()) {
      Object.assign(p, spawnParticle(p.depth));
    }
  }

  function drawParticles(list) {
    const cx      = centerX();
    const cy      = centerY();
    const maxDist = PARTICLE_MAX_DIST();
    // Color: depth 1 = blue-violet, depth 2 = violet-pink
    for (const p of list) {
      const dist = Math.hypot(p.x - cx, p.y - cy);
      const fade = 1 - Math.min(dist / maxDist, 1);
      ctx.globalAlpha = p.alpha * fade;
      const hue = p.depth === 1 ? 210 : 260;
      const lit = p.depth === 1 ? 62  : 70;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${hue},72%,${lit}%)`;
      ctx.fill();
    }
  }

  // ── Main loop ────────────────────────────────────────────────
  let _lastTs = 0;

  function animateBackground(ts) {
    requestAnimationFrame(animateBackground);

    const dt = Math.min(ts - _lastTs, 50);
    _lastTs = ts;

    if (lastActiveState !== _active) {
      canvas.style.opacity = _active ? '1' : '0';
      lastActiveState = _active;
    }

    ctx.clearRect(0, 0, W, H);

    // ── Aurora blobs ──
    for (let i = 0; i < BLOB_COUNT; i++) {
      const b = auroraBlobs[i];
      b.x += Math.sin(ts * 0.0003 + b.seed) * 0.2;
      b.y += Math.cos(ts * 0.0003 + b.seed) * 0.2;
      const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
      gr.addColorStop(0, `hsla(${b.hue},80%,65%,${b.alpha})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Glow pulses ──
    for (let i = 0; i < GLOW_N; i++) {
      const g = glows[i];

      if (g.phase === 'in') {
        g.opacity += g.speed;
        if (g.opacity >= g.targetOpacity) {
          g.opacity = g.targetOpacity;
          g.phase   = 'hold';
        }
      } else if (g.phase === 'hold') {
        g.holdMs += dt;
        if (g.holdMs >= g.holdMax) g.phase = 'out';
      } else {
        g.opacity -= g.speed * 0.55;
        if (g.opacity <= 0) {
          glows[i] = makeGlow(false);
          continue;
        }
      }

      const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
      gr.addColorStop(0,   `hsla(${g.hue},80%,66%,${g.opacity})`);
      gr.addColorStop(0.5, `hsla(${g.hue},70%,55%,${(g.opacity * 0.28).toFixed(3)})`);
      gr.addColorStop(1,   `hsla(${g.hue},60%,45%,0)`);

      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Aurora layer ──
    const t = ts * 0.0002;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0,   'rgba(0,255,180,0.03)');
    gradient.addColorStop(0.5, 'rgba(0,200,255,0.05)');
    gradient.addColorStop(1,   'rgba(0,255,180,0.03)');
    ctx.fillStyle = gradient;
    for (let i = 0; i < 3; i++) {
      const yOffset = Math.sin(t + i * 2) * 40;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, yOffset + i * H * 0.3, W, H * 0.2);
    }
    ctx.globalAlpha = 1;

    // ── Color shift ──
    const hueShift = 120 + Math.sin(t * 2) * 20;
    ctx.filter = `hue-rotate(${hueShift}deg)`;
    ctx.fillStyle = 'rgba(0,200,255,0.02)';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = 'none';

    // ── Occasional flares ──
    if (Math.random() < 0.01) {
      const fx = centerX() + (Math.random() - 0.5) * W * 0.6;
      const fy = centerY() + (Math.random() - 0.5) * H * 0.6;
      const fr = Math.random() * 80 + 40;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
      fg.addColorStop(0, 'rgba(0,255,180,0.15)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Orb glow ──
    const pulse      = 0.5 + Math.sin(ts * 0.002) * 0.5;
    const glowRadius = 120 + pulse * 40;
    const orbGlow    = ctx.createRadialGradient(centerX(), centerY(), 0, centerX(), centerY(), glowRadius);
    orbGlow.addColorStop(0, `rgba(0,255,150,${(0.25 + pulse * 0.2) * 0.2})`);
    orbGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = orbGlow;
    ctx.beginPath();
    ctx.arc(centerX(), centerY(), glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // ── Particles (far first, near on top) ──
    for (const p of particlesFar)  updateParticle(p);
    for (const p of particlesNear) updateParticle(p);

    drawParticles(particlesFar);
    drawParticles(particlesNear);

    ctx.globalAlpha = 1;

    // ── Micro sparkles ──
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const sp    = sparkles[i];
      const alpha = Math.max(0, Math.sin(ts * 0.01 + sp.seed) * 0.5);
      if (alpha < 0.01) continue;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,230,255,${alpha.toFixed(3)})`;
      ctx.fill();
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    resize();
    pointerX = W / 2;
    pointerY = H / 2;
    initParticles();
    initBlobs();
    initGlows();
    initSparkles();
    initObserver();
    setActive(isInsightsActive());
    requestAnimationFrame(animateBackground);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
