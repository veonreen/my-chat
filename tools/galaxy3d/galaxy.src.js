/* Galaxy Relax v4: the 3D sky (decoy). Source for docs/js/vendor/galaxy3d.js (build with tools/galaxy3d/build.cjs).
 *  Light: dawn sky, matte pastel planets with soft lighting, blurred far planets, drifting clouds (CSS) and light motes (CSS).
 *  Dark:  a night sky with a faint Milky Way (2D canvas), twinkling stars with depth, planets lit from one warm side.
 * No outline rings anywhere. Real light + a very soft atmosphere glow. Slow parallax: near planets, far planets and the
 * background move at different speeds. Light on purpose: ~3 near spheres, a few sprites, one rAF loop that stops when
 * the page is hidden or the scene is destroyed; the pixel ratio drops by itself if frames get slow.
 * No text from the app ever reaches this file. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Group, Mesh, SphereGeometry, MeshStandardMaterial,
  ShaderMaterial, AdditiveBlending, NormalBlending, CanvasTexture, SRGBColorSpace, Points, BufferGeometry, BufferAttribute, Sprite,
  SpriteMaterial, Raycaster, Vector2, Vector3, Color, FrontSide,
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
    if (p.type === 'gas') { const w = n(u * 6, v * 5, 4, 6) * 0.3; t = n(u * 2 + w, v * 11 + w * 2, 3, 2) * 0.55 + (Math.sin((v + w * 0.4) * 30) * 0.5 + 0.5) * 0.45; }
    else if (p.type === 'soft') t = n(u * 4, v * 3, 4, 4) * 0.8 + n(u * 14, v * 7, 3, 14) * 0.2;       // matte pastel clouds
    else t = n(u * 6, v * 3, 5, 6) + (n(u * 40, v * 20, 2, 40) - 0.5) * 0.14;                          // rock
    const c = ramp(p.ramp, t), k = (y * W + x) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv); tex.colorSpace = SRGBColorSpace; return tex;
}
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128); return new CanvasTexture(cv);
}
/** A far planet drawn as a soft, slightly blurred lit disc (no second WebGL layer needed): depth of field for free. */
function softDisc(base, hi, lo) {
  const S = 192, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'); c.filter = 'blur(5px)';
  const g = c.createRadialGradient(S * 0.38, S * 0.34, S * 0.04, S / 2, S / 2, S * 0.36);
  g.addColorStop(0, hi); g.addColorStop(0.55, base); g.addColorStop(1, lo);
  c.fillStyle = g; c.beginPath(); c.arc(S / 2, S / 2, S * 0.3, 0, 6.3); c.fill();
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}

// ---------- the two skies ----------
const THEMES = {
  light: {
    key: [0xfff3e3, 2.5, [-4, 3, 5]], hemi: [0xffe9f0, 0xd3e2f5, 1.05], additive: false, stars: 0,
    near: [
      { type: 'soft', seed: 12, pos: [1.0, -0.95, 0.4], r: 1.22, spin: 0.03, ramp: [[0, '#E8AA90'], [0.45, '#F4C9B1'], [0.8, '#F9DFCD'], [1, '#EDB9A0']], halo: '#FFE3D2', haloA: 0.38, rim: '#FFF0E4', rimA: 0.4, tap: '#FFD9C4' },
      { type: 'soft', seed: 21, pos: [-1.05, 1.5, 0], r: 0.86, spin: 0.04, ramp: [[0, '#B5A6D9'], [0.5, '#CFC3E8'], [1, '#E7DEF5']], halo: '#EDE6FA', haloA: 0.38, rim: '#F4EEFF', rimA: 0.4, tap: '#E3D8FA' },
      { type: 'soft', seed: 3, pos: [-0.6, -0.1, 1.9], r: 0.2, spin: 0.06, ramp: [[0, '#E3DCD2'], [1, '#F8F4EE']], halo: '#ffffff', haloA: 0.3, rim: '#ffffff', rimA: 0.3, tap: '#ffffff' },
    ],
    far: [
      { pos: [1.6, 2.75, -5], r: 0.52, base: '#D3E7EC', hi: '#F3FAFC', lo: '#A9CAD6', a: 0.9 },
      { pos: [-1.75, -2.55, -4], r: 0.62, base: '#D2E2CB', hi: '#F1F7EC', lo: '#A9C2A1', a: 0.9 },
    ],
    burst: ['#ffffff', '#F6DDB0', '#F9C9C4'],
  },
  dark: {
    key: [0xffe7c2, 3.0, [-4, 3, 5]], hemi: [0x46557a, 0x1b1b22, 1.15], additive: true, stars: 420,
    near: [
      { type: 'gas', seed: 12, pos: [-0.95, 1.35, 0], r: 1.16, spin: 0.04, ramp: [[0, '#4d361d'], [0.3, '#a8793f'], [0.55, '#e6cc9c'], [0.8, '#8c6535'], [1, '#efdcb5']], halo: '#F0D49A', haloA: 0.05, rim: '#ffe6b8', rimA: 0.07, tap: '#F6DD8A' },
      { type: 'soft', seed: 33, pos: [1.3, -0.75, 0.6], r: 0.62, spin: 0.05, ramp: [[0, '#4a5876'], [0.5, '#93a6c9'], [1, '#d9e3f4']], halo: '#a9bde8', haloA: 0.05, rim: '#d8e2ff', rimA: 0.07, tap: '#cfdcff' },
      { type: 'rock', seed: 8, pos: [0.3, -2.55, -1], r: 0.72, spin: 0.06, ramp: [[0, '#2f2720'], [0.5, '#6a5744'], [1, '#a38d72']], halo: '#c9b08a', haloA: 0.035, rim: '#ffe3bd', rimA: 0.05, tap: '#F6DD8A' },
    ],
    far: [
      { pos: [1.65, 2.8, -6], r: 0.42, base: '#8a6f45', hi: '#d8be8a', lo: '#3a2d1b', a: 0.8 },
      { pos: [-1.95, -2.5, -5], r: 0.5, base: '#56648a', hi: '#a9b8d6', lo: '#232a3d', a: 0.8 },
    ],
    burst: ['#F6DD8A', '#ffffff', '#D4AF37'],
  },
};
const texCache = new Map();
const texFor = (th, p) => { const k = th + p.seed; if (!texCache.has(k)) texCache.set(k, planetTexture(p)); return texCache.get(k); };

const RIM_V = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }';
const RIM_F = 'uniform vec3 uC; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN,vV),0.0), 2.2); f = smoothstep(0.0,1.0,f)*0.55; gl_FragColor = vec4(uC, f*uA); }';

function create(canvas, opts) {
  opts = opts || {};
  const th = opts.theme === 'dark' ? 'dark' : 'light', T = THEMES[th];
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const renderer = new WebGLRenderer({ canvas, antialias: dpr < 1.5, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const cam = new PerspectiveCamera(36, W / H, 0.1, 200);
  const Z0 = 13; let zTarget = Z0; cam.position.set(0, 0, Z0);

  const key = new DirectionalLight(T.key[0], T.key[1]); key.position.set(...T.key[2]); scene.add(key);
  scene.add(new HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
  const rootNear = new Group(), rootFar = new Group(), rootStars = new Group(); scene.add(rootFar, rootNear, rootStars);
  const disposables = [];

  // twinkling stars with depth (dark only)
  let starMat = null;
  if (T.stars) {
    const sr = rng(3), N = T.stars, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
    const pal = [[1, 0.96, 0.9], [0.75, 0.86, 1], [1, 0.84, 0.6], [0.8, 0.9, 1]];
    for (let i = 0; i < N; i++) {
      const r = 22 + sr() * 50, a = sr() * Math.PI * 2, e = (sr() - 0.5) * 1.4;
      pos.set([r * Math.cos(a), r * Math.sin(e) * 0.9, r * Math.sin(a) * 0.4 - 22], i * 3);
      const c = pal[Math.floor(sr() * pal.length)], b = 0.35 + sr() * 0.65; col.set([c[0] * b, c[1] * b, c[2] * b], i * 3); sz[i] = 0.5 + Math.pow(sr(), 3) * 2.8; ph[i] = sr() * 6.28;
    }
    const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(pos, 3)); sg.setAttribute('color', new BufferAttribute(col, 3)); sg.setAttribute('size', new BufferAttribute(sz, 1)); sg.setAttribute('ph', new BufferAttribute(ph, 1));
    starMat = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uPx: { value: dpr }, uT: { value: 0 } },
      vertexShader: 'attribute float size; attribute vec3 color; attribute float ph; varying vec3 vC; uniform float uPx; uniform float uT; void main(){ vC = color * (0.72 + 0.28*sin(uT*(0.8+ph*0.25) + ph*5.0)); gl_PointSize = size*uPx*1.5; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC, a*a); }',
    });
    rootStars.add(new Points(sg, starMat)); disposables.push(sg, starMat);
  }

  const glowTex = glowTexture(); disposables.push(glowTex);
  // far planets: soft blurred discs
  const farSprites = T.far.map((f) => {
    const tx = softDisc(f.base, f.hi, f.lo), m = new SpriteMaterial({ map: tx, transparent: true, opacity: f.a, depthWrite: false });
    const sp = new Sprite(m); sp.position.set(...f.pos); sp.scale.setScalar(f.r * 4.1); rootFar.add(sp); disposables.push(tx, m);
    return { sp, base: f.pos.slice(), phase: Math.random() * 6 };
  });

  // near planets: real spheres, soft light, very soft rim, no outline
  const worlds = T.near.map((p, i) => {
    const g = new Group(); g.position.set(...p.pos); rootNear.add(g);
    const hm = new SpriteMaterial({ map: glowTex, color: p.halo, transparent: true, opacity: p.haloA, depthWrite: false, blending: T.additive ? AdditiveBlending : NormalBlending });
    const h = new Sprite(hm); h.scale.setScalar(p.r * 3.3); h.position.z = -0.05; g.add(h);
    const geo = new SphereGeometry(p.r, 64, 48);
    const mat = new MeshStandardMaterial({ map: texFor(th, p), roughness: 1, metalness: 0 });
    const mesh = new Mesh(geo, mat); mesh.rotation.set(0.15, 0.9 + i, 0.25); g.add(mesh);
    const rgeo = new SphereGeometry(p.r * 1.015, 48, 32);
    const rmat = new ShaderMaterial({ transparent: true, depthWrite: false, blending: T.additive ? AdditiveBlending : NormalBlending, side: FrontSide, uniforms: { uC: { value: new Color(p.rim) }, uA: { value: p.rimA } }, vertexShader: RIM_V, fragmentShader: RIM_F });
    g.add(new Mesh(rgeo, rmat)); disposables.push(geo, mat, rgeo, rmat, hm);
    return { p, g, mesh, hm, base: p.pos.slice(), phase: i * 1.9, s: 0, v: 0, glow: 0 };
  });

  // tap effects: a soft expanding glow (no outline) + a little burst of sparks
  const fx = [];
  function glow(at, color, size) {
    const m = new SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.7, depthWrite: false, blending: T.additive ? AdditiveBlending : NormalBlending });
    const sp = new Sprite(m); sp.position.copy(at); scene.add(sp); fx.push({ kind: 'glow', obj: sp, mat: m, t: 0, life: 0.9, size });
  }
  function burst(at, colors, n) {
    const g = new BufferGeometry(), p = new Float32Array(n * 3), cc = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      p.set([at.x, at.y, at.z], i * 3); const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.6, sp = 0.7 + Math.random() * 1.5;
      vel.push([Math.cos(a) * sp, Math.sin(a) * sp + e * 0.3, e * sp * 0.4]);
      const c = new Color(colors[i % colors.length]); cc.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('position', new BufferAttribute(p, 3)); g.setAttribute('color', new BufferAttribute(cc, 3));
    const m = new ShaderMaterial({ transparent: true, depthWrite: false, blending: T.additive ? AdditiveBlending : NormalBlending, uniforms: { uA: { value: 1 }, uPx: { value: dpr } },
      vertexShader: 'attribute vec3 color; varying vec3 vC; uniform float uPx; void main(){ vC=color; gl_PointSize=6.0*uPx; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vC; uniform float uA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(vC, smoothstep(0.5,0.0,d)*uA); }' });
    const pts = new Points(g, m); pts.frustumCulled = false; scene.add(pts);
    fx.push({ kind: 'burst', obj: pts, geo: g, mat: m, vel, t: 0, life: 1.1 });
  }
  function dropFx(f) { scene.remove(f.obj); if (f.geo) f.geo.dispose(); f.mat.dispose(); }

  // ----- interaction: drag to rotate, pinch / wheel to zoom, tap planets -----
  let yaw = 0, pitch = 0, yawT = 0, pitchT = 0, vYaw = 0, zoomNow = Z0;
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
      yawT += dx * 0.006; pitchT = Math.max(-0.55, Math.min(0.55, pitchT + dy * 0.004)); vYaw = dx * 0.006 * 60;
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
      const at = hit.point.clone(); glow(at, w.p.tap, w.p.r * 1.8); burst(at, T.burst, 24);
      if (opts.onTap) opts.onTap('planet');
    } else {
      const v = new Vector3(ndc.x, ndc.y, 0.5).unproject(cam), dir = v.sub(cam.position).normalize(), at = cam.position.clone().add(dir.multiplyScalar(-cam.position.z / dir.z));
      burst(at, T.burst, 12); if (opts.onTap) opts.onTap('space');
    }
  }
  function pulse() { const w = worlds[Math.floor(Math.random() * worlds.length)]; bounce(w, false); const at = new Vector3(); w.g.getWorldPosition(at); glow(at, w.p.tap, w.p.r * 1.5); }

  // ----- loop -----
  let raf = 0, last = performance.now(), clock = 0, alive = true; const dts = [];
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; idle += dt;
    dts.push(dt); if (dts.length >= 90) { const med = dts.sort((a, b) => a - b)[45]; dts.length = 0; if (med > 0.021 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); if (starMat) starMat.uniforms.uPx.value = dpr; } }
    if (!ptrs.size) { yawT += vYaw * dt; vYaw *= Math.exp(-dt * 2.6); if (!reduced && idle > 2.2) yawT += Math.sin(clock * 0.12) * dt * 0.05; }   // slow breathing drift
    yaw += (yawT - yaw) * (1 - Math.exp(-dt * 9)); pitch += (pitchT - pitch) * (1 - Math.exp(-dt * 9));
    zoomNow += (zTarget - zoomNow) * (1 - Math.exp(-dt * 7));
    // parallax: near planets move most, far planets less, stars least
    rootNear.rotation.y = yaw * 0.35; rootNear.rotation.x = pitch * 0.3;
    rootFar.rotation.y = yaw * 0.16; rootFar.rotation.x = pitch * 0.14;
    rootStars.rotation.y = yaw * 0.05;
    cam.position.z = zoomNow; cam.position.x = Math.sin(yaw * 0.5) * 0.4;
    if (starMat) starMat.uniforms.uT.value = clock;
    if (opts.onParallax) opts.onParallax(Math.max(-1, Math.min(1, yaw * 0.5)), Math.max(-1, Math.min(1, pitch)));
    worlds.forEach((w) => {
      w.mesh.rotation.y += dt * w.p.spin * (reduced ? 0 : 1);
      w.g.position.y = w.base[1] + (reduced ? 0 : Math.sin(clock * 0.5 + w.phase) * 0.07);
      w.v += (-w.s * 180 - w.v * 11) * dt; w.s += w.v * dt * 0.05; w.g.scale.setScalar(1 + w.s * 0.6);
      w.glow *= Math.exp(-dt * 2.2); w.hm.opacity = w.p.haloA + w.glow * 0.35;
    });
    farSprites.forEach((f) => { f.sp.position.y = f.base[1] + (reduced ? 0 : Math.sin(clock * 0.35 + f.phase) * 0.08); });
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt; const k = f.t / f.life;
      if (k >= 1) { dropFx(f); fx.splice(i, 1); continue; }
      if (f.kind === 'glow') { f.obj.scale.setScalar(f.size * (1 + k * 1.8)); f.mat.opacity = 0.7 * (1 - k) * (1 - k); }
      else { const p = f.geo.attributes.position; for (let j = 0; j < f.vel.length; j++) { p.array[j * 3] += f.vel[j][0] * dt; p.array[j * 3 + 1] += f.vel[j][1] * dt - 0.25 * dt; p.array[j * 3 + 2] += f.vel[j][2] * dt; } p.needsUpdate = true; f.mat.uniforms.uA.value = 1 - k; }
    }
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  function resize() {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false); cam.aspect = W / H; cam.fov = W / H < 0.7 ? 36 : 28; cam.updateProjectionMatrix();
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

/** The dark theme's night sky (2D canvas, drawn once): a faint Milky Way made of thousands of tiny stars, dust lanes,
 *  magnitude-distributed field stars with colour temperature, a few bright stars with soft glints, some out of focus. */
function drawNight(cv) {
  const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  let s = 11; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const G = () => (R() + R() + R() + R() - 2) / 2;
  const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#07070A'); bg.addColorStop(1, '#101013'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const ang = -0.62, ca = Math.cos(ang), sa = Math.sin(ang), L = Math.hypot(W, H);
  const along = (t, off) => [W * 0.55 + ca * (t - 0.5) * L - sa * off, H * 0.42 + sa * (t - 0.5) * L + ca * off];
  const bw = Math.min(W, H) * 0.34;
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const t = R(), [x, y] = along(t, G() * bw * 0.35), r = bw * (0.5 + R() * 0.9), warm = Math.abs(t - 0.5) < 0.18;
    const g = c.createRadialGradient(x, y, 0, x, y, r), col = warm ? '255,228,190' : '170,190,235';
    g.addColorStop(0, `rgba(${col},${warm ? 0.07 : 0.04})`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const N = Math.min(26000, Math.round((W * H) / 38));
  for (let i = 0; i < N; i++) {
    const t = R(), core = 1 - Math.abs(t - 0.5) * 1.5, [x, y] = along(t, G() * bw * (0.55 * (0.5 + core * 0.5)));
    if (x < 0 || y < 0 || x > W || y > H) continue;
    const a = 0.05 + R() * 0.22 * (0.4 + core);
    c.fillStyle = R() < 0.4 ? `rgba(255,236,208,${a})` : `rgba(205,218,255,${a})`; c.fillRect(x, y, 0.55 + R() * 0.5, 0.55 + R() * 0.5);
  }
  c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 20; i++) {
    const t = 0.15 + R() * 0.7, [x, y] = along(t, G() * bw * 0.12), rx = bw * (0.3 + R() * 0.5), ry = bw * (0.05 + R() * 0.09);
    c.save(); c.translate(x, y); c.rotate(ang + G() * 0.15); c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, 'rgba(6,6,9,.38)'); g.addColorStop(1, 'rgba(6,6,9,0)'); c.fillStyle = g; c.fillRect(-rx, -rx, rx * 2, rx * 2); c.restore();
  }
  const pal = [[255, 244, 232], [205, 222, 255], [255, 214, 170], [255, 255, 255], [176, 200, 255]], stars = [];
  for (let i = 0; i < Math.round((W * H) / 900); i++) stars.push({ x: R() * W, y: R() * H, m: Math.pow(R(), 5), c: pal[Math.floor(R() * pal.length)], a: 0.35 + R() * 0.65 });
  stars.sort((a, b) => a.m - b.m);
  stars.forEach((st) => {
    const r = 0.35 + st.m * 1.7, blur = st.m > 0.25 && R() < 0.3;
    if (blur) c.filter = `blur(${(0.8 + R() * 1.2).toFixed(1)}px)`;
    if (st.m > 0.12) { const g = c.createRadialGradient(st.x, st.y, 0, st.x, st.y, r * 7); g.addColorStop(0, `rgba(${st.c},${0.28 * st.a})`); g.addColorStop(1, `rgba(${st.c},0)`); c.fillStyle = g; c.fillRect(st.x - r * 7, st.y - r * 7, r * 14, r * 14); }
    c.fillStyle = `rgba(${st.c},${Math.min(1, st.a + 0.15)})`; c.beginPath(); c.arc(st.x, st.y, r, 0, 6.3); c.fill();
    if (blur) c.filter = 'none';
  });
  for (let i = 0; i < 9; i++) {
    const x = R() * W, y = R() * H * 0.85, r = 1.6 + R() * 1.1, col = pal[Math.floor(R() * pal.length)];
    const g = c.createRadialGradient(x, y, 0, x, y, r * 12); g.addColorStop(0, `rgba(${col},.55)`); g.addColorStop(0.25, `rgba(${col},.14)`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.fillRect(x - r * 12, y - r * 12, r * 24, r * 24);
    c.strokeStyle = `rgba(${col},.45)`; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x - r * 6, y); c.lineTo(x + r * 6, y); c.moveTo(x, y - r * 6); c.lineTo(x, y + r * 6); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.8, 0, 6.3); c.fill();
  }
}

// Build the planet textures ahead of time (idle, on the login screen) so the sky appears without a hitch.
function prewarm() { try { ['light', 'dark'].forEach((th) => THEMES[th].near.forEach((p) => texFor(th, p))); } catch (e) { /* ignore */ } }

window.Galaxy = { create, drawNight, prewarm };
