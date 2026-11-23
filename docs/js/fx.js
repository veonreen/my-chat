/* Galaxy Relax: delight effects. One full-screen canvas (only runs while particles are alive) + flying emoji.
 * Word effects: "happy birthday" = confetti, "love" = hearts rain, "congrats" = fireworks. */
(function () {
  const MC = (window.MC = window.MC || {});
  const fx = (MC.fx = {});
  const COLORS = ['#E8B44C', '#1FB5A3', '#FF7A6B', '#F4EFE6', '#8DA2E6', '#FFB3A8'];
  let ctx = null, parts = [], rockets = [], raf = 0, last = 0, W = 0, H = 0, running = false;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const calm = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setup() {
    const c = document.getElementById('fx'); if (!c) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  function heart(c, s) {
    c.beginPath(); c.moveTo(0, s * 0.35);
    c.bezierCurveTo(-s * 0.9, -s * 0.2, -s * 0.5, -s * 0.9, 0, -s * 0.4);
    c.bezierCurveTo(s * 0.5, -s * 0.9, s * 0.9, -s * 0.2, 0, s * 0.35); c.closePath();
  }
  function start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); } }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    // rockets (fireworks)
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]; r.t += dt;
      if (r.t < 0) continue;
      r.y -= r.v * dt; r.v *= Math.exp(-dt * 1.4);
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#FFE3A1'; ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, 6.3); ctx.fill();
      if (r.y <= r.ty || r.v < 40) {
        rockets.splice(i, 1);
        for (let k = 0; k < 54; k++) { const a = (k / 54) * 6.283 + rand(-0.05, 0.05), sp = rand(90, 260); parts.push({ kind: 'spark', x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.9, 1.5), c: r.c, s: rand(1.6, 3) }); }
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt;
      if (p.life < 0) continue;
      if (p.life >= p.max || p.y > H + 40) { parts.splice(i, 1); continue; }
      const k = p.life / p.max;
      if (p.kind === 'confetti') {
        p.vy += 380 * dt; p.vx *= Math.exp(-dt * 0.6); p.x += p.vx * dt + Math.sin(p.life * 5 + p.ph) * 22 * dt; p.y += p.vy * dt * 0.55; p.rot += p.vr * dt;
        ctx.globalAlpha = 1 - k * k; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.life * 6 + p.ph));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      } else if (p.kind === 'heart') {
        p.y += p.vy * dt; p.x += Math.sin(p.life * 2 + p.ph) * 26 * dt;
        ctx.globalAlpha = Math.min(1, p.life * 3) * (1 - k * k) * 0.9; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 8;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.life * 1.7 + p.ph) * 0.35); heart(ctx, p.s); ctx.fill(); ctx.restore(); ctx.shadowBlur = 0;
      } else {
        p.vx *= Math.exp(-dt * 1.6); p.vy = p.vy * Math.exp(-dt * 1.6) + 70 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = (1 - k) * (1 - k); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - k * 0.5), 0, 6.3); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (parts.length || rockets.length) raf = requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, W, H); }
  }

  fx.confetti = function () {
    if (!setup()) return;
    for (let i = 0; i < 150; i++) parts.push({ kind: 'confetti', x: rand(0, W), y: rand(-60, -4), vx: rand(-60, 60), vy: rand(40, 160), rot: rand(0, 6), vr: rand(-8, 8), w: rand(6, 11), h: rand(8, 15), c: pick(COLORS), ph: rand(0, 6), life: -rand(0, 0.9), max: rand(2.4, 3.6) });
    start();
  };
  fx.hearts = function () {
    if (!setup()) return;
    for (let i = 0; i < 38; i++) parts.push({ kind: 'heart', x: rand(10, W - 10), y: rand(-80, -10), vy: rand(90, 190), s: rand(9, 20), c: Math.random() < 0.75 ? '#FF7A6B' : '#FFB3A8', ph: rand(0, 6), life: -rand(0, 1.6), max: rand(3.2, 4.6) });
    start();
  };
  fx.fireworks = function () {
    if (!setup()) return;
    for (let i = 0; i < 4; i++) rockets.push({ x: rand(W * 0.15, W * 0.85), y: H + 10, ty: rand(H * 0.18, H * 0.45), v: rand(520, 700), t: -i * 0.5, c: pick(COLORS) });
    start();
  };
  /** Looks at the text of a message and plays the matching effect (at most one). */
  fx.wordFx = function (text) {
    if (!text || calm()) return false;
    const S = MC.S;
    if (S && S.settings && S.settings.effects === false) return false;
    let kind = null;
    if (/happy\s*b(?:irth|'day|day)|\bhbd\b/i.test(text)) kind = 'confetti';
    else if (/congrat/i.test(text)) kind = 'fireworks';
    else if (/\blove[ds]?\b|\bloving\b|\bluv\b/i.test(text)) kind = 'hearts';
    if (!kind) return false;
    fx[kind]();
    if (S && S.settings && S.settings.sound && MC.u) MC.u.sfx('sparkle');
    return kind;
  };
  /** A reaction flies up from the given screen point. */
  fx.flyEmoji = function (x, y, emoji) {
    if (calm()) return;
    const n = document.createElement('div');
    n.className = 'fly'; n.textContent = emoji;
    n.style.left = x + 'px'; n.style.top = y + 'px';
    n.style.setProperty('--fx', Math.round(rand(-34, 34)) + 'px'); n.style.setProperty('--fr', Math.round(rand(-14, 14)) + 'deg');
    document.body.append(n);
    n.addEventListener('animationend', () => n.remove());
    setTimeout(() => n.remove(), 1500);
  };
  /** Wipe everything (used when the private area is hidden). */
  fx.clear = function () {
    parts = []; rockets = [];
    document.querySelectorAll('.fly').forEach((n) => n.remove());
    const c = document.getElementById('fx'); if (c && c.getContext) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  };
})();
