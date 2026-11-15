/* MyChat — boot: login / signup / key screens, start app */
(function () {
  const MC = window.MC;
  const { u } = MC;
  const core = MC.core;
  const LS = MC.LS;
  const $ = (id) => document.getElementById(id);
  let mode = 'login';

  function friendly(e) {
    if (!e) return 'Kuch gadbad ho gayi';
    if (e.code === 'network') return 'Server se connect nahi ho pa raha. Internet check karo.';
    if (e.code === 'no_api') return e.message;
    if (e.code === 'bad_response') return 'Server ne galat jawab diya. Backend deploy (Anyone access) check karo.';
    return e.message || 'Kuch gadbad ho gayi';
  }
  function showErr(id, msg) { const n = $(id); n.textContent = msg; n.classList.remove('hidden'); }
  function hideErr(id) { $(id).classList.add('hidden'); }
  function busy(btn, on) { btn.classList.toggle('loading', on); btn.disabled = on; }

  // ---------- Login / Signup ----------
  function setMode(m) {
    mode = m;
    $('tab-login').classList.toggle('on', m === 'login');
    $('tab-signup').classList.toggle('on', m === 'signup');
    $('tab-ink').style.transform = m === 'login' ? 'translateX(0)' : 'translateX(100%)';
    document.querySelectorAll('#auth .su').forEach((n) => n.classList.toggle('hidden', m !== 'signup'));
    $('auth-title').textContent = m === 'login' ? 'Welcome back' : 'Create account';
    $('auth-sub').textContent = m === 'login' ? 'Apne username aur password se login karo.' : 'Naya account banao. Dono users same Secret Key use karenge.';
    $('auth-submit').firstChild.textContent = m === 'login' ? 'Login' : 'Sign up';
    $('f-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    hideErr('auth-err');
  }

  async function enter() {
    MC.showScreen('splash');
    try {
      await core.startApp();
    } catch (e) {
      if (e.code === 'auth') return core.forceLogout('Session expire ho gaya. Dobara login karo.');
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
      if (!username || !password) return showErr('auth-err', 'Username aur password dono bharo');
      if (mode === 'signup') {
        if (!/^[a-z0-9_.]{3,20}$/.test(username)) return showErr('auth-err', 'Username 3-20 characters: a-z, 0-9, _ ya .');
        if (password.length < 6) return showErr('auth-err', 'Password kam se kam 6 characters ka rakho');
        if (!name) return showErr('auth-err', 'Apna display name daalo');
        if (secret.length < 6) return showErr('auth-err', 'Secret Key kam se kam 6 characters ki rakho');
      }
      const btn = $('auth-submit');
      busy(btn, true);
      try {
        MC.u.unlockAudio();
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
      if (!secret) return showErr('key-err', 'Secret Key daalo');
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
    const flash = LS.get('mychat.flash', null);
    if (flash) { LS.del('mychat.flash'); setMode('login'); showErr('auth-err', flash); }
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
  bindAuth();
  setMode('login');
  boot();
})();
