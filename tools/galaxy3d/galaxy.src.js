/* Galaxy Relax: the 3D "decoy" sky. Source for docs/js/vendor/galaxy3d.js (built with tools/galaxy3d/build.cjs).
 * Light by design: ~4 planets (procedural textures, made once), 500 star points, one rAF loop that
 * stops when the page is hidden or the scene is destroyed. Pixel ratio adapts if frames get slow.
 * No text from the app ever reaches this file. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, AmbientLight, Group, Mesh, SphereGeometry, MeshStandardMaterial,
  ShaderMaterial, AdditiveBlending, CanvasTexture, SRGBColorSpace, Points, BufferGeometry, BufferAttribute, Sprite, SpriteMaterial,
  Raycaster, Vector2, Vector3, Color, RingGeometry, MeshBasicMaterial, FrontSide, DoubleSide,
} from 'three';

// ---------- seeded noise (wraps horizontally => no seam on the sphere) ----------
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function makeNoise(seed) {
  const r = rng(seed), g = new Float32Array(65536);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = (t) => t * t * (3 - 2 * t);
  const v = (x, y, P) => {
    const at = (a, b) => g[((b & 255) << 8) | ((((a % P) + P) % P) & 255)];
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    return (at(xi, yi) * (1 - xf) + at(xi + 1, yi) * xf) * (1 - yf) + (at(xi, yi + 1) * (1 - xf) + at(xi + 1, yi + 1) * xf) * yf;
  };
  return (x, y, o, px) => { let a = 0, f = 1, w = 0.5, t = 0; for (let i = 0; i < o; i++) { a += v(x * f, y * f, px * f) * w; t += w; f *= 2; w *= 0.5; } return a / t; };
}
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) { const [p0, c0] = stops[i], [p1, c1] = stops[i + 1]; if (t <= p1) return mixc(hex(c0), hex(c1), (t - p0) / (p1 - p0 || 1)); }
  return hex(stops[stops.length - 1][1]);
}
function planetTexture(p) {
  const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), n = makeNoise(p.seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H; let t;
    if (p.type === 'gas') { const w = n(u * 6, v * 5, 4, 6) * 0.35; t = n(u * 2 + w, v * 14 + w * 2, 3, 2) * 0.6 + (Math.sin((v + w * 0.4) * 38) * 0.5 + 0.5) * 0.4; }
    else if (p.type === 'ice') t = n(u * 5, v * 3, 5, 5) * 0.8 + n(u * 20, v * 11, 2, 20) * 0.2;
    else t = n(u * 6, v * 3, 5, 6) + (n(u * 40, v * 20, 2, 40) - 0.5) * 0.18;
    const c = ramp(p.ramp, t), k = (y * W + x) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv); tex.colorSpace = SRGBColorSpace; return tex;
}
function bumpTexture(seed) {
  const W = 128, H = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), n = makeNoise(seed + 99);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = n(x / W * 14, y / H * 7, 4, 14) * 255, k = (y * W + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = t; img.data[k + 3] = 255; }
  ctx.putImageData(img, 0, 0); return new CanvasTexture(cv);
}
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.5)'); g.addColorStop(0.55, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); return new CanvasTexture(cv);
}

// ---------- the sky (direction B: four worlds at different depths) ----------
const PLANETS = [
  { id: 'a', type: 'gas', seed: 12, pos: [-0.75, 1.55, 0], r: 1.15, spin: 0.05, ramp: [[0, '#0e5d63'], [0.3, '#1fb5a3'], [0.55, '#9be3d5'], [0.8, '#2a8f95'], [1, '#d6f3ea']], atmo: '#6fe6d4', tilt: 0.35 },
  { id: 'b', type: 'rock', seed: 5, pos: [1.15, -0.55, -0.6], r: 0.8, spin: 0.08, ramp: [[0, '#5b2a28'], [0.4, '#c4604f'], [0.7, '#e8a07a'], [1, '#ffd7b5']], atmo: '#ff9d8e', tilt: 0.2 },
  { id: 'c', type: 'ice', seed: 33, pos: [-1.15, -2.1, 0.8], r: 0.5, spin: 0.1, ramp: [[0, '#32407f'], [0.5, '#8da2e6'], [1, '#e8eeff']], atmo: '#a9b8ff', tilt: 0.1 },
  { id: 'd', type: 'rock', seed: 8, pos: [1.35, 2.85, -3], r: 0.34, spin: 0.14, ramp: [[0, '#6b5a2a'], [0.5, '#d9b05c'], [1, '#fbe6ad']], atmo: '#f1cf86', tilt: 0.3 },
];
const texCache = new Map();
const texFor = (p) => { if (!texCache.has(p.id)) texCache.set(p.id, { map: planetTexture(p), bump: p.type === 'rock' ? bumpTexture(p.seed) : null }); return texCache.get(p.id); };

const ATMO_V = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }';
const ATMO_F = 'uniform vec3 uColor; uniform float uAmt; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN,vV),0.0), 4.8); gl_FragColor = vec4(uColor, f*uAmt); }';

function create(canvas, hooks) {
  hooks = hooks || {};
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const renderer = new WebGLRenderer({ canvas, antialias: dpr < 1.5, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const cam = new PerspectiveCamera(38, W / H, 0.1, 200);
  const Z0 = 13; let zTarget = Z0; cam.position.set(0, 0, Z0);

  const key = new DirectionalLight(0xffe0b0, 3.4); key.position.set(-4, 3.5, 5); scene.add(key);
  const rim = new DirectionalLight(0xff7a6b, 1.9); rim.position.set(5, -1, -3); scene.add(rim);
  scene.add(new AmbientLight(0x8f9bd6, 0.24));
  const root = new Group(); scene.add(root);
  const disposables = [];

  // stars
  const sr = rng(3), N = 520, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  const pal = [[1, 0.96, 0.9], [0.75, 0.86, 1], [1, 0.84, 0.6], [0.6, 0.95, 0.9]];
  for (let i = 0; i < N; i++) {
    const r = 30 + sr() * 50, th = sr() * Math.PI * 2, ph = Math.acos(2 * sr() - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.8, r * Math.sin(ph) * Math.sin(th) - 20], i * 3);
    const c = pal[Math.floor(sr() * pal.length)], b = 0.35 + sr() * 0.65; col.set([c[0] * b, c[1] * b, c[2] * b], i * 3); sz[i] = 0.6 + sr() * sr() * 2.4;
  }
  const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(pos, 3)); sg.setAttribute('color', new BufferAttribute(col, 3)); sg.setAttribute('size', new BufferAttribute(sz, 1));
  const sm = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uPx: { value: dpr }, uT: { value: 0 } },
    vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float uPx; uniform float uT; void main(){ vC=color*(0.8+0.2*sin(uT*1.3+position.x*3.1+position.y*1.7)); gl_PointSize=size*uPx*1.6; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(vC,a*a); }',
  });
  const stars = new Points(sg, sm); scene.add(stars); disposables.push(sg, sm);

  const glowTex = glowTexture(); disposables.push(glowTex);
  [{ p: [-1.4, 2.6, -3], s: 7, c: 0x1fb5a3, o: 0.3 }, { p: [1.9, -0.6, -3], s: 6, c: 0xff7a6b, o: 0.2 }].forEach((g) => {
    const m = new SpriteMaterial({ map: glowTex, color: g.c, blending: AdditiveBlending, transparent: true, opacity: g.o, depthWrite: false });
    const s = new Sprite(m); s.position.set(...g.p); s.scale.setScalar(g.s); root.add(s); disposables.push(m);
  });

  // planets
  const worlds = PLANETS.map((p, i) => {
    const t = texFor(p), g = new Group(); g.position.set(...p.pos); root.add(g);
    const geo = new SphereGeometry(p.r, 48, 32);
    const mat = new MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2, roughness: 0.85, metalness: 0.02 });
    const mesh = new Mesh(geo, mat); mesh.rotation.set(0.2, 0.9, p.tilt); g.add(mesh);
    const ageo = new SphereGeometry(p.r * 1.08, 32, 24);
    const amat = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: FrontSide, uniforms: { uColor: { value: new Color(p.atmo) }, uAmt: { value: 0.7 } }, vertexShader: ATMO_V, fragmentShader: ATMO_F });
    g.add(new Mesh(ageo, amat)); disposables.push(geo, mat, ageo, amat);
    return { p, g, mesh, amat, base: p.pos.slice(), phase: i * 1.7, s: 0, v: 0, glow: 0 };   // s/v: spring for the tap bounce
  });

  // tap effects: expanding ring + spark burst
  const fx = [];
  const ringGeo = new RingGeometry(0.92, 1, 64); disposables.push(ringGeo);
  function ring(at, color, size) {
    const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
    const r = new Mesh(ringGeo, m); r.position.copy(at); r.quaternion.copy(cam.quaternion); scene.add(r);
    fx.push({ kind: 'ring', obj: r, mat: m, t: 0, life: 0.9, size });
  }
  function burst(at, color, n) {
    const g = new BufferGeometry(), p = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { p.set([at.x, at.y, at.z], i * 3); const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.6, sp = 0.8 + Math.random() * 1.6; vel.push([Math.cos(a) * sp, Math.sin(a) * sp + e * 0.3, e * sp * 0.4]); }
    g.setAttribute('position', new BufferAttribute(p, 3));
    const m = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uC: { value: new Color(color) }, uA: { value: 1 }, uPx: { value: dpr } },
      vertexShader: 'uniform float uPx; void main(){ gl_PointSize=5.0*uPx; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uC; uniform float uA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(uC, smoothstep(0.5,0.0,d)*uA); }' });
    const pts = new Points(g, m); pts.frustumCulled = false; scene.add(pts);
    fx.push({ kind: 'burst', obj: pts, geo: g, mat: m, vel, t: 0, life: 1.1 });
  }
  function dropFx(f) { scene.remove(f.obj); if (f.geo) f.geo.dispose(); f.mat.dispose(); }

  // ----- interaction: drag to rotate, pinch / wheel to zoom, tap planets -----
  let yaw = 0, pitch = 0, yawT = 0, pitchT = 0, vYaw = 0, vPitch = 0, zoomNow = Z0;
  const ptrs = new Map(); let tapStart = null, pinch0 = null, idle = 0;
  const ray = new Raycaster(), ndc = new Vector2();
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function onDown(e) {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, pt(e)); idle = 0;
    if (ptrs.size === 1) tapStart = { ...pt(e), t: performance.now(), moved: 0 };
    else { tapStart = null; const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zTarget }; }
  }
  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId), now = pt(e); ptrs.set(e.pointerId, now); idle = 0;
    if (ptrs.size === 1) {
      const dx = now.x - prev.x, dy = now.y - prev.y;
      yawT += dx * 0.006; pitchT = Math.max(-0.55, Math.min(0.55, pitchT + dy * 0.004)); vYaw = dx * 0.006 * 60; vPitch = 0;
      if (tapStart) tapStart.moved += Math.abs(dx) + Math.abs(dy);
    } else if (pinch0) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zTarget = Math.max(8, Math.min(18, pinch0.z * (pinch0.d / d)));
    }
  }
  function onUp(e) {
    const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    if (had && tapStart && ptrs.size === 0 && tapStart.moved < 10 && performance.now() - tapStart.t < 380) tap(tapStart.x, tapStart.y);
    if (ptrs.size === 0) tapStart = null;
  }
  function onWheel(e) { e.preventDefault(); zTarget = Math.max(8, Math.min(18, zTarget + e.deltaY * 0.01)); idle = 0; }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function bounce(w, strong) { w.v += strong ? 7 : 5; w.glow = 1; }
  function tap(x, y) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(worlds.map((w) => w.mesh), false)[0];
    if (hit) {
      const w = worlds.find((k) => k.mesh === hit.object); bounce(w, true);
      const at = hit.point.clone(); ring(at, new Color(w.p.atmo), w.p.r); burst(at, w.p.atmo, 26);
      if (hooks.onTap) hooks.onTap('planet');
    } else {
      const v = new Vector3(ndc.x, ndc.y, 0.5).unproject(cam), dir = v.sub(cam.position).normalize(), at = cam.position.clone().add(dir.multiplyScalar(-cam.position.z / dir.z));
      burst(at, '#E8B44C', 12); if (hooks.onTap) hooks.onTap('space');
    }
  }
  function pulse() { const w = worlds[Math.floor(Math.random() * worlds.length)]; bounce(w, false); const at = new Vector3(); w.g.getWorldPosition(at); ring(at, new Color(w.p.atmo), w.p.r * 0.8); }

  // ----- loop -----
  let raf = 0, last = performance.now(), clock = 0, alive = true; const dts = [];
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; idle += dt;
    // adaptive quality
    dts.push(dt); if (dts.length >= 90) { const med = dts.sort((a, b) => a - b)[45]; dts.length = 0; if (med > 0.021 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); sm.uniforms.uPx.value = dpr; } }
    // camera / rotation (exponential smoothing = soft spring, no linear snaps)
    if (!ptrs.size) { yawT += vYaw * dt; vYaw *= Math.exp(-dt * 2.6); if (!reduced && idle > 2.5) yawT += dt * 0.035; }
    yaw += (yawT - yaw) * (1 - Math.exp(-dt * 9)); pitch += (pitchT - pitch) * (1 - Math.exp(-dt * 9));
    zoomNow += (zTarget - zoomNow) * (1 - Math.exp(-dt * 7));
    root.rotation.y = yaw * 0.35; root.rotation.x = pitch * 0.3; cam.position.z = zoomNow; cam.position.x = Math.sin(yaw * 0.5) * 0.4;
    sm.uniforms.uT.value = clock; stars.rotation.y = yaw * 0.05;
    worlds.forEach((w) => {
      w.mesh.rotation.y += dt * w.p.spin * (reduced ? 0 : 1);
      w.g.position.y = w.base[1] + (reduced ? 0 : Math.sin(clock * 0.6 + w.phase) * 0.07);
      // tap bounce: damped spring on scale
      w.v += (-w.s * 180 - w.v * 11) * dt; w.s += w.v * dt * 0.05; w.g.scale.setScalar(1 + w.s * 0.6);
      w.glow *= Math.exp(-dt * 2.2); w.amat.uniforms.uAmt.value = 0.7 + w.glow * 1.4;
    });
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt; const k = f.t / f.life;
      if (k >= 1) { dropFx(f); fx.splice(i, 1); continue; }
      if (f.kind === 'ring') { const s = f.size * (1 + k * 1.6); f.obj.scale.setScalar(s); f.mat.opacity = 0.8 * (1 - k) * (1 - k); }
      else { const p = f.geo.attributes.position; for (let j = 0; j < f.vel.length; j++) { p.array[j * 3] += f.vel[j][0] * dt; p.array[j * 3 + 1] += f.vel[j][1] * dt - 0.25 * dt; p.array[j * 3 + 2] += f.vel[j][2] * dt; } p.needsUpdate = true; f.mat.uniforms.uA.value = 1 - k; }
    }
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  function resize() {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    cam.fov = W / H < 0.7 ? 38 : 30; cam.updateProjectionMatrix();
  }
  resize();
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas);

  function destroy() {
    alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel);
    fx.forEach(dropFx); fx.length = 0; disposables.forEach((d) => d.dispose && d.dispose());
    renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
  }
  return { destroy, pulse, resize };
}

// Build the planet textures ahead of time (idle, on the login screen) so the sky appears without a hitch.
function prewarm() { try { PLANETS.forEach(texFor); } catch (e) { /* ignore */ } }

window.Galaxy = { create, prewarm };
