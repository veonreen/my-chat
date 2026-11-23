/* Galaxy Relax: Stealth Mode.
 * After login the app shows a calm 3D night sky (the decoy). The "Name your planet" box is the real unlock box:
 * typing the secret code shows the private area at once, without pressing anything.
 *  - Only a salted PBKDF2 hash of the code is stored (locally and on the server so both phones share it). The typed
 *    text is never sent, saved or logged. It stays inside this file and the input box, and is cleared on every hide.
 *  - The private area (#app) is removed from the page whenever the decoy is showing, so no message exists in the DOM.
 *  - It hides again on: app switch, tab hidden, screen off, window blur, shake, or a 3 second press on the top bar /
 *    empty conversation background. */
(function () {
  const MC = window.MC;
  const { u } = MC;
  const S = MC.S;
  const core = MC.core;
  const $ = (id) => document.getElementById(id);

  // Default code record (code itself is not in the source): PBKDF2-SHA256, 100k rounds, fixed public salt.
  const DEFAULT_REC = { s: '7f3a9c1e5b2d48a6c0e19f47d3b8a265', h: '2a4273ec371d0878cfb72a263d139054f10bc448bdb95a962d0af7cb7acb3353', i: 100000, n: 18, ts: 0 };
  let rec = DEFAULT_REC;
  try { const r = MC.LS.get('mychat.sc', null); if (r && r.s && r.h && r.i && r.n) rec = r; } catch (e) { /* ignore */ }

  let state = 'off';                    // 'off' | 'decoy' | 'chat'
  let sky = null, bound = false, holdUntil = 0, holdTimer = 0, pendingMount = false;

  // ---------- code hashing ----------
  const h2b = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  const b2h = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  async function hashOf(text, r) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(text).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return b2h(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: h2b(r.s), iterations: r.i, hash: 'SHA-256' }, key, 256));
  }
  /** Does the typed text contain the code? Typing appends, so normally only the last n letters are checked;
   *  after a paste (or any non-typing edit) every window of n letters is checked. */
  async function matches(text, scanAll) {
    const n = rec.n;
    if (text.length < n) return false;
    if (!scanAll) return (await hashOf(text.slice(-n), rec)) === rec.h;
    for (let i = 0; i + n <= text.length; i++) if ((await hashOf(text.slice(i, i + n), rec)) === rec.h) return true;
    return false;
  }
  async function verifyCode(code) { return String(code).length === rec.n && (await hashOf(code, rec)) === rec.h; }
  function randHex(n) { return b2h(crypto.getRandomValues(new Uint8Array(n))); }
  /** Settings -> Change secret code. Needs the current code. The new record goes to the server so both phones switch. */
  async function changeCode(oldCode, newCode) {
    if (!(await verifyCode(oldCode))) throw new MC.api.ApiError('bad_code', 'The current code is not right');
    newCode = String(newCode);
    if (newCode.length < 8 || newCode.length > 64 || !newCode.trim()) throw new MC.api.ApiError('weak_code', 'Use 8 to 64 characters');
    const r = { s: randHex(16), i: 100000, n: newCode.length };
    r.h = await hashOf(newCode, r);
    const res = await MC.api.call('scset', { rec: r }, { timeout: 20000 });
    rec = res.rec; MC.LS.set('mychat.sc', rec);
  }
  /** A record from the server (login sync or live event): newer wins. */
  function syncCode(r) {
    if (r && r.s && r.h && r.i && r.n && (r.ts || 0) > (rec.ts || 0)) { rec = r; MC.LS.set('mychat.sc', rec); }
  }

  // ---------- the sky ----------
  function mountSky() {
    if (sky || document.hidden) { if (document.hidden) pendingMount = true; return; }
    pendingMount = false;
    let cv = $('sky');
    if (!cv) return;
    const fresh = cv.cloneNode(false);           // a canvas whose WebGL context was released cannot be reused
    cv.replaceWith(fresh); cv = fresh;
    if (!window.Galaxy) { let t = 0; const w = setInterval(() => { if (window.Galaxy || ++t > 40) { clearInterval(w); if (window.Galaxy && state === 'decoy') mountSky(); } }, 150); return; }
    try {
      sky = window.Galaxy.create(cv, { onTap: (kind) => { if (kind === 'planet') { u.haptic(8); if (S.settings.sound) u.sfx('planet'); } } });
      requestAnimationFrame(() => cv.classList.add('ready'));
    } catch (e) { sky = null; }                  // no WebGL: the CSS night sky and the unlock box still work
  }
  function unmountSky() {
    if (sky) { try { sky.destroy(); } catch (e) { /* ignore */ } sky = null; }
    const cv = $('sky'); if (cv) cv.classList.remove('ready');
    pendingMount = false;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  }
  function showDecoy(anim) {
    state = 'decoy';
    MC.showScreen('decoy');
    const d = $('decoy');
    d.classList.remove('in-fade', 'in-warp'); void d.offsetWidth;
    if (anim) d.classList.add(anim === 'warp' ? 'in-warp' : 'in-fade');
    $('dc-hi').textContent = greeting();
    $('dc-input').value = '';
    mountSky();
    unread(core.totalUnread());
    core.sendVis();
  }

  // ---------- state changes ----------
  function begin() {
    if (!bound) bind();
    MC.ui.park();
    showDecoy('fade');
    if (!needsMotionPermission()) enableShake();
  }
  function reveal() {
    if (state !== 'decoy') return;
    state = 'chat';
    $('dc-input').value = ''; $('dc-input').blur();
    unmountSky();
    MC.ui.start();
    core.sendVis();
  }
  function hide(reason) {
    if (state !== 'chat') return;
    MC.ui.sleep();                               // synchronous: the private area is gone from the page first
    if (MC.fx) MC.fx.clear();
    clearTimeout(holdTimer); cancelHold();
    showDecoy(reason === 'panic' ? 'warp' : 'fade');
  }
  function autoHide() {
    if (state !== 'chat') return;
    if (Date.now() < holdUntil) { document.body.classList.add('privacy'); return; }   // a file picker / mic prompt is open: blur only
    hide('away');
  }
  /** Call before opening something that makes the browser blur the page (file picker, camera, mic prompt). */
  function hold(ms) {
    holdUntil = Date.now() + ms;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { if (state === 'chat' && (document.hidden || !document.hasFocus())) hide('away'); }, ms + 80);
  }
  function release() {
    holdUntil = 0; clearTimeout(holdTimer);
    document.body.classList.remove('privacy');
    if (state === 'chat' && document.hidden) hide('away');
  }

  // little glowing star on the decoy when something is unread
  function unread(n) {
    const st = $('dc-star'); if (!st) return;
    st.classList.toggle('on', n > 0 && state !== 'chat');
  }

  // ---------- shake ----------
  let shakeOn = false, lx, ly, lz, hits = [], cool = 0, motionAsked = false;
  const needsMotionPermission = () => typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  function onMotion(e) {
    if (state !== 'chat' || !S.settings.shake) return;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const now = Date.now();
    if (lx !== undefined) {
      const d = Math.abs(a.x - lx) + Math.abs(a.y - ly) + Math.abs(a.z - lz);
      if (d > 28 && now > cool) {
        if (!hits.length || now - hits[hits.length - 1] > 55) hits.push(now);
        hits = hits.filter((t) => now - t < 1100);
        if (hits.length >= 4) { hits = []; cool = now + 2500; u.haptic([40, 40, 40]); hide('panic'); }
      }
    }
    lx = a.x; ly = a.y; lz = a.z;
  }
  function enableShake() { if (shakeOn || typeof window.DeviceMotionEvent === 'undefined') return; shakeOn = true; window.addEventListener('devicemotion', onMotion); }
  /** iPhone needs a tap to allow motion. Safe to call from any tap/click handler; asks at most once per page load. */
  async function askMotion() {
    if (!needsMotionPermission()) { enableShake(); return 'granted'; }
    if (motionAsked && shakeOn) return 'granted';
    motionAsked = true;
    try { const r = await DeviceMotionEvent.requestPermission(); if (r === 'granted') enableShake(); return r; } catch (e) { motionAsked = false; return 'denied'; }
  }

  // ---------- 3 second press on the top bar / empty background ----------
  let hp = null;
  const inZone = (t) => !!(t && t.closest && (t.closest('.sb-head, .ch-head') || t.id === 'msgs' || t.id === 'msgs-wrap' || (t.classList && (t.classList.contains('row') || t.classList.contains('sep') || t.classList.contains('older')))));
  function cancelHold() { if (hp) { clearTimeout(hp.t); hp = null; } }

  // ---------- wiring ----------
  function bind() {
    bound = true;
    $('dc-sleep').innerHTML = u.ic('moonStar'); $('dc-go').innerHTML = u.ic('sparkles');
    $('dc-star').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.6 5.4 2 7.4 3.4 8.6 1.4 1.3 3.5 2.2 7.1 2.4-3.6.3-5.7 1.2-7.1 2.5-1.4 1.2-2.8 3.2-3.4 8.5-.6-5.3-2-7.3-3.4-8.5C7.2 13.2 5.1 12.3 1.5 12.5c3.6-.2 5.7-1.1 7.1-2.4C10 8.9 11.4 6.9 12 1.5z"/></svg>';
    const input = $('dc-input');
    let seq = 0;
    input.addEventListener('input', async (e) => {
      const v = input.value, my = ++seq;
      if (v.length < rec.n) return;
      const typed = e.inputType === 'insertText' || e.inputType === 'insertCompositionText' || e.inputType === 'deleteContentBackward';
      let ok = false;
      try { ok = await matches(v, !typed); } catch (err) { ok = false; }
      if (ok && state === 'decoy') { input.value = ''; reveal(); }     // instantly, no Enter needed; the text is wiped first
      else if (my === seq && !ok) { /* wrong text: nothing happens */ }
    });
    const planet = () => { if (sky) sky.pulse(); u.haptic(10); if (S.settings.sound) { u.unlockAudio(); u.sfx('planet'); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); planet(); input.value = ''; } });
    $('dc-go').addEventListener('click', () => { planet(); input.value = ''; askMotion(); });
    $('dc-sleep').addEventListener('click', () => core.lockNow());
    $('decoy').addEventListener('click', () => askMotion(), { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoHide();
      else {
        document.body.classList.remove('privacy');
        if (state === 'decoy' && !sky) mountSky();
      }
    });
    window.addEventListener('pagehide', autoHide);
    window.addEventListener('blur', autoHide);

    document.addEventListener('pointerdown', (e) => {
      if (state !== 'chat' || (e.pointerType === 'mouse' && e.button !== 0) || !inZone(e.target)) return;
      cancelHold();
      hp = { x: e.clientX, y: e.clientY, t: setTimeout(() => { hp = null; u.haptic([30, 40, 30]); hide('panic'); }, 3000) };
    }, true);
    document.addEventListener('pointermove', (e) => { if (hp && Math.hypot(e.clientX - hp.x, e.clientY - hp.y) > 14) cancelHold(); }, true);
    ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, cancelHold, true));
    document.addEventListener('contextmenu', (e) => { if (state === 'chat' && inZone(e.target) && !(e.target.closest && e.target.closest('.bubble'))) e.preventDefault(); }, true);
  }

  MC.stealth = {
    begin, reveal, hide, hold, release, unread, syncCode, changeCode, verifyCode, askMotion,
    isChat: () => state === 'chat', state: () => state,
    needsMotionPermission, motionOn: () => shakeOn,
  };
})();
