/* Galaxy Relax v5: the 3D sky (decoy). Source for docs/js/vendor/galaxy3d.js (build with tools/galaxy3d/build.cjs).
 *
 * What is on screen: four real planets (a ringed gas giant with the ring's shadow on it, an ocean world with drifting clouds and
 * a moon, a cratered rock, an ice dwarf), soft far planets, twinkling stars in three depth layers (Dark), shooting stars, bokeh
 * dust (Dark), tap sparkles. Textures are painted once on the GPU (procedural, no image files). No text from the app ever
 * reaches this file.
 *
 * Smoothness: every motion is time based (frame-rate independent) and spring driven; springs run in fixed sub-steps so a slow
 * frame never makes them jump. The render resolution adapts by itself (dynamic resolution first, then lighter effects) to hold
 * 60 fps, and creeps back up when there is headroom. Textures bake one per frame so opening the sky never stalls. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Group, Mesh, SphereGeometry, RingGeometry, PlaneGeometry,
  ShaderMaterial, AdditiveBlending, NormalBlending, CanvasTexture, Points, BufferGeometry, BufferAttribute, Sprite, SpriteMaterial,
  LineSegments, Raycaster, Vector2, Vector3, Color, WebGLRenderTarget, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping,
  ClampToEdgeWrapping, DoubleSide, BackSide, ColorManagement, LinearSRGBColorSpace, Sphere,
} from 'three';

ColorManagement.enabled = false;           // every colour below is a display colour and goes out untouched

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const soft = (x, l) => l * Math.tanh(x / l);                  // soft limit: resists instead of a hard wall
const rand = (a, b) => a + Math.random() * (b - a);
/** Spring in fixed 1/120 s sub-steps: stable at any frame rate. */
function spring(s, target, k, c, dt) {
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (-k * (s.x - target) - c * s.v) * h; s.x += s.v * h; }
}
const crit = (k) => 2 * Math.sqrt(k);                          // critical damping
const REDUCED = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ------------------------------------------------------------------ GLSL */
const NOISE = `
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
float ridge(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ float n=1.-abs(vnoise(p)*2.-1.); s+=a*n*n; p=p*2.1+vec3(3.3,1.1,7.7); a*=.5; } return s; }
float craters(vec3 p,float sc){ vec3 q=p*sc, ip=floor(q); float h=0.;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 g=ip+vec3(float(x),float(y),float(z)); vec3 c=g+hash33(g); float r=.2+.3*hash13(g+7.); float d=length(q-c)/r;
    if(d<1.) h-=(1.-d*d)*.85; h+=smoothstep(.78,1.,d)*smoothstep(1.4,1.02,d)*.45; } return h; }
float ringDensity(float r,float inn,float out_){ float x=(r-inn)/(out_-inn); if(x<0.||x>1.) return 0.;
  float e=smoothstep(0.,.03,x)*smoothstep(1.,.96,x); float b=.5+.5*sin(x*70.+sin(x*13.)*2.); float b2=.5+.5*sin(x*190.+x*x*40.); float b3=fract(sin(floor(x*420.)*12.9898)*43758.5453);
  float gap=smoothstep(0.,.05,abs(x-.64)-.035)*(.12+.88*smoothstep(0.,.03,abs(x-.31)-.012)); return e*(.22+.42*b+.2*b2+.16*b3)*gap; }
`;
const BAKE_FS = NOISE + `
varying vec2 vUv; uniform int uType; uniform float uSeed; uniform vec3 uP0,uP1,uP2,uP3,uP4;
vec3 ramp4(float t){ t=clamp(t,0.,1.)*3.; return t<1.?mix(uP0,uP1,t):t<2.?mix(uP1,uP2,t-1.):mix(uP2,uP3,t-2.); }
void main(){
  float lon=vUv.x*6.2831853, lat=(vUv.y-.5)*3.14159265; vec3 p=vec3(cos(lat)*cos(lon),sin(lat),cos(lat)*sin(lon)); vec3 s=vec3(uSeed);
  vec3 col=vec3(0.); float a=0.;
  if(uType==0){
    float warp=fbm(p*vec3(1.2,2.6,1.2)*2.+s)*2.-1.; float band=sin((p.y*7.+warp*.9+fbm(p*5.+s)*.6)*3.14159); float t=band*.5+.5; float fine=fbm(vec3(p.x*3.,p.y*42.,p.z*3.)+s); t=mix(t,fine,.28);
    col=ramp4(t); vec2 sp=vec2(lon-3.6,lat+.35); sp.x=atan(sin(sp.x),cos(sp.x)); float sd=length(sp*vec2(1.,1.7)); float st=smoothstep(.36,.08,sd); float sw=fbm(vec3(sp*7.,uSeed)+vec3(atan(sp.y,sp.x)*1.2));
    col=mix(col,uP4*(.9+.3*sw),st*.85); col=mix(col,col*.8,smoothstep(.8,1.,abs(p.y))); a=t; }
  else if(uType==1){
    float h=fbm(p*3.+s)*.5+ridge(p*2.+s)*.32+craters(p+s,4.)*.2+craters(p+s,11.)*.09; col=mix(uP0,uP1,smoothstep(.2,.6,h)); col=mix(col,uP2,smoothstep(.55,.9,h)); col*=.92+.16*fbm(p*14.+s); a=clamp(h*.9,0.,1.); }
  else if(uType==2){
    float l=fbm(p*2.2+s); float land=smoothstep(.5,.53,l); vec3 sea=mix(uP0,uP1,smoothstep(.2,.52,l)); vec3 gr=mix(uP2,uP3,smoothstep(.55,.8,l)+(fbm(p*9.+s)-.5)*.35); col=mix(sea,gr,land);
    float ice=smoothstep(.8,.93,abs(p.y)+(fbm(p*6.+s)-.5)*.12); col=mix(col,vec3(.96,.97,1.),ice); a=land*(.05+(l-.5)*.9)*(1.-ice*.7); }
  else if(uType==3){
    float f=fbm(p*3.+s); float cr=ridge(p*4.5+s); col=mix(uP0,uP1,f); col=mix(col,uP2,smoothstep(.6,.9,cr)*.7); a=cr*.6+f*.2; }
  else { vec3 q=p*vec3(3.,5.,3.)+s; float w=fbm(q*1.3); float d=fbm(q+w*1.6); d=smoothstep(.46,.78,d); col=uP0; a=d; }
  gl_FragColor=vec4(col,a);
}`;
const PLANET_VS = `varying vec3 vN,vV,vP; varying vec2 vUv; varying vec3 vL; uniform vec3 uSun;
void main(){ vUv=uv; vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vN=normalMatrix*normal; vL=normalize((viewMatrix*vec4(uSun,0.)).xyz); gl_Position=projectionMatrix*mv; }`;
const PLANET_FS = NOISE + `
varying vec3 vN,vV,vP; varying vec2 vUv; varying vec3 vL;
uniform sampler2D uMap,uClouds; uniform float uSpin,uCloudSpin,uGlow,uFlash,uSpec,uCloudAmt,uRing,uRingIn,uRingOut,uBump; uniform vec3 uAmb,uAtmo,uSunCol,uSunObj;
void main(){
  vec2 uv=vec2(vUv.x+uSpin,vUv.y); vec4 m=texture2D(uMap,uv); vec3 N=normalize(vN), V=normalize(vV), L=normalize(vL);
  if(uBump>0.){ vec3 dpx=dFdx(-vV), dpy=dFdy(-vV); float dhx=dFdx(m.a), dhy=dFdy(m.a); vec3 r1=cross(dpy,N), r2=cross(N,dpx); float det=dot(dpx,r1); vec3 g=sign(det)*(dhx*r1+dhy*r2); N=normalize(abs(det)*N-uBump*g); }
  float nl=dot(N,L); float diff=clamp((nl+.14)/1.14,0.,1.); diff=diff*diff*(3.-2.*diff);
  float cs=0.; if(uCloudAmt>0.){ cs=texture2D(uClouds,vec2(vUv.x+uCloudSpin+.004,vUv.y-.003)).a*uCloudAmt; diff*=1.-cs*.5; }
  if(uRing>0.){ vec3 P=normalize(vP); vec3 Ls=normalize(uSunObj); float t=-dot(P,vec3(0.,1.,0.))/Ls.y; if(t>0.){ vec3 Q=P+Ls*t; diff*=1.-ringDensity(length(Q),uRingIn,uRingOut)*.88; } }
  vec3 col=m.rgb*(uAmb+uSunCol*diff);
  col+=vec3(1.,.55,.36)*exp(-pow(nl*4.,2.))*.14*uSunCol;
  float fres=pow(1.-max(dot(N,V),0.),3.); float lit=smoothstep(-.25,.6,nl);
  if(uSpec>0.&&m.a<.003){ vec3 H=normalize(L+V); col+=uSunCol*pow(max(dot(N,H),0.),70.)*.55*uSpec*lit; }
  col+=uAtmo*fres*(.16+.84*lit)*.85;
  col=mix(col,col*(1.+uGlow*.45)+uAtmo*uGlow*.18*(.4+fres),uGlow); col+=uFlash*uAtmo*.35;
  gl_FragColor=vec4(col/(1.+col*.12),1.);
}`;
const CLOUD_FS = `varying vec3 vN,vV,vP; varying vec2 vUv; varying vec3 vL; uniform sampler2D uMap; uniform float uSpin,uAmt; uniform vec3 uAmb,uSunCol;
void main(){ vec4 c=texture2D(uMap,vec2(vUv.x+uSpin,vUv.y)); vec3 N=normalize(vN),L=normalize(vL); float nl=dot(N,L); float diff=clamp((nl+.2)/1.2,0.,1.); diff=diff*diff*(3.-2.*diff);
  vec3 col=c.rgb*(uAmb*1.25+uSunCol*diff)+vec3(1.,.55,.4)*exp(-pow(nl*4.,2.))*.08; gl_FragColor=vec4(col,c.a*uAmt*(.35+.65*smoothstep(-.35,.3,nl))); }`;
const ATMO_FS = `varying vec3 vN,vV,vP; varying vec3 vL; uniform vec3 uCol,uSunObj; uniform float uAmt,uGlow,uAdd;
void main(){ float d=-dot(normalize(vN),normalize(vV)); float g=pow(smoothstep(0.,.52,d),1.7); float lit=smoothstep(-.35,.7,dot(normalize(vP),normalize(uSunObj)));
  float a=g*(.18+.82*lit)*(uAmt+uGlow*.5); gl_FragColor=vec4(uCol*(uAdd>.5?a:1.),uAdd>.5?a:a*.7); }`;
const RING_VS = `varying vec3 vPos; varying vec3 vN,vV,vL; uniform vec3 uSun; void main(){ vPos=position; vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz; vN=normalMatrix*vec3(0.,0.,1.); vL=normalize((viewMatrix*vec4(uSun,0.)).xyz); gl_Position=projectionMatrix*mv; }`;
const RING_FS = NOISE + `varying vec3 vPos; varying vec3 vN,vV,vL; uniform vec3 uCol0,uCol1,uSunObj,uSunCol,uAmb; uniform float uIn,uOut,uGlow;
void main(){ float r=length(vPos.xy); float d=ringDensity(r,uIn,uOut); if(d<.004) discard;
  vec3 Q=vec3(vPos.x,0.,-vPos.y); vec3 Ls=normalize(uSunObj); float sh=1.; if(dot(Q,Ls)<0.){ float dd=length(Q-Ls*dot(Q,Ls)); sh=smoothstep(.96,1.1,dd); }
  float x=(r-uIn)/(uOut-uIn); vec3 base=mix(uCol0,uCol1,smoothstep(0.,1.,x+.25*sin(x*31.)));
  vec3 L=normalize(vL),N=normalize(vN); float lit=.4+.6*abs(dot(N,L)); vec3 col=base*(uAmb*1.15+uSunCol*lit*sh)*(1.+uGlow*.3);
  gl_FragColor=vec4(col/(1.+col*.1),d*(.55+.45*sh)); }`;

/* ------------------------------------------------------------------ the two skies */
const SUN = new Vector3(-0.62, 0.48, 0.62).normalize();
const TH = {
  light: {
    amb: [0.3, 0.27, 0.3], sunCol: [0.92, 0.84, 0.76], atmo: ['#FFD9D2', '#FFE3C4', '#EBDDF7', '#FFFFFF'], additive: false, stars: 0, dust: 0,
    ring: [[0.96, 0.88, 0.76], [0.8, 0.6, 0.5]], cloudPal: ['#FFFFFF'], burst: ['#ffffff', '#F6DDB0', '#F9C9C4'], sun: 0xffe2b0, sunA: 0.5, shoot: 0xfff2da,
    planets: [
      { type: 0, seed: 3.1, pal: ['#C9985A', '#E9CE97', '#F6E8CC', '#D9B36F', '#C4756B'] },
      { type: 2, seed: 8.4, pal: ['#8E7FB8', '#C5B5E0', '#E3B7A5', '#F6E6D4'] },
      { type: 1, seed: 1.7, pal: ['#B9ADA3', '#E4D9CE', '#F8F2EA'] },
      { type: 3, seed: 5.2, pal: ['#CFE0F0', '#F1F6FB', '#9FB5D6'] },
      { type: 1, seed: 9.9, pal: ['#C2B8AE', '#E8DED4', '#FAF4EC'] },
    ],
    far: [['#F1D9DC', '#FFF3F2', '#D4AEB4'], ['#EBDDB8', '#FBF3DD', '#C9B586']],
  },
  dark: {
    amb: [0.07, 0.085, 0.13], sunCol: [1.25, 1.05, 0.82], atmo: ['#F0C27A', '#8FB6FF', '#E8A7B0', '#BFD0FF'], additive: true, stars: 1, dust: 1,
    ring: [[0.93, 0.85, 0.68], [0.6, 0.48, 0.28]], cloudPal: ['#E7EEF7'], burst: ['#F6DD8A', '#ffffff', '#D4AF37'], sun: 0xffd9a0, sunA: 0.28, shoot: 0xfff6e6,
    planets: [
      { type: 0, seed: 3.1, pal: ['#4d361d', '#a8793f', '#e6cc9c', '#8c6535', '#7a3b2a'] },
      { type: 2, seed: 8.4, pal: ['#0b2a4c', '#2b6ea4', '#46633a', '#b09a6c'] },
      { type: 1, seed: 1.7, pal: ['#2f2720', '#6a5744', '#a38d72'] },
      { type: 3, seed: 5.2, pal: ['#8fb0d6', '#dbe8f6', '#4f6c93'] },
      { type: 1, seed: 9.9, pal: ['#3a3430', '#7d6f62', '#b7a898'] },
    ],
    far: [['#8a6f45', '#d8be8a', '#3a2d1b'], ['#56648a', '#a9b8d6', '#232a3d']],
  },
};
const DEFS = [
  { r: 0.8, pos: [-0.72, 1.5, 0], ring: true, tiltX: 0.42, tiltZ: -0.22, spin: 0.012, orbit: [0.16, 0.09, 0.2], atmo: 0 },
  { r: 1.16, pos: [1.02, -0.95, 0.4], clouds: true, tiltX: 0.1, tiltZ: 0.3, spin: 0.016, orbit: [0.2, 0.08, 1.1], atmo: 1, spec: 1 },
  { r: 0.5, pos: [-1.18, -1.0, 0.2], tiltX: 0.2, tiltZ: -0.1, spin: 0.02, orbit: [0.12, 0.11, 2.3], atmo: 2 },
  { r: 0.32, pos: [0.62, 2.45, -1.3], tiltX: 0.1, tiltZ: 0.2, spin: 0.025, orbit: [0.1, 0.13, 3.4], atmo: 3 },
];

/* ------------------------------------------------------------------ small canvas textures (work in every browser: no ctx.filter) */
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128); return new CanvasTexture(cv);
}
/** A far planet: a lit disc whose edge fades out softly (depth of field without a blur filter). */
function softDisc(base, hi, lo) {
  const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'), g = c.createRadialGradient(S * 0.38, S * 0.34, S * 0.04, S / 2, S / 2, S * 0.36);
  g.addColorStop(0, hi); g.addColorStop(0.55, base); g.addColorStop(1, lo);
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.globalCompositeOperation = 'destination-in';
  const m = c.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.34);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = m; c.fillRect(0, 0, S, S);
  return new CanvasTexture(cv);
}

/* ------------------------------------------------------------------ the sky */
function create(canvas, opts) {
  opts = opts || {};
  const th = opts.theme === 'dark' ? 'dark' : 'light', T = TH[th], reduced = REDUCED();
  const cores = navigator.hardwareConcurrency || 8, lowMem = (navigator.deviceMemory || 8) <= 2;
  const lowEnd = cores <= 4 || lowMem;
  const BASE_DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
  let scale = lowEnd ? 0.8 : 1, level = 0, dpr = 1;
  const renderer = new WebGLRenderer({ canvas, antialias: BASE_DPR < 1.75, alpha: true, powerPreference: 'default', stencil: false });
  renderer.outputColorSpace = LinearSRGBColorSpace; renderer.setClearColor(0x000000, 0);
  const scene = new Scene(), cam = new PerspectiveCamera(36, W / H, 0.1, 200);
  let alive = true, ready = false, lost = false;

  /* ---- texture baking: one GPU pass per texture, one texture per frame ---- */
  const quadScene = new Scene(), quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeMat = new ShaderMaterial({
    uniforms: { uType: { value: 0 }, uSeed: { value: 0 }, uP0: { value: new Vector3() }, uP1: { value: new Vector3() }, uP2: { value: new Vector3() }, uP3: { value: new Vector3() }, uP4: { value: new Vector3() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: BAKE_FS,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), bakeMat); quadScene.add(quad);
  const targets = [];
  const bakeSizes = lowEnd ? [512, 512, 384, 384, 256] : [1024, 1024, 512, 512, 512];
  function bake(type, seed, pal, w) {
    const rt = new WebGLRenderTarget(w, w / 2, { minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true, depthBuffer: false });
    rt.texture.wrapS = RepeatWrapping; rt.texture.wrapT = ClampToEdgeWrapping;
    rt.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const u = bakeMat.uniforms; u.uType.value = type; u.uSeed.value = seed;
    ['uP0', 'uP1', 'uP2', 'uP3', 'uP4'].forEach((k, i) => { const c = new Color(pal[i] || '#ffffff'); u[k].value.set(c.r, c.g, c.b); });
    renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam); renderer.setRenderTarget(null);
    targets.push(rt); return rt.texture;
  }

  /* ---- scene objects ---- */
  const disposables = [];
  const glowTex = glowTexture(); disposables.push(glowTex);
  const amb = new Vector3(...T.amb), sunCol = new Vector3(...T.sunCol);
  const sunGlow = new Sprite(new SpriteMaterial({ map: glowTex, color: T.sun, transparent: true, opacity: T.sunA, depthWrite: false, blending: th === 'light' ? NormalBlending : AdditiveBlending }));
  sunGlow.position.set(-5.5, 6.5, -14); sunGlow.scale.setScalar(26); sunGlow.renderOrder = -20; scene.add(sunGlow);

  // stars: three depth layers (Dark only)
  const starLayers = [];
  if (T.stars) {
    const defs = [{ n: 460, s: [0.9, 1.9], par: 0.03, glint: 0, z: [-70, -45] }, { n: 200, s: [1.4, 3.0], par: 0.07, glint: 0, z: [-50, -30] }, { n: 44, s: [3, 6.5], par: 0.14, glint: 1, z: [-34, -20] }];
    const pal = [[1, .96, .9], [.75, .86, 1], [1, .84, .6], [.8, .9, 1], [1, .82, .86]];
    defs.forEach((d, li) => {
      const pos = new Float32Array(d.n * 3), col = new Float32Array(d.n * 3), sz = new Float32Array(d.n), ph = new Float32Array(d.n), sp = new Float32Array(d.n);
      for (let i = 0; i < d.n; i++) {
        const z = rand(d.z[0], d.z[1]), hh = (13 - z) * 0.35; pos.set([rand(-hh * 0.62, hh * 0.62), rand(-hh * 1.05, hh * 1.05), z], i * 3);
        const c = pal[Math.floor(Math.random() * pal.length)], b = 0.4 + Math.random() * 0.6; col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        sz[i] = rand(d.s[0], d.s[1]); ph[i] = rand(0, 6.28); sp[i] = rand(0.6, 2.2);
      }
      const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('aCol', new BufferAttribute(col, 3)); g.setAttribute('aSize', new BufferAttribute(sz, 1)); g.setAttribute('aPh', new BufferAttribute(ph, 1)); g.setAttribute('aSp', new BufferAttribute(sp, 1));
      const m = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: 1 }, uGlint: { value: d.glint } },
        vertexShader: 'attribute vec3 aCol; attribute float aSize,aPh,aSp; varying vec3 vC; varying float vA; uniform float uT,uPx; void main(){ float tw=.62+.38*sin(uT*aSp+aPh); vC=aCol; vA=tw; gl_PointSize=aSize*uPx*(.8+.2*tw)*1.5; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'varying vec3 vC; varying float vA; uniform float uGlint; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); float a=smoothstep(.5,0.,d); a*=a; if(uGlint>.5){ float cr=max(smoothstep(.04,0.,abs(p.x))*smoothstep(.5,0.,abs(p.y)),smoothstep(.04,0.,abs(p.y))*smoothstep(.5,0.,abs(p.x)))*.6; a=max(a,cr); } gl_FragColor=vec4(vC*vA,a); }' });
      const pts = new Points(g, m); pts.frustumCulled = false; pts.renderOrder = -10 + li; scene.add(pts); starLayers.push({ pts, par: d.par, n: d.n });
    });
  }

  // far planets: soft discs
  const farSprites = T.far.map((f, i) => {
    const tx = softDisc(f[0], f[1], f[2]), m = new SpriteMaterial({ map: tx, transparent: true, opacity: 0.86, depthWrite: false });
    const s = new Sprite(m); s.position.set(i ? -1.8 : 1.65, i ? -2.8 : 2.9, i ? -4 : -5); s.scale.setScalar(i ? 2.5 : 2.1); s.renderOrder = -5; scene.add(s); disposables.push(tx, m);
    return { s, base: s.position.clone(), ph: i * 2 };
  });

  // bokeh dust (Dark only; Light has CSS motes)
  let dust = null, dustMat = null;
  if (T.dust) {
    const N = 34, dp = new Float32Array(N * 3), ds = new Float32Array(N), dph = new Float32Array(N), dsp = new Float32Array(N);
    for (let i = 0; i < N; i++) { dp.set([rand(-6, 6), rand(-7, 7), rand(-4, 5)], i * 3); ds[i] = rand(20, 82); dph[i] = rand(0, 6.28); dsp[i] = rand(0.1, 0.35); }
    const dg = new BufferGeometry(); dg.setAttribute('position', new BufferAttribute(dp, 3)); dg.setAttribute('aSize', new BufferAttribute(ds, 1)); dg.setAttribute('aPh', new BufferAttribute(dph, 1)); dg.setAttribute('aSp', new BufferAttribute(dsp, 1));
    dustMat = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: 1 }, uCol: { value: new Color(0xf0c896) }, uA: { value: 0.22 } },
      vertexShader: 'attribute float aSize,aPh,aSp; varying float vA; uniform float uT,uPx; void main(){ vec3 p=position; p.y+=mod(uT*aSp+aPh*2.,14.)-7.; p.x+=sin(uT*.2+aPh)*.5; vA=.5+.5*sin(uT*.35+aPh); vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=aSize*uPx*(1.2/max(.4,-mv.z*.08)); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying float vA; uniform vec3 uCol; uniform float uA; void main(){ float r=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.5,r)*(.4+.6*smoothstep(.5,.95,r)*.45); gl_FragColor=vec4(uCol,a*uA*(.35+.65*vA)); }' });
    dust = new Points(dg, dustMat); dust.frustumCulled = false; dust.renderOrder = 5; scene.add(dust);
  }

  // shooting stars (pool of two)
  const shoots = [];
  for (let i = 0; i < 2; i++) {
    const m = new ShaderMaterial({ transparent: true, depthWrite: false, blending: th === 'dark' ? AdditiveBlending : NormalBlending, uniforms: { uA: { value: 0 }, uCol: { value: new Color(T.shoot) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec2 vUv; uniform float uA; uniform vec3 uCol; void main(){ float tail=pow(vUv.x,2.6); float w=exp(-pow((vUv.y-.5)*9.,2.)); float head=exp(-pow((1.-vUv.x)*26.,2.))*exp(-pow((vUv.y-.5)*5.,2.)); float a=(tail*w*.9+head*1.4)*uA; gl_FragColor=vec4(uCol*a,a); }' });
    const mesh = new Mesh(new PlaneGeometry(1, 0.12), m); mesh.visible = false; mesh.renderOrder = 6; scene.add(mesh);
    shoots.push({ mesh, t: 9, dur: 1, from: new Vector3(), to: new Vector3(), next: rand(2.5, 5) + i * 3, len: 3 });
  }

  // tap sparkles: one pooled particle system
  const SN = 220, sparks = [];
  const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(new Float32Array(SN * 3), 3)); sg.setAttribute('aCol', new BufferAttribute(new Float32Array(SN * 3), 3)); sg.setAttribute('aLife', new BufferAttribute(new Float32Array(SN), 1));
  const sparkMat = new ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, uniforms: { uPx: { value: 1 } },
    vertexShader: 'attribute vec3 aCol; attribute float aLife; varying vec3 vC; varying float vL; uniform float uPx; void main(){ vC=aCol; vL=aLife; gl_PointSize=8.*uPx*(.4+aLife); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vC; varying float vL; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); float cr=max(smoothstep(.05,0.,abs(p.x))*smoothstep(.5,0.,abs(p.y)),smoothstep(.05,0.,abs(p.y))*smoothstep(.5,0.,abs(p.x))); float a=max(smoothstep(.5,0.,d)*smoothstep(.5,0.,d),cr*.9)*vL; if(a<.01) discard; gl_FragColor=vec4(vC*a,a); }' });
  const sparkPts = new Points(sg, sparkMat); sparkPts.frustumCulled = false; sparkPts.renderOrder = 20; scene.add(sparkPts);
  for (let i = 0; i < SN; i++) sparks.push({ p: new Vector3(), v: new Vector3(), life: 0, max: 1, c: new Color() });
  let sparkIdx = 0, sparksLive = 0;
  const burstCols = T.burst.map((c) => new Color(c));
  function burst(at, color, n, spread) {
    const cols = [color, burstCols[1] || color, burstCols[2] || color];
    for (let i = 0; i < n; i++) {
      const s = sparks[sparkIdx++ % SN]; s.p.copy(at); const a = Math.random() * 6.283, e = (Math.random() - 0.5) * 2, sp = (spread || 1) * rand(0.7, 2.6);
      s.v.set(Math.cos(a) * sp, Math.sin(a) * sp + e * 0.4, e * sp * 0.5); s.life = 1; s.max = rand(0.8, 1.5); s.c.copy(cols[i % 3]);
    }
    sparksLive = SN;
  }
  function updateSparks(dt) {
    if (!sparksLive) return;
    const P = sg.attributes.position, C = sg.attributes.aCol, L = sg.attributes.aLife; let any = 0;
    for (let i = 0; i < SN; i++) {
      const s = sparks[i];
      if (s.life > 0) { s.life -= dt / s.max; s.v.multiplyScalar(Math.exp(-1.7 * dt)); s.v.y -= 0.25 * dt; s.p.addScaledVector(s.v, dt); any++; }
      const l = Math.max(0, s.life); P.setXYZ(i, s.p.x, s.p.y, s.p.z); C.setXYZ(i, s.c.r, s.c.g, s.c.b); L.setX(i, l * l);
    }
    P.needsUpdate = C.needsUpdate = L.needsUpdate = true; if (!any) sparksLive = 0;
  }

  // warp streaks (only drawn while travelling into / out of a planet)
  const warpScene = new Scene(), warpCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const WN = 150, wp = new Float32Array(WN * 2 * 3), wr = new Float32Array(WN * 2 * 4);
  for (let i = 0; i < WN; i++) { const a = Math.random() * 6.2832, r0 = rand(0.06, 1.5), hh = Math.random(); for (let e = 0; e < 2; e++) { const k = i * 2 + e; wp.set([Math.cos(a), Math.sin(a), e], k * 3); wr.set([r0, hh, e, rand(0.5, 1)], k * 4); } }
  const wg = new BufferGeometry(); wg.setAttribute('position', new BufferAttribute(wp, 3)); wg.setAttribute('aR', new BufferAttribute(wr, 4));
  const warpMat = new ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, uniforms: { uW: { value: 0 }, uAsp: { value: 1 }, uTone: { value: new Color(th === 'light' ? 0xffffff : 0xffe6c0) } },
    vertexShader: 'attribute vec4 aR; varying float vA; uniform float uW,uAsp; void main(){ float len=mix(.1,.7+aR.y*2.6,aR.z); vec2 d=position.xy; float rr=aR.x*(1.+uW*len); vec2 p=d*rr; p.x/=uAsp; vA=uW*aR.w*smoothstep(.0,.6,aR.x)*(.35+.65*aR.z); gl_Position=vec4(p,0.,1.); }',
    fragmentShader: 'varying float vA; uniform vec3 uTone; void main(){ gl_FragColor=vec4(uTone*vA,vA); }' });
  const warpLines = new LineSegments(wg, warpMat); warpLines.frustumCulled = false; warpScene.add(warpLines);

  /* ---- planets (built one per frame as their textures finish) ---- */
  const planets = []; let moon = null, moonPivot = null, moonU = null;
  const bakeQ = [];
  DEFS.forEach((d, i) => bakeQ.push(() => buildPlanet(d, i)));
  bakeQ.push(() => buildMoon());
  function planetUniforms(map, d) {
    return {
      uSun: { value: SUN }, uMap: { value: map }, uClouds: { value: null }, uSpin: { value: 0 }, uCloudSpin: { value: 0 }, uGlow: { value: 0 }, uFlash: { value: 0 },
      uSpec: { value: d && d.spec ? 1 : 0 }, uCloudAmt: { value: 0 }, uRing: { value: d && d.ring ? 1 : 0 }, uRingIn: { value: 1.38 }, uRingOut: { value: 2.35 },
      uBump: { value: 0 }, uAmb: { value: amb }, uAtmo: { value: new Vector3() }, uSunCol: { value: sunCol }, uSunObj: { value: new Vector3() },
    };
  }
  function buildPlanet(d, i) {
    const pc = T.planets[i], g = new Group(); g.position.set(...d.pos); g.rotation.set(d.tiltX, 0, d.tiltZ); scene.add(g); g.updateMatrixWorld(true);
    const map = bake(pc.type, pc.seed, pc.pal, bakeSizes[i]), atc = new Color(T.atmo[d.atmo]);
    const U = planetUniforms(map, d); U.uAtmo.value.set(atc.r, atc.g, atc.b); if (pc.type === 1) U.uBump.value = 0.9;
    U.uSunObj.value.copy(SUN).applyQuaternion(g.quaternion.clone().invert());       // the planet never turns as a whole: computed once
    const geo = new SphereGeometry(1, 64, 48), mat = new ShaderMaterial({ uniforms: U, vertexShader: PLANET_VS, fragmentShader: PLANET_FS });
    const mesh = new Mesh(geo, mat); g.add(mesh); disposables.push(geo, mat);
    const P = { g, U, d, r: d.r, base: new Vector3(...d.pos), spin: Math.random(), spinVel: 0, sq: { x: 0, v: 0 }, glowT: 0, glow: 0, flash: 0, idx: i, orbPh: d.orbit[2], halo: null, shell: null, atmo: null, ring: null, color: atc, haloBase: 0 };
    g.scale.setScalar(d.r);
    const hm = new SpriteMaterial({ map: glowTex, color: atc, transparent: true, opacity: T.additive ? 0.06 : 0.34, depthWrite: false, blending: T.additive ? AdditiveBlending : NormalBlending });
    P.halo = new Sprite(hm); P.halo.scale.setScalar(3.5); P.halo.position.z = -0.4; g.add(P.halo); P.haloBase = hm.opacity; disposables.push(hm);
    if (d.clouds) {
      U.uClouds.value = bake(4, pc.seed + 2.5, T.cloudPal, 512); U.uCloudAmt.value = 0.95;
      const cgeo = new SphereGeometry(1.014, 56, 40);
      const cmat = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uSun: { value: SUN }, uMap: { value: U.uClouds.value }, uSpin: { value: 0 }, uAmt: { value: 0.95 }, uAmb: { value: amb }, uSunCol: { value: sunCol } }, vertexShader: PLANET_VS, fragmentShader: CLOUD_FS });
      P.shell = new Mesh(cgeo, cmat); g.add(P.shell); disposables.push(cgeo, cmat);
    }
    const ageo = new SphereGeometry(1.16, 48, 32);
    const amat = new ShaderMaterial({ transparent: true, depthWrite: false, side: BackSide, blending: T.additive ? AdditiveBlending : NormalBlending, uniforms: { uSun: { value: SUN }, uCol: { value: atc }, uSunObj: { value: U.uSunObj.value }, uAmt: { value: T.additive ? 0.95 : 0.9 }, uGlow: { value: 0 }, uAdd: { value: T.additive ? 1 : 0 } }, vertexShader: PLANET_VS, fragmentShader: ATMO_FS });
    P.atmo = new Mesh(ageo, amat); g.add(P.atmo); disposables.push(ageo, amat);
    if (d.ring) {
      const rgeo = new RingGeometry(1.38, 2.35, 180, 1);
      const rmat = new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, uniforms: { uSun: { value: SUN }, uCol0: { value: new Vector3(...T.ring[0]) }, uCol1: { value: new Vector3(...T.ring[1]) }, uSunObj: { value: U.uSunObj.value }, uSunCol: { value: sunCol }, uAmb: { value: amb }, uIn: { value: 1.38 }, uOut: { value: 2.35 }, uGlow: { value: 0 } }, vertexShader: RING_VS, fragmentShader: RING_FS });
      P.ring = new Mesh(rgeo, rmat); P.ring.rotation.x = -Math.PI / 2; g.add(P.ring); disposables.push(rgeo, rmat);
    }
    planets.push(P); applyLevel();
  }
  function buildMoon() {
    const mp = bake(1, 9.9, T.planets[4].pal, bakeSizes[4]); moonPivot = new Group(); scene.add(moonPivot);
    moonU = planetUniforms(mp, null); moonU.uBump.value = 0.9; moonU.uAtmo.value.set(0.9, 0.9, 0.95); moonU.uSunObj.value.copy(SUN);
    const geo = new SphereGeometry(0.17, 40, 28), mat = new ShaderMaterial({ uniforms: moonU, vertexShader: PLANET_VS, fragmentShader: PLANET_FS });
    moon = new Mesh(geo, mat); moonPivot.add(moon); disposables.push(geo, mat);
  }

  /* ---- quality: dynamic resolution first, then lighter effects ---- */
  function applyLevel() {
    planets.forEach((P) => { if (P.shell) P.shell.visible = level < 1; P.atmo.visible = level < 2; });
    if (dust) dust.visible = level < 2;
    starLayers.forEach((l) => { l.pts.geometry.setDrawRange(0, Math.max(1, Math.floor(l.n * (level === 0 ? 1 : level === 1 ? 0.65 : 0.4)))); });
  }
  function applyScale() {
    dpr = Math.max(0.75, BASE_DPR * scale);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    starLayers.forEach((l) => { l.pts.material.uniforms.uPx.value = dpr; });
    if (dustMat) dustMat.uniforms.uPx.value = dpr; sparkMat.uniforms.uPx.value = dpr;
  }
  const samples = []; let lastAdj = 0, goodRuns = 0, upWait = 6000, lastUp = 0, born = performance.now();
  function adapt(ms, now) {
    if (ms > 250 || now - born < 1800 || warp.on || bakeQ.length) return;     // tab switch, start-up, transitions: not a signal
    samples.push(ms); if (samples.length < 40) return;
    samples.sort((a, b) => a - b); const med = samples[20], p90 = samples[36]; samples.length = 0;
    const bad = med > 19.5 || p90 > 30;
    if (bad && now - lastAdj > 1200) {
      if (now - lastUp < 8000) upWait = Math.min(60000, upWait * 2);        // a step up just failed: be more patient next time
      if (scale > 0.72) scale = Math.max(0.7, scale - 0.15); else if (level < 2) { level++; applyLevel(); } else scale = Math.max(0.55, scale - 0.1);
      lastAdj = now; goodRuns = 0; applyScale();
    } else if (!bad && med < 17.6) {
      goodRuns++;
      const cap = lowEnd ? 0.9 : 1;
      if (goodRuns * 0.7 * 1000 > upWait && now - lastAdj > upWait && (scale < cap || level > 0)) {
        if (level > 0 && scale >= 0.85) { level--; applyLevel(); } else scale = Math.min(cap, scale + 0.1);
        lastAdj = lastUp = now; goodRuns = 0; applyScale();
      }
    } else goodRuns = Math.max(0, goodRuns - 1);
  }

  /* ---- view: drag / tilt / pinch / fling ---- */
  const view = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, aimX: 0, aimY: 0, velX: 0, velY: 0, zoom: { x: 13, v: 0 }, zoomT: 13 };
  const ZMIN = 8.5, ZMAX = 19, tilt = { x: 0, y: 0, bx: null, by: null, on: false, vx: 0, vy: 0 };
  const ptrs = new Map(); let gesture = null, pinch0 = null;
  const ray = new Raycaster(), ndc = new Vector2(), tmpV = new Vector3(), tmpS = new Sphere(), hitV = new Vector3();
  let fovT = 36, T0 = 0;
  const warp = { on: false, t: 0, dir: 1, dur: 0.46, planet: null, done: null };
  const camTarget = new Vector3(), tp = new Vector3(), goal = new Vector3();

  function pick(x, y) {
    ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, cam); let best = null, bd = 1e9;
    for (const P of planets) { P.g.getWorldPosition(tmpV); tmpS.set(tmpV, P.r * 1.06); if (ray.ray.intersectSphere(tmpS, hitV)) { const dd = hitV.distanceTo(cam.position); if (dd < bd) { bd = dd; best = P; } } }
    return best;
  }
  function worldAt(x, y, z0) { ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, cam); const t = (z0 - cam.position.z) / ray.ray.direction.z; return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t); }
  function bounce(P, strong) { P.sq.v += strong ? 5.6 : 3.2; P.spinVel += strong ? rand(0.5, 0.8) * (Math.random() < 0.5 ? -1 : 1) : 0.25; P.flash = 1; }
  function tapPlanet(P) { bounce(P, true); const at = P.g.getWorldPosition(new Vector3()); at.z += P.r * 0.9; burst(at, P.color, 38, 1.1); if (opts.onTap) opts.onTap('planet', P.idx); }
  function tapSpace(x, y) { burst(worldAt(x, y, 0), burstCols[0], 14, 0.7); if (opts.onTap) opts.onTap('space', 4); }
  function pulse() { if (!planets.length) return; const P = planets[Math.floor(Math.random() * planets.length)]; bounce(P, false); if (opts.onTap) opts.onTap('pulse', P.idx); }
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function onDown(e) {
    if (warp.on) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    const p = pt(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      const P = pick(p.x, p.y), now = performance.now();
      gesture = { P, x0: p.x, y0: p.y, t0: now, moved: 0, last: [{ t: now, x: p.x, y: p.y }], long: false, timer: 0 };
      if (P) gesture.timer = setTimeout(() => { if (gesture && gesture.P === P && gesture.moved < 10 && ptrs.size === 1) { gesture.long = true; P.glowT = 1; if (opts.onTap) opts.onTap('long', P.idx); } }, 430);
    } else { if (gesture && gesture.timer) clearTimeout(gesture.timer); gesture = null; const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: view.zoomT }; }
  }
  function onMove(e) {
    const pr = ptrs.get(e.pointerId);
    if (!pr) { if (e.pointerType === 'mouse') { const p = pt(e); view.aimX = (p.x / W - 0.5) * 0.9; view.aimY = (p.y / H - 0.5) * 0.6; } return; }
    const p = pt(e), dx = p.x - pr.x, dy = p.y - pr.y; pr.x = p.x; pr.y = p.y;
    if (ptrs.size >= 2 && pinch0) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1; view.zoomT = clamp(pinch0.z * (pinch0.d / d), ZMIN - 1.6, ZMAX + 2.2); return; }
    if (!gesture) return; const now = performance.now(); gesture.moved += Math.abs(dx) + Math.abs(dy);
    gesture.last.push({ t: now, x: p.x, y: p.y }); while (gesture.last.length > 2 && now - gesture.last[0].t > 90) gesture.last.shift();
    if (gesture.P && gesture.moved > 10) { if (gesture.timer) clearTimeout(gesture.timer); gesture.P.spin += dx * 0.0016; }
    else if (!gesture.P) { view.aimX = clamp(view.aimX + dx / W * 1.5, -1.4, 1.4); view.aimY = clamp(view.aimY + dy / H * 1.0, -1.1, 1.1); view.velX = 0; view.velY = 0; }
  }
  function onUp(e) {
    const had = ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!had) return; askTilt();
    if (gesture && ptrs.size === 0) {
      if (gesture.timer) clearTimeout(gesture.timer);
      const g = gesture, now = performance.now(), dur = now - g.t0, a = g.last[0], b = g.last[g.last.length - 1], span = Math.max(0.016, (b.t - a.t) / 1000);
      const vx = (b.x - a.x) / span, vy = (b.y - a.y) / span;                        // px/s over the last ~90 ms
      if (g.P) { if (g.long) g.P.glowT = 0; else if (g.moved < 10 && dur < 420) tapPlanet(g.P); else g.P.spinVel = clamp(vx * 0.0016, -3.5, 3.5); }
      else if (g.moved < 8 && dur < 350) tapSpace(b.x, b.y);
      else if (now - b.t < 80) { view.velX = clamp(vx / W * 1.5, -3, 3); view.velY = clamp(vy / H, -2, 2); }   // fling
      gesture = null;
    }
  }
  function onWheel(e) { e.preventDefault(); view.zoomT = clamp(view.zoomT + e.deltaY * 0.012, ZMIN, ZMAX); }
  function onPD(e) { onDown(e); } const noMenu = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', onPD); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('contextmenu', noMenu);

  // phone tilt: slow-moving baseline, so the sky is centred however the phone is held
  function onOrient(e) {
    if (e.gamma == null || e.beta == null) return;
    const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    let x = e.gamma, y = e.beta;
    if (a === 90) { x = e.beta; y = -e.gamma; } else if (a === 270 || a === -90) { x = -e.beta; y = e.gamma; } else if (a === 180) { x = -e.gamma; y = -e.beta; }
    tilt.rx = x; tilt.ry = y;
    if (tilt.bx === null) { tilt.bx = x; tilt.by = y; }
    tilt.on = true;
  }
  let tiltBound = false;
  function enableTilt() { if (tiltBound || typeof window.DeviceOrientationEvent === 'undefined') return; tiltBound = true; window.addEventListener('deviceorientation', onOrient, true); }
  let asked = false;
  function askTilt() {                                         // iPhone: needs a tap; Android: no permission needed
    if (asked) return; asked = true;
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') { try { D.requestPermission().then((r) => { if (r === 'granted') enableTilt(); }).catch(() => {}); } catch (e) { /* ignore */ } }
    else enableTilt();
  }
  if (!(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function')) enableTilt();

  /* ---- loop ---- */
  let raf = 0, last = performance.now(), parX = 9, parY = 9;
  const T1 = { c: 0 };
  function update(dt) {
    T0 += dt;
    const dragging = ptrs.size === 1 && gesture && !gesture.P;
    if (!dragging) {
      view.aimX += view.velX * dt; view.aimY += view.velY * dt; const fr = Math.exp(-3.2 * dt); view.velX *= fr; view.velY *= fr;
      view.aimX = damp(view.aimX, 0, 0.45, dt); view.aimY = damp(view.aimY, 0, 0.45, dt);
    }
    let tx = 0, ty = 0;
    if (tilt.on && tilt.bx !== null) {
      tilt.bx = damp(tilt.bx, tilt.rx, 0.18, dt); tilt.by = damp(tilt.by, tilt.ry, 0.18, dt);
      tx = clamp((tilt.rx - tilt.bx) / 20, -1, 1); ty = clamp((tilt.ry - tilt.by) / 20, -1, 1);
    }
    const ax = soft(view.aimX, 1.0) + tx * 0.9, ay = soft(view.aimY, 0.8) + ty * 0.6;
    spring(view.x, ax, 60, crit(60), dt); spring(view.y, ay, 60, crit(60), dt);
    if (ptrs.size < 2) view.zoomT = clamp(view.zoomT, ZMIN, ZMAX);   // rubber band: pinch past the end, let go, and it springs back
    spring(view.zoom, view.zoomT, 52, crit(52), dt);
    const driftX = reduced ? 0 : Math.sin(T0 * 0.11) * 0.28, driftY = reduced ? 0 : Math.cos(T0 * 0.083) * 0.2, vx = view.x.x, vy = view.y.x;
    if (warp.on) {
      const p = clamp(warp.t, 0, 1), k = warp.dir > 0 ? p * p * (3 - 2 * p) * (0.4 + 0.6 * p) : Math.pow(1 - p, 3);
      warp.planet.g.getWorldPosition(tp); goal.copy(tp); goal.z += warp.planet.r * 2.3;
      cam.position.set(lerp(vx * 1.4 + driftX, goal.x, k), lerp(-vy * 0.9 + driftY, goal.y, k), lerp(view.zoom.x, goal.z, k));
      camTarget.set(lerp(vx * 0.35, tp.x, k), lerp(-vy * 0.25, tp.y, k), lerp(0, tp.z, k)); cam.lookAt(camTarget);
      cam.fov = lerp(fovT, 82, k); cam.updateProjectionMatrix(); warpMat.uniforms.uW.value = Math.pow(k, 1.4);
    } else {
      cam.position.set(vx * 1.4 + driftX, -vy * 0.9 + driftY, view.zoom.x); camTarget.set(vx * 0.35, -vy * 0.25, 0); cam.lookAt(camTarget);
      if (Math.abs(cam.fov - fovT) > 0.01) { cam.fov = fovT; cam.updateProjectionMatrix(); }
      if (warpMat.uniforms.uW.value) warpMat.uniforms.uW.value = 0;
    }
    starLayers.forEach((l) => { l.pts.position.x = -vx * l.par * 22; l.pts.position.y = vy * l.par * 16; l.pts.material.uniforms.uT.value = T0; });
    if (dustMat) dustMat.uniforms.uT.value = T0;
    sunGlow.position.x = -5.5 - vx * 1.2;
    farSprites.forEach((f) => f.s.position.set(f.base.x - vx * 0.5, f.base.y + vy * 0.35 + (reduced ? 0 : Math.sin(T0 * 0.3 + f.ph) * 0.08), f.base.z));
    for (const P of planets) {
      const o = P.d.orbit, a = T0 * o[1] + P.orbPh, f = reduced ? 0 : 1;
      P.g.position.set(P.base.x + Math.cos(a) * o[0] * f - vx * 0.12 * (1 + P.idx * 0.2), P.base.y + Math.sin(a * 1.3) * o[0] * 0.6 * f + vy * 0.09, P.base.z + Math.sin(a) * o[0] * 0.5 * f);
      P.spinVel *= Math.exp(-1.25 * dt); P.spin += ((reduced ? 0 : P.d.spin) + P.spinVel) * dt; P.U.uSpin.value = P.spin;
      if (P.shell) { P.U.uCloudSpin.value = P.spin * 1.35 + T0 * 0.004; P.shell.material.uniforms.uSpin.value = P.U.uCloudSpin.value; }
      spring(P.sq, 0, 230, 9.5, dt);
      const s = P.r, pu = 1 + P.glow * 0.035 * Math.sin(T0 * 5.2); P.g.scale.set(s * (1 - P.sq.x * 0.5) * pu, s * (1 + P.sq.x) * pu, s * (1 - P.sq.x * 0.5) * pu);
      P.glow = damp(P.glow, P.glowT, P.glowT > P.glow ? 7 : 3.4, dt); P.flash = damp(P.flash, 0, 3.2, dt);
      P.U.uGlow.value = P.glow * (0.85 + 0.15 * Math.sin(T0 * 5.2)); P.U.uFlash.value = P.flash; P.atmo.material.uniforms.uGlow.value = P.glow + P.flash * 0.8; if (P.ring) P.ring.material.uniforms.uGlow.value = P.glow;
      P.halo.material.opacity = P.haloBase * (1 + P.glow * 2.2 + P.flash * 1.4); P.halo.scale.setScalar(3.5 * (1 + P.glow * 0.25 + P.flash * 0.2));
    }
    if (moon && planets[1]) {
      const p1 = planets[1]; moonPivot.position.copy(p1.g.position); const ma = T0 * 0.42, rr = 1.75 * p1.r * 0.9;
      moon.position.set(Math.cos(ma) * rr, Math.sin(ma * 1.1) * 0.22, Math.sin(ma) * rr); moon.rotation.y += dt * 0.2; moonU.uSpin.value += dt * 0.03;
    }
    if (!reduced) for (const s of shoots) {
      s.next -= dt;
      if (!s.mesh.visible && s.next <= 0 && !warp.on && ready) {
        const fromLeft = Math.random() < 0.55, y = rand(1.8, 4.6), z = -8; s.from.set(fromLeft ? rand(-6, -2) : rand(2, 6), y, z); s.to.set(s.from.x + (fromLeft ? 1 : -1) * rand(5, 8), y - rand(2.4, 4), z);
        s.t = 0; s.dur = rand(0.7, 1.1); s.len = rand(2.4, 3.6); s.mesh.visible = true; s.mesh.scale.set(s.len, 1, 1);
        s.mesh.rotation.z = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x) + Math.PI;
      }
      if (s.mesh.visible) {
        s.t += dt / s.dur; const k = clamp(s.t, 0, 1), e = 1 - Math.pow(1 - k, 2.2); s.mesh.position.lerpVectors(s.from, s.to, e);
        s.mesh.material.uniforms.uA.value = (th === 'light' ? 0.75 : 1) * Math.sin(k * Math.PI); if (s.t >= 1) { s.mesh.visible = false; s.next = rand(4, 9); }
      }
    }
    updateSparks(dt);
    if (opts.onParallax) { const px = clamp(vx * 0.8, -1, 1), py = clamp(vy, -1, 1); if (Math.abs(px - parX) > 0.0015 || Math.abs(py - parY) > 0.0015) { parX = px; parY = py; opts.onParallax(px, py); } }
  }
  function frame(now) {
    if (!alive || lost) return;
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now; if (raw <= 0) return;
    const dt = Math.min(raw, 0.1);
    if (bakeQ.length) { const job = bakeQ.shift(); try { job(); } catch (e) { /* a failed texture only costs that planet */ } if (!bakeQ.length) { ready = true; if (opts.intro === 'out' && planets[1]) { warp.on = true; warp.dir = -1; warp.t = 0; warp.dur = 0.62; warp.planet = planets[1]; } if (opts.onReady) opts.onReady(); } }
    if (warp.on) {
      warp.t += dt / warp.dur;
      if (warp.t >= 1) { warp.t = 1; if (warp.dir < 0) { warp.on = false; warpMat.uniforms.uW.value = 0; } const d = warp.done; warp.done = null; if (d) d(); }
    }
    update(dt);
    renderer.autoClear = true; renderer.render(scene, cam);
    if (warpMat.uniforms.uW.value > 0.001) { renderer.autoClear = false; renderer.render(warpScene, warpCam); }
    adapt(raw * 1000, now);
  }
  function resize() {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight; if (!alive) return;
    renderer.setSize(W, H, false); cam.aspect = W / H; fovT = W / H < 0.7 ? 36 : 27; if (!warp.on) cam.fov = fovT; cam.updateProjectionMatrix(); warpMat.uniforms.uAsp.value = W / H;
  }
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas);
  const onLost = (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); if (opts.onLost) opts.onLost(); };
  canvas.addEventListener('webglcontextlost', onLost);
  fovT = W / H < 0.7 ? 36 : 27; cam.fov = fovT; cam.position.set(0, 0, 13); applyScale(); resize(); applyLevel();
  raf = requestAnimationFrame(frame);

  /** Travel into the ocean world (code accepted). Resolves when the camera has arrived (about half a second). */
  function enter() {
    return new Promise((res) => {
      if (!planets[1] || warp.on) return res();
      warp.planet = planets[1]; warp.on = true; warp.dir = 1; warp.t = 0; warp.dur = 0.46; warp.done = res;
    });
  }
  function destroy() {
    alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect();
    ptrs.clear(); if (gesture && gesture.timer) clearTimeout(gesture.timer); gesture = null;
    canvas.removeEventListener('pointerdown', onPD); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('contextmenu', noMenu); canvas.removeEventListener('webglcontextlost', onLost);
    if (tiltBound) window.removeEventListener('deviceorientation', onOrient, true);
    targets.forEach((t) => t.dispose()); disposables.forEach((d) => d.dispose && d.dispose());
    [sg, wg, quad.geometry, bakeMat, sparkMat, warpMat].forEach((d) => d.dispose && d.dispose());
    starLayers.forEach((l) => { l.pts.geometry.dispose(); l.pts.material.dispose(); }); if (dust) { dust.geometry.dispose(); dustMat.dispose(); }
    shoots.forEach((s) => { s.mesh.geometry.dispose(); s.mesh.material.dispose(); });
    renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
  }
  return {
    destroy, pulse, resize, enter, enableTilt, planetCount: () => planets.length, ready: () => ready,
    stats: () => ({ scale, level, dpr, tilt: tilt.on, planets: planets.length, ready, vx: view.x.x }),
    debug: { tap: (i) => planets[i] && tapPlanet(planets[i]), hold: (i, on) => { if (planets[i]) planets[i].glowT = on ? 1 : 0; }, tilt: (x, y) => { tilt.on = true; tilt.rx = x; tilt.ry = y; if (tilt.bx === null) { tilt.bx = 0; tilt.by = 0; } } },
  };
}

/** The dark theme's night sky (2D canvas, drawn once): a faint Milky Way made of thousands of tiny stars, dust lanes,
 *  magnitude-distributed field stars with colour temperature, a few bright stars with soft glints. */
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
  const N = Math.min(22000, Math.round((W * H) / 38));
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
    const r = 0.35 + st.m * 1.7;
    if (st.m > 0.12) { const g = c.createRadialGradient(st.x, st.y, 0, st.x, st.y, r * 7); g.addColorStop(0, `rgba(${st.c},${0.28 * st.a})`); g.addColorStop(1, `rgba(${st.c},0)`); c.fillStyle = g; c.fillRect(st.x - r * 7, st.y - r * 7, r * 14, r * 14); }
    c.fillStyle = `rgba(${st.c},${Math.min(1, st.a + 0.15)})`; c.beginPath(); c.arc(st.x, st.y, r, 0, 6.3); c.fill();
  });
  for (let i = 0; i < 9; i++) {
    const x = R() * W, y = R() * H * 0.85, r = 1.6 + R() * 1.1, col = pal[Math.floor(R() * pal.length)];
    const g = c.createRadialGradient(x, y, 0, x, y, r * 12); g.addColorStop(0, `rgba(${col},.55)`); g.addColorStop(0.25, `rgba(${col},.14)`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.fillRect(x - r * 12, y - r * 12, r * 24, r * 24);
    c.strokeStyle = `rgba(${col},.45)`; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x - r * 6, y); c.lineTo(x + r * 6, y); c.moveTo(x, y - r * 6); c.lineTo(x, y + r * 6); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.8, 0, 6.3); c.fill();
  }
}

function prewarm() { /* textures are baked on the GPU when the sky opens, one per frame: nothing to prepare */ }

window.Galaxy = { create, drawNight, prewarm };
