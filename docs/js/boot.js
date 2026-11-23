/* Galaxy Relax: boot. Login / join / Galaxy Key screens, then the decoy sky (see stealth.js). */
(function () {
  const MC = window.MC;
  const { u } = MC;
  const core = MC.core;
  const $ = (id) => document.getElementById(id);
  let mode = 'login';

  function friendly(e) {
    if (!e) return 'Something went wrong';
    if (e.code === 'network') return 'Cannot reach the server. Check your internet connection.';
    if (e.code === 'no_api') return e.message;
    if (e.code === 'bad_response') return 'The server sent a bad reply. Try again in a moment.';
    if (e.code === 'rate_limited') return 'Too many tries. Please wait a little and try again.';
    return e.message || 'Something went wrong';
  }
  function showErr(id, msg) { const n = $(id); n.textContent = msg; n.classList.remove('hidden'); }
  function hideErr(id) { $(id).classList.add('hidden'); }
  function busy(btn, on) { btn.classList.toggle('loading', on); btn.disabled = on; }

  // ---------- Login / Join ----------
  function setMode(m) {
    mode = m;
    $('tab-login').classList.toggle('on', m === 'login');
    $('tab-signup').classList.toggle('on', m === 'signup');
    $('tab-ink').style.transform = m === 'login' ? 'translateX(0)' : 'translateX(100%)';
    document.querySelectorAll('#auth .su').forEach((n) => n.classList.toggle('hidden', m !== 'signup'));
    $('auth-title').textContent = m === 'login' ? 'Welcome back, explorer' : 'Join the galaxy';
    $('auth-sub').textContent = m === 'login' ? 'Log in with your username and password.' : 'Create your explorer. You both use the same Galaxy Key.';
    $('auth-submit').firstChild.textContent = m === 'login' ? 'Log in' : 'Join';
    $('f-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    hideErr('auth-err');
  }

  async function enter() {
    MC.showScreen('splash');
    try {
      await core.startApp();                      // ends on the decoy sky, never on the private area
    } catch (e) {
      if (e.code === 'auth') return core.forceLogout('Your session has ended. Please log in again.');
      $('neterr-msg').textContent = friendly(e);
      MC.showScreen('neterr');
    }
  }
  function showKey() {
    MC.showScreen('keyscreen');
    hideErr('key-err'); $('k-secret').value = '';
    setTimeout(() => $('k-secret').focus(), 100);
  }

  function bindAuth() {
    $('pw-eye').innerHTML = u.ic('eye');
    $('key-ic').innerHTML = u.ic('key');
    $('neterr-ic').innerHTML = u.ic('wifiOff');
    $('hint-ic').innerHTML = u.ic('lock');
    $('foot-ic').innerHTML = u.ic('sparkles');
    $('tab-login').addEventListener('click', () => setMode('login'));
    $('tab-signup').addEventListener('click', () => setMode('signup'));
    $('pw-eye').addEventListener('click', () => {
      const p = $('f-pass'); const show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      $('pw-eye').innerHTML = u.ic(show ? 'eyeOff' : 'eye');
    });

    $('auth-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      hideErr('auth-err');
      const username = $('f-user').value.trim().toLowerCase();
      const password = $('f-pass').value;
      const name = $('f-name').value.trim();
      const secret = $('f-secret').value;
      if (!username || !password) return showErr('auth-err', 'Enter your username and password');
      if (mode === 'signup') {
        if (!/^[a-z0-9_.]{3,20}$/.test(username)) return showErr('auth-err', 'Username: 3 to 20 characters, a-z, 0-9, _ or .');
        if (password.length < 6) return showErr('auth-err', 'The password needs at least 6 characters');
        if (!name) return showErr('auth-err', 'Enter your explorer name');
        if (secret.length < 6) return showErr('auth-err', 'The Galaxy Key needs at least 6 characters');
      }
      const btn = $('auth-submit');
      busy(btn, true);
      try {
        MC.u.unlockAudio();
        MC.stealth.askMotion();                   // iPhone asks once for motion access (used for shake to hide)
        const st = mode === 'login' ? await core.login(username, password) : await core.signup({ username, password, name, secret });
        if (st === 'need_key') showKey(); else await enter();
      } catch (e) {
        showErr('auth-err', friendly(e));
      } finally { busy(btn, false); }
    });

    $('key-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      hideErr('key-err');
      const secret = $('k-secret').value;
      if (!secret) return showErr('key-err', 'Enter the Galaxy Key');
      const btn = $('key-submit');
      busy(btn, true);
      try {
        await core.unlock(secret, $('k-remember').checked);
        await enter();
      } catch (e) { showErr('key-err', friendly(e)); }
      finally { busy(btn, false); }
    });
    $('key-logout').addEventListener('click', () => core.logout());

    $('neterr-retry').addEventListener('click', async () => {
      const b = $('neterr-retry'); busy(b, true);
      try { await boot(true); } finally { busy(b, false); }
    });
  }

  async function boot(isRetry) {
    core.applyTheme();
    MC.cr.purgeLegacy();            // remove the old token/key format from earlier versions
    let flash = null;
    try { flash = sessionStorage.getItem('mychat.flash'); sessionStorage.removeItem('mychat.flash'); } catch (e) { /* ignore */ }
    if (flash) { setMode('login'); showErr('auth-err', flash); }
    const t0 = Date.now();
    let st = 'none';
    try { st = await core.restore(); } catch (e) { st = 'none'; }
    const wait = Math.max(0, 450 - (Date.now() - t0));
    if (!isRetry) await u.sleep(wait);
    if (st === 'none') { if (!flash) setMode('login'); MC.showScreen('auth'); }
    else if (st === 'need_key') showKey();
    else await enter();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // while the login screen is idle, prepare the 3D planets so the sky shows up smoothly afterwards
  window.addEventListener('load', () => setTimeout(() => { try { if (window.Galaxy) window.Galaxy.prewarm(); } catch (e) { /* ignore */ } }, 900));
  bindAuth();
  setMode('login');
  boot();
})();
