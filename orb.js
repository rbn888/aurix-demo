(function () {
  'use strict';

  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const RING_DEFS = [
    { count: 22, rxF: 1.35, ryF: 0.30, tilt: -0.35, speed:  0.00065, r: 34, g: 197, b:  94 },
    { count: 16, rxF: 1.55, ryF: 0.26, tilt:  0.52, speed: -0.00052, r: 34, g: 210, b: 110 },
    { count: 12, rxF: 1.22, ryF: 0.46, tilt:  1.15, speed:  0.00088, r: 55, g: 220, b: 130 },
  ];

  let _raf       = null;
  let _canvas    = null;
  let _ctx       = null;
  let _W = 0, _H = 0, _CX = 0, _CY = 0, _R = 0;
  let _particles = [];

  function _buildParticles() {
    _particles = [];
    for (const d of RING_DEFS) {
      for (let i = 0; i < d.count; i++) {
        _particles.push({
          angle: (i / d.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
          rx:    _R * d.rxF * (0.8 + Math.random() * 0.4),
          ry:    _R * d.ryF * (0.8 + Math.random() * 0.4),
          tilt:  d.tilt + (Math.random() - 0.5) * 0.2,
          speed: d.speed * (0.65 + Math.random() * 0.7),
          size:  0.5 + Math.random() * 1.6,
          base:  0.25 + Math.random() * 0.55,
          r: d.r, g: d.g, b: d.b,
        });
      }
    }
  }

  function _resize() {
    if (!_canvas) return;
    _W = _canvas.offsetWidth  || 300;
    _H = _canvas.offsetHeight || 300;
    _canvas.width  = _W * DPR;
    _canvas.height = _H * DPR;
    _ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    _CX = _W / 2;
    _CY = _H / 2;
    _R  = _W * 0.4;
    _buildParticles();
  }

  function _draw(ts) {
    if (!_ctx) return; // stopped — bail

    _raf = requestAnimationFrame(_draw);

    const t      = ts * 0.001;
    const floatY = Math.sin(t * (2 * Math.PI / 7)) * (_H * 0.02);
    const oCY    = _CY + floatY;

    _ctx.clearRect(0, 0, _W, _H);

    const back  = [];
    const front = [];
    for (const p of _particles) {
      p.angle += p.speed;
      if (Math.sin(p.angle) * Math.cos(p.tilt) >= 0) back.push(p);
      else                                             front.push(p);
    }

    // Back particles (behind sphere)
    for (const p of back) {
      const x     = _CX  + Math.cos(p.angle) * p.rx;
      const y     = oCY  + Math.sin(p.angle) * p.ry * Math.cos(p.tilt);
      const depth = (Math.sin(p.angle) * Math.cos(p.tilt) + 1) * 0.5;
      _ctx.globalAlpha = p.base * (0.08 + depth * 0.10);
      _ctx.beginPath();
      _ctx.arc(x, y, p.size * 0.7, 0, Math.PI * 2);
      _ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      _ctx.fill();
    }

    // Sphere
    const grad = _ctx.createRadialGradient(
      _CX - _R * 0.28, oCY - _R * 0.32, _R * 0.04,
      _CX,              oCY,              _R
    );
    grad.addColorStop(0,    'rgba(34,197,94,0.22)');
    grad.addColorStop(0.26, 'rgba(18,26,18,0.70)');
    grad.addColorStop(0.60, 'rgba(11,15,26,0.92)');
    grad.addColorStop(1,    'rgba(7,10,18,0.98)');

    _ctx.globalAlpha = 1;
    _ctx.beginPath();
    _ctx.arc(_CX, oCY, _R, 0, Math.PI * 2);
    _ctx.fillStyle = grad;
    _ctx.fill();

    // Rim light
    const rim = _ctx.createRadialGradient(_CX, oCY, _R * 0.82, _CX, oCY, _R);
    rim.addColorStop(0, 'rgba(34,197,94,0)');
    rim.addColorStop(1, 'rgba(34,197,94,0.10)');
    _ctx.beginPath();
    _ctx.arc(_CX, oCY, _R, 0, Math.PI * 2);
    _ctx.fillStyle = rim;
    _ctx.fill();

    // Front particles
    for (const p of front) {
      const x     = _CX  + Math.cos(p.angle) * p.rx;
      const y     = oCY  + Math.sin(p.angle) * p.ry * Math.cos(p.tilt);
      const depth = (-Math.sin(p.angle) * Math.cos(p.tilt) + 1) * 0.5;
      _ctx.globalAlpha = p.base * (0.30 + depth * 0.70);
      _ctx.beginPath();
      _ctx.arc(x, y, p.size, 0, Math.PI * 2);
      _ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      _ctx.fill();
    }

    _ctx.globalAlpha = 1;
  }

  window.startOrb = function () {
    window.stopOrb(); // hard reset always — no stale state
    _canvas = document.getElementById('orb-canvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize, { passive: true });
    _raf = requestAnimationFrame(_draw);
  };

  window.stopOrb = function () {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    window.removeEventListener('resize', _resize);
    if (_canvas && _ctx) {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    }
    _ctx       = null;
    _canvas    = null;
    _particles = [];
  };
})();
