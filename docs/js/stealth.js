/* Galaxy Relax: Stealth Mode.
 * After login the app shows a calm 3D sky (the decoy). The "Name your planet" box is the real unlock box:
 * typing the unlock code opens the private area at once, without pressing anything.
 *  - The code is also the encryption key: it is stretched with Argon2id (in a worker) into the AES key. It is never sent,
 *    saved or logged, and no hash of it exists anywhere except as a throw-away in-memory check for re-unlocking.
 *  - The private area (#app) is removed from the page whenever the sky is showing, so no message exists in the DOM.
 *  - It hides again on: app switch, tab hidden, screen off, window blur, shake, or a 3 second press on the header /
 *    empty conversation background (a progress ring shows while pressing; touch screens use touch events, a mouse uses pointer events).
 *  - Opening: the camera dives into the ocean world (warp), the chat blooms in. Hiding: the chat is gone at once and the sky
 *    pulls back out of the planet. */
(function () {
  const MC = window.MC;
  const { u } = MC;
  const S = MC.S;
  const core = MC.core;
  const $ = (id) => document.getElementById(id);

  let state = 'off';                    // 'off' | 'decoy' | 'chat'
  let sky = null, bound = false, holdUntil = 0, holdTimer = 0, rid = 0;
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- the sky ----------
  const theme = () => core.resolvedTheme();
  function buildAir() {                  // light theme only: drifting clouds + floating light motes (pure CSS animation)
    const air = $('dc-air'); if (!air) return;
    air.replaceChildren();
    if (theme() !== 'light') return;
    let sd = 7; const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const clouds = [[-20, 14, 360, 130, 0.6, 70], [55, 30, 300, 110, 0.5, 95], [-10, 52, 380, 150, 0.55, 80], [48, 68, 340, 130, 0.62, 110], [10, 84, 420, 160, 0.7, 90]];
    clouds.forEach(([x, y, w, h, o, d], i) => air.append(Object.assign(document.createElement('i'), { className: 'cloud', style: `left:${x}%;top:${y}%;width:${w}px;height:${h}px;opacity:${o};animation-duration:${d}s;animation-delay:${-i * 17}s` })));
    for (let i = 0; i < 20; i++) {
      const sz = 2 + R() * 4;
      air.append(Object.assign(document.createElement('i'), { className: 'mote', style: `left:${(R() * 100).toFixed(1)}%;top:${(10 + R() * 85).toFixed(1)}%;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;--o:${(0.35 + R() * 0.5).toFixed(2)};animation-duration:${(14 + R() * 18).toFixed(1)}s;animation-delay:${(-R() * 30).toFixed(1)}s` }));
    }
  }
  function mountSky(intro) {
    if (sky) return;
    if (document.hidden) return;
    let cv = $('sky');
    if (!cv) return;
    const fresh = cv.cloneNode(false);           // a canvas whose WebGL context was released cannot be reused
    cv.replaceWith(fresh); cv = fresh;
    if (!window.Galaxy) { let t = 0; const w = setInterval(() => { if (window.Galaxy || ++t > 40) { clearInterval(w); if (window.Galaxy && state === 'decoy') mountSky(intro); } }, 150); return; }
    const th = theme();
    const night = $('dc-night');
    if (th === 'dark') { try { window.Galaxy.drawNight(night); } catch (e) { /* plain black */ } }
    night.classList.toggle('on', th === 'dark');
    buildAir();
    try {
      sky = window.Galaxy.create(cv, {
        theme: th, intro,
        onTap: (kind, idx) => {
          if (kind === 'planet') { u.haptic(12); if (S.settings.sound) u.chime(idx); }
          else if (kind === 'long') { u.haptic(10); if (S.settings.sound) u.chime((idx || 0) + 2, true); }
          else if (kind === 'space') { u.haptic(6); if (S.settings.sound) u.chime(4, true); }
          else if (kind === 'pulse') { u.haptic(8); if (S.settings.sound) u.chime(idx || 0, true); }
        },
        onParallax: (x, y) => { night.style.transform = `translate3d(${(x * -14).toFixed(1)}px, ${(y * -10).toFixed(1)}px, 0) scale(1.06)`; },
        onReady: () => { cv.classList.add('ready'); },
        onLost: () => { unmountSky(); if (state === 'decoy') setTimeout(() => mountSky(), 120); },     // the phone took the GPU away: start again
      });
      if (shakeOn || !needsMotionPermission()) sky.enableTilt();
    } catch (e) { sky = null; cv.classList.add('ready'); }                  // no WebGL: the gradient sky and the unlock box still work
  }
  function unmountSky() {
    if (sky) { try { sky.destroy(); } catch (e) { /* ignore */ } sky = null; }
    const cv = $('sky'); if (cv) cv.classList.remove('ready');
  }
  /** Light/Dark changed (or Auto crossed 6 AM / 7 PM) while the sky is showing: rebuild it in the new theme. */
  function themeChanged() { if (state === 'decoy') { unmountSky(); mountSky(); } }

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  }
  function showDecoy(anim) {
    state = 'decoy';
    MC.showScreen('decoy');
    const d = $('decoy');
    d.classList.remove('in-fade', 'in-warp', 'leaving', 'warping'); void d.offsetWidth;
    if (anim) d.classList.add(anim === 'warp' ? 'in-warp' : 'in-fade');
    $('dc-hi').textContent = greeting();
    $('dc-input').value = ''; lastFail = '';
    mountSky(anim && !reducedMotion() ? 'out' : null);        // coming back from the chat: the camera pulls out of the planet
    unread(core.totalUnread());
    core.sendVis();
  }

  // ---------- state changes ----------
  function begin() {
    if (!bound) bind();
    MC.ui.park();
    showDecoy('');
    if (!needsMotionPermission()) enableShake();
  }
  /** The code was right: the private area is built underneath, the camera dives into the planet, the chat blooms in. */
  function reveal() {
    if (state !== 'decoy' || document.hidden) return;
    state = 'chat';
    const my = ++rid, d = $('decoy');
    $('dc-input').value = ''; $('dc-input').blur();
    MC.ui.start({ keepDecoy: true });
    core.sendVis();
    const app = $('app');
    const finish = () => {
      if (my !== rid || state !== 'chat') return;
      d.classList.remove('leaving', 'warping'); if (app) app.classList.remove('app-in');
      unmountSky(); MC.showScreen('app');
    };
    if (!sky || !sky.ready() || reducedMotion()) { finish(); return; }
    u.haptic([14, 30, 10]); if (S.settings.sound) { u.unlockAudio(); u.sfx('whoosh'); }
    d.classList.add('warping');
    sky.enter();
    setTimeout(() => { if (my !== rid || state !== 'chat') return; d.classList.add('leaving'); if (app) app.classList.add('app-in'); }, 330);
    setTimeout(finish, 640);
  }
  function hide(reason) {
    if (state !== 'chat') return;
    rid++;
    MC.ui.sleep();                               // synchronous: the private area is gone from the page first
    if (MC.fx) MC.fx.clear();
    clearTimeout(holdTimer); cancelHold();
    unmountSky();                                // may still be there if we were hidden in the middle of opening
    const d = $('decoy'); if (d) d.classList.remove('leaving', 'warping');
    const app = $('app'); if (app) app.classList.remove('app-in');
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

  // a glowing star on the sky when something is unread (needs no key: it only counts)
  function unread(n) {
    const st = $('dc-star'); if (!st) return;
    st.classList.toggle('on', n > 0 && state !== 'chat');
  }

  // ---------- unlock ----------
  let busy = false, queued = null, idleT = 0, lastFail = '';
  async function run(code) {
    if (!code || code === lastFail || state !== 'decoy') return;
    if (busy) { queued = code; return; }
    busy = true;
    try {
      const res = await core.tryUnlock(code);
      if (res === 'ok') { await core.freshStart(); if (state === 'decoy') { $('dc-input').value = ''; reveal(); } }
      else lastFail = code;                      // wrong text: nothing happens, no message, no sound
    } catch (e) { /* offline etc.: stay quiet */ }
    busy = false;
    if (queued) { const q = queued; queued = null; if (q !== code && state === 'decoy') run(q); }
  }
  /** Try as soon as the typed length equals the known code length; otherwise after a short pause (new phone / changed code). */
  function onType() {
    clearTimeout(idleT);
    const v = $('dc-input').value, n = core.codeLen();
    if (v.length < 6) return;
    if (n && v.length === n) { run(v); return; }
    idleT = setTimeout(() => {
      const cur = $('dc-input').value;
      if (cur.length < 6) return;
      run(cur);
      if (n && cur.length > n) run(cur.slice(-n));      // junk typed before the code
    }, 700);
  }

  // ---------- shake ----------
  let shakeOn = false, lx, ly, lz, hits = [], cool = 0, motionAsked = false;
  const needsMotionPermission = () => (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') || (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function');
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
  /** iPhone needs a tap to allow motion (shake to hide, and tilt in the sky). Safe to call from any tap/click handler; asks at most once per page load. */
  async function askMotion() {
    if (!needsMotionPermission()) { enableShake(); if (sky) sky.enableTilt(); return 'granted'; }
    if (motionAsked && shakeOn) return 'granted';
    motionAsked = true;
    try {
      const M = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' ? DeviceMotionEvent : DeviceOrientationEvent;
      const r = await M.requestPermission();
      if (r === 'granted') { enableShake(); if (sky) sky.enableTilt(); }
      return r;
    } catch (e) { motionAsked = false; return 'denied'; }
  }

  // ---------- 3 second press on the header / empty background ----------
  // Phones: touch events (a finger wobbles, the browser may want a long-press menu; both are handled). Mouse: pointer events.
  // A ring fills while pressing; moving more than a little, lifting, a second finger or the browser taking over cancels it.
  const HOLD_MS = 3000, RING_AFTER = 350, WOBBLE = 26;
  let hp = null, ringEl = null;
  const inZone = (t) => !!(t && t.closest && (t.closest('.sb-head, .ch-head, .rail') || t.id === 'msgs' || t.id === 'msgs-wrap' || (t.classList && (t.classList.contains('row') || t.classList.contains('sep') || t.classList.contains('older') || t.classList.contains('safe-pill')))));
  function ring() {
    if (ringEl) return ringEl;
    ringEl = document.createElement('div'); ringEl.className = 'hold-ring'; ringEl.setAttribute('aria-hidden', 'true');
    ringEl.innerHTML = '<svg viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="26"/><circle class="arc" cx="32" cy="32" r="26"/></svg>';
    document.body.append(ringEl); return ringEl;
  }
  function startHold(x, y) {
    cancelHold();
    hp = {
      x, y,
      t: setTimeout(() => { cancelHold(); u.haptic([30, 40, 30]); hide('panic'); }, HOLD_MS),
      rt: setTimeout(() => {
        const r = ring(), w = window.innerWidth;
        r.style.left = Math.max(8, Math.min(w - 72, x - 32)) + 'px'; r.style.top = Math.max(8, y - 92) + 'px';
        r.classList.remove('on'); void r.getBoundingClientRect(); r.classList.add('on'); u.haptic(5);
      }, RING_AFTER),
    };
  }
  function cancelHold() { if (hp) { clearTimeout(hp.t); clearTimeout(hp.rt); hp = null; } if (ringEl) ringEl.classList.remove('on'); }
  function moveHold(x, y) { if (hp && Math.hypot(x - hp.x, y - hp.y) > WOBBLE) cancelHold(); }

  // ---------- wiring ----------
  function bind() {
    bound = true;
    $('dc-sleep').innerHTML = u.ic('moonStar'); $('dc-go').innerHTML = u.ic('sparkles');
    $('dc-star').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.6 5.4 2 7.4 3.4 8.6 1.4 1.3 3.5 2.2 7.1 2.4-3.6.3-5.7 1.2-7.1 2.5-1.4 1.2-2.8 3.2-3.4 8.5-.6-5.3-2-7.3-3.4-8.5C7.2 13.2 5.1 12.3 1.5 12.5c3.6-.2 5.7-1.1 7.1-2.4C10 8.9 11.4 6.9 12 1.5z"/></svg>';
    const input = $('dc-input');
    input.addEventListener('input', onType);
    const planet = () => { if (sky) sky.pulse(); u.haptic(10); if (S.settings.sound) u.unlockAudio(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); planet(); onType(); } });
    $('dc-go').addEventListener('click', () => { planet(); askMotion(); onType(); });
    $('dc-sleep').addEventListener('click', () => core.lockNow());
    $('decoy').addEventListener('click', () => askMotion(), { once: true });
    $('decoy').addEventListener('pointerdown', () => { if (S.settings.sound) u.unlockAudio(); }, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoHide();
      else {
        document.body.classList.remove('privacy');
        if (state === 'decoy' && !sky) mountSky();
      }
    });
    window.addEventListener('pagehide', autoHide);
    window.addEventListener('blur', autoHide);

    // touch (phones, tablets)
    const T = { capture: true, passive: true };
    document.addEventListener('touchstart', (e) => {
      if (state !== 'chat') return;
      if (e.touches.length !== 1) { cancelHold(); return; }
      if (!inZone(e.target)) return;
      startHold(e.touches[0].clientX, e.touches[0].clientY);
    }, T);
    document.addEventListener('touchmove', (e) => { if (hp && e.touches.length) moveHold(e.touches[0].clientX, e.touches[0].clientY); }, T);
    ['touchend', 'touchcancel'].forEach((ev) => document.addEventListener(ev, cancelHold, T));
    // mouse
    document.addEventListener('pointerdown', (e) => { if (state === 'chat' && e.pointerType === 'mouse' && e.button === 0 && inZone(e.target)) startHold(e.clientX, e.clientY); }, true);
    document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') moveHold(e.clientX, e.clientY); }, true);
    document.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') cancelHold(); }, true);
    // a long press must never open the browser's own menu / text selection on the zone
    document.addEventListener('contextmenu', (e) => { if (state === 'chat' && (hp || (inZone(e.target) && !(e.target.closest && e.target.closest('.bubble'))))) e.preventDefault(); }, true);
    document.addEventListener('selectstart', (e) => { if (state === 'chat' && hp) e.preventDefault(); }, true);
  }

  MC.stealth = {
    begin, reveal, hide, hold, release, unread, askMotion, themeChanged,
    isChat: () => state === 'chat', state: () => state,
    needsMotionPermission, motionOn: () => shakeOn,
    sky: () => sky,
    holding: () => !!hp,
  };
})();
