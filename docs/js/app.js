/* MyChat — core logic: state, auth, E2EE data flow, realtime (Socket.io), sending */
(function () {
  const MC = window.MC;
  const { u, api } = MC;
  const C = MC.cr;

  const LS = (MC.LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  });

  const S = (MC.S = {
    uid: '', me: null, users: new Map(), key: null, ksalt: '', kc: '',
    msgs: new Map(),          // peerUid -> [message] (sorted by ts)
    byId: new Map(),          // msgId -> message
    current: null,            // open chat peer uid
    since: 0, pv: '', peers: {}, more: {}, running: false, vapid: '', pushOn: false,
    settings: Object.assign({ theme: 'system', sound: true, notif: true }, LS.get('mychat.settings', {})),
    replyTo: null, editing: null, drafts: {}, searchQ: '', typingAt: 0,
  });

  const EDIT_WINDOW = 15 * 60 * 1000;
  const MAX_FILE = 6 * 1024 * 1024;

  // ================= Theme / settings =================
  const resolvedTheme = () => {
    const t = S.settings.theme;
    if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t;
  };
  function applyTheme() {
    const r = resolvedTheme();
    document.documentElement.dataset.theme = r;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = r === 'dark' ? '#202c33' : '#f0f2f5';
    document.documentElement.style.setProperty('--doodle', r === 'dark' ? u.doodle('#ffffff', 0.05) : u.doodle('#5b5340', 0.1));
  }
  const saveSettings = () => LS.set('mychat.settings', S.settings);
  function setTheme(t) {
    S.settings.theme = t; saveSettings(); applyTheme();
    if (MC.ui && MC.ui.themeChanged) MC.ui.themeChanged();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });

  // ================= Helpers =================
  const peerOf = (m) => (m.from === S.uid ? m.to : m.from);
  const isActive = () => !document.hidden && document.hasFocus();
  const lastMsg = (peer) => { const a = S.msgs.get(peer); return a && a.length ? a[a.length - 1] : null; };
  const unreadCount = (peer) => {
    let n = 0;
    for (const m of S.msgs.get(peer) || []) if (m.to === S.uid && m.status < 2 && !m._seenLocal && !m.deleted) n++;
    return n;
  };
  const totalUnread = () => { let n = 0; for (const p of S.msgs.keys()) n += unreadCount(p); return n; };
  const canEdit = (m) => m.from === S.uid && m.type === 'text' && !m.deleted && !m.pending && !m.failed && Date.now() - m.ts < EDIT_WINDOW;
  const sortAll = () => { for (const a of S.msgs.values()) a.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1)); };
  const nextTs = (peer) => { const l = lastMsg(peer); return Math.max(Date.now(), l ? l.ts + 1 : 0); };
  const nameOf = (uid) => { const x = S.users.get(uid); return x ? x.name : 'User'; };

  function preview(m) {
    if (!m) return '';
    if (m.deleted) return m.from === S.uid ? 'You deleted this message' : 'This message was deleted';
    if (!m.dec) return '🔒 Encrypted message';
    if (m.type === 'image') return '📷 ' + (m.t || 'Photo');
    if (m.type === 'file') return m.f && m.f.v ? '🎤 Voice message' : '📄 ' + (m.f ? m.f.n : 'Document');
    return m.t;
  }

  function updateTitle() {
    const n = totalUnread();
    document.title = n ? `(${n}) MyChat` : 'MyChat';
    try { if (navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) { /* ignore */ }
  }
  function refreshUI() {
    if (!MC.ui || !MC.ui.ready) return;
    MC.ui.renderSidebar();
    MC.ui.chatChanged();
    MC.ui.updateStatus();
    updateTitle();
  }

  // ================= Decrypt =================
  async function decField(s, aad) {
    if (!s) return '';
    try { return await C.decStr(S.key, s, aad); } catch (e) { return ''; }
  }
  async function decUser(raw) {
    return {
      uid: raw.uid, username: raw.username,
      name: (await decField(raw.nameEnc, raw.uid + ':name')) || raw.username,
      about: (await decField(raw.aboutEnc, raw.uid + ':about')) || '',
      photo: await decField(raw.photoEnc, raw.uid + ':photo'),
      lastSeen: raw.lastSeen, profUpd: raw.profUpd,
    };
  }
  async function setUsers(list) {
    const out = new Map();
    for (const raw of list) { const x = await decUser(raw); out.set(x.uid, x); }
    S.users = out;
    if (out.has(S.uid)) S.me = out.get(S.uid);
  }
  async function decodePayload(m) {
    if (m.deleted || !m._pl) { m.t = ''; m.rp = null; m.f = null; m.dec = true; return; }
    try {
      const o = JSON.parse(await C.decStr(S.key, m._pl, m.id));
      m.t = o.t || ''; m.rp = o.rp || null; m.f = o.f || null; m.dec = true;
    } catch (e) { m.t = ''; m.rp = null; m.f = null; m.dec = false; }
  }
  async function mergeMsgs(list) {
    const added = [];
    await Promise.all(list.map(async (sm) => {
      let m = S.byId.get(sm.id);
      const isNew = !m;
      if (!m) { m = {}; S.byId.set(sm.id, m); }
      const same = m._pl === sm.payload && m.dec !== undefined;
      Object.assign(m, sm, { pending: false, failed: false, uploading: false });
      if (!same) { m._pl = sm.payload; await decodePayload(m); }
      if (isNew) {
        const peer = peerOf(m);
        if (!S.msgs.has(peer)) S.msgs.set(peer, []);
        S.msgs.get(peer).push(m);
        added.push(m);
      }
    }));
    sortAll();
    return added;
  }

  // ================= Auth + App Lock =================
  // - Session token SIRF memory me (api.token). localStorage/IndexedDB me nahi => tab band = login dobara.
  // - Secret Key login-password se encrypted "vault" me (crypto.js). Login par password se khulta hai.
  // - Lock  = memory saaf (page reload), vault bacha rehta hai, push subscription bachi rehti hai.
  // - Logout = vault + sab local data + push subscription sab hata do.
  const LOCK_AFTER_MS = 60 * 1000;
  let pendingPw = null;      // Secret Key screen par vault banane ke liye password (kaam ke baad turant hata dete hain)

  async function afterAuth(r, o) {
    api.token = r.token;
    S.uid = r.uid; S.ksalt = r.ksalt; S.kc = r.kc;
    S.me = await decUserSafe(r.me);
    const username = r.me.username;
    let key = o.key || null;
    if (!key) {
      const secret = await C.vaultOpen(username, o.password);          // password se vault kholo
      if (secret) {
        const k = await C.deriveKey(secret, r.ksalt);
        if (await C.verifyKc(k, r.kc)) key = k; else C.vaultClear();   // purani/galat vault
      }
    } else if (o.secret) {
      await C.vaultSave(username, o.password, o.secret);               // signup: turant vault bana do
    }
    if (!key) { pendingPw = o.password; return 'need_key'; }
    S.key = key;
    return 'ok';
  }
  async function decUserSafe(raw) { return { uid: raw.uid, username: raw.username, name: raw.username, about: '', photo: '' }; }

  async function login(username, password) {
    const r = await api.call('login', { username, password: await C.pwHash(username, password), ua: navigator.userAgent.slice(0, 100) });
    return afterAuth(r, { password });
  }

  async function signup({ username, password, name, secret }) {
    if (secret.length < 6) throw new api.ApiError('weak_key', 'Secret Key kam se kam 6 characters ki rakho');
    const cfg = await api.call('config');
    if (cfg.full) throw new api.ApiError('full', 'Ye private chat hai, 2 users already hain');
    const proof = await C.proof(secret);
    let key = null, ksalt, kc;
    if (!cfg.hasWorkspace) {          // pehla user => workspace + key-check banao
      ksalt = C.randSalt();
      key = await C.deriveKey(secret, ksalt);
      kc = await C.makeKc(key);
    }
    const r = await api.call('signup', { username, password: await C.pwHash(username, password), proof, ksalt, kc, ua: navigator.userAgent.slice(0, 100) });
    if (!key) {
      key = await C.deriveKey(secret, r.ksalt);
      if (!(await C.verifyKc(key, r.kc))) throw new api.ApiError('wrong_key', 'Secret Key galat hai');
    }
    const st = await afterAuth(r, { key, secret, password });
    if (name) { try { await saveProfile({ name }); } catch (e) { /* baad me profile se set kar sakte */ } }
    return st;
  }

  /** Vault nahi mila => Secret Key haath se daali. remember=true => password se encrypt karke vault me rakho. */
  async function unlock(secret, remember) {
    const key = await C.deriveKey(secret, S.ksalt);
    if (!(await C.verifyKc(key, S.kc))) throw new api.ApiError('wrong_key', 'Secret Key galat hai');
    S.key = key;
    if (remember && pendingPw) await C.vaultSave(S.me.username, pendingPw, secret); else if (!remember) C.vaultClear();
    pendingPw = null;
  }

  /** Sirf "Retry" (net error) ke liye: memory me login ho chuka ho to wahi se aage badho. Disk se kabhi restore nahi. */
  async function restore() {
    if (api.token && S.uid && S.key) return 'ok';
    if (api.token && S.uid) return 'need_key';
    return 'none';
  }

  const flash = (msg) => { try { if (msg) sessionStorage.setItem('mychat.flash', msg); } catch (e) { /* ignore */ } };
  let locking = false;
  /** App lock: memory saaf (reload), server par session invalid par push subscription RAHEGI => notifications chalte rahenge. */
  function lock(msg, opts) {
    if (locking) return; locking = true;
    S.running = false;
    if (api.token && !(opts && opts.skipServer)) api.beacon('logout', { keepPush: true });
    api.disconnect(); api.token = null; pendingPw = null;
    flash(msg || 'App lock ho gaya. Dobara login karo.');
    location.reload();
  }
  const lockNow = () => lock('App lock ho gaya. Unlock karne ke liye login karo.');
  const forceLogout = (msg) => lock(msg || 'Session expire ho gaya. Dobara login karo.', { skipServer: true });

  /** Poora logout: push band, server session delete, vault/key/settings sab local data saaf. */
  async function logout() {
    S.running = false;
    try { await dropPush(); } catch (e) { /* ignore */ }
    try { await api.call('logout', {}, { timeout: 6000 }); } catch (e) { /* ignore */ }
    api.disconnect(); api.token = null; pendingPw = null;
    await C.wipeLocal();
    location.reload();
  }
  /** Settings: "Secret Key dobara daalo" => vault hatao aur lock karo (agle login par Secret Key poochega). */
  function forgetKey() { C.vaultClear(); lock('Secret Key hata di. Login karke dobara daalo.'); }

  // ---- Auto-lock: background 1 min+ / sleep / app band ----
  let hiddenAt = 0, lockTimer = null, lastTick = Date.now();
  const LOCK_MSG = 'App 1 minute se zyada background me tha, isliye lock ho gaya. Dobara login karo.';
  function checkLock() { if (S.running && hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_MS) lock(LOCK_MSG); }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(lockTimer);
    document.body.classList.toggle('privacy', document.hidden);          // app-switcher me chat blur
    if (document.hidden) { hiddenAt = Date.now(); lockTimer = setTimeout(checkLock, LOCK_AFTER_MS + 300); }
    else { checkLock(); hiddenAt = 0; }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkLock(); });
  setInterval(() => {                                                    // laptop sleep / frozen tab detect
    const n = Date.now();
    if (S.running && n - lastTick > LOCK_AFTER_MS + 5000) lock(LOCK_MSG);
    lastTick = n;
  }, 5000);

  // ================= Sync & realtime (Socket.io) =================
  // Ab polling nahi: server naya message / tick / typing / online turant PUSH karta hai.
  async function fullSync() {
    const r = await api.call('sync', {}, { timeout: 40000 });
    S.pv = r.pv; S.peers = r.peers || {}; S.vapid = r.vapid || S.vapid;
    await setUsers(r.users);
    S.msgs.clear(); S.byId.clear();
    await mergeMsgs(r.msgs);
    S.since = r.maxUpd || 0;
    for (const p of S.users.keys()) if (p !== S.uid) S.more[p] = (S.msgs.get(p) || []).length >= 1;
  }

  const bumpSince = (msgs) => { for (const m of msgs) if (m.upd > S.since) S.since = m.upd; };
  const typingTimers = {};
  let seenBusy = false;

  /** Is chat me jo messages mere liye aaye hain aur "seen" nahi => server ko batao (blue ticks). */
  function autoSeen() {
    if (!S.running || !S.current || !isActive() || seenBusy) return;
    const peer = S.current;
    if (!(S.msgs.get(peer) || []).some((m) => m.to === S.uid && m.status < 2 && !m.deleted)) return;
    seenBusy = true;
    api.call('seen', { peer }, { timeout: 15000 })
      .then((r) => mergeMsgs(r.msgs || []).then(() => { bumpSince(r.msgs || []); refreshUI(); }))
      .catch(() => {})
      .finally(() => { seenBusy = false; });
  }

  /** Reconnect ke baad: jo miss hua wo lao. */
  async function catchUp() {
    if (!S.running) return;
    try {
      const r = await api.call('poll', { since: S.since }, { timeout: 25000 });
      if (r.peers) S.peers = mergePeers(r.peers);
      if (r.pv && r.pv !== S.pv) { S.pv = r.pv; refreshUsers(); }
      if (r.msgs && r.msgs.length) {
        const added = await mergeMsgs(r.msgs);
        bumpSince(r.msgs);
        notifyIncoming(added);
      }
      refreshUI(); autoSeen();
    } catch (e) { if (e.code === 'auth') forceLogout('Session expire ho gaya. Dobara login karo.'); }
  }

  function mergePeers(inc) {
    const out = Object.assign({}, S.peers);
    for (const k of Object.keys(inc)) out[k] = Object.assign({}, out[k], inc[k], { typingTo: out[k] && out[k].typingTo });
    return out;
  }
  function sendVis() { if (S.running) api.call('vis', { vis: !document.hidden }, { timeout: 8000 }).catch(() => {}); }

  let bound = false;
  function bindRealtime() {
    if (bound) return; bound = true;
    api.on('upd', async (d) => {
      if (!S.running || !d || !d.msgs) return;
      const added = await mergeMsgs(d.msgs);
      bumpSince(d.msgs);
      for (const m of added) if (m.from !== S.uid && S.peers[m.from]) { S.peers[m.from].typingTo = ''; clearTimeout(typingTimers[m.from]); }
      notifyIncoming(added);
      refreshUI(); autoSeen();
    });
    api.on('peers', (d) => { if (!S.running) return; S.peers = mergePeers(d); if (MC.ui) { MC.ui.updateStatus(); MC.ui.presenceChanged(); } });
    api.on('typing', (d) => {
      if (!S.running || !d || !d.from) return;
      S.peers[d.from] = Object.assign({}, S.peers[d.from], { typingTo: S.uid });
      clearTimeout(typingTimers[d.from]);
      typingTimers[d.from] = setTimeout(() => { if (S.peers[d.from]) S.peers[d.from].typingTo = ''; if (MC.ui) { MC.ui.updateStatus(); MC.ui.presenceChanged(); } }, 4500);
      if (MC.ui) { MC.ui.updateStatus(); MC.ui.presenceChanged(); }
    });
    api.on('pv', (d) => { if (S.running && d && d.pv !== S.pv) { S.pv = d.pv; refreshUsers(); } });
    api.on('state', (ok) => { if (MC.ui && MC.ui.setConn) MC.ui.setConn(ok); });
    api.on('reconnected', () => { catchUp(); });
    api.on('autherr', () => forceLogout('Session expire ho gaya. Dobara login karo.'));
  }
  function pollNow() { autoSeen(); if (S.running && !api.connected && api.socket) api.socket.connect(); }
  async function refreshUsers() {
    try {
      const r = await api.call('users');
      await setUsers(r.users); S.pv = r.pv;
      if (MC.ui) { MC.ui.profileChanged(); refreshUI(); }
    } catch (e) { /* next time */ }
  }

  // ================= Notifications =================
  async function askNotif() {
    if (!('Notification' in window)) return 'unsupported';
    let r = Notification.permission;
    if (r !== 'granted') { try { r = await Notification.requestPermission(); } catch (e) { r = 'denied'; } }
    if (r === 'granted') setupPush();
    return r;
  }

  // ---- Web Push (VAPID): app band ho tab bhi notification ----
  const b64u8 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function setupPush() {
    try {
      if (!S.vapid || !S.settings.notif || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const want = b64u8(S.vapid);
      const have = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (sub && have && (have.length !== want.length || have.some((v, i) => v !== want[i]))) { await sub.unsubscribe(); sub = null; }  // server key badli
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
      await api.call('pushsub', { sub: sub.toJSON() });
      S.pushOn = true;
    } catch (e) { S.pushOn = false; }
  }
  async function dropPush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.call('pushunsub', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      S.pushOn = false;
    } catch (e) { /* ignore */ }
  }
  function notifyIncoming(added) {
    const inc = added.filter((m) => m.to === S.uid && !m.deleted);
    if (!inc.length) return;
    const last = inc[inc.length - 1];
    const active = isActive() && S.current === last.from;
    if (S.settings.sound) u.beep('in');
    if (!active && S.settings.notif && !(S.pushOn && document.hidden) && 'Notification' in window && Notification.permission === 'granted') {
      const title = nameOf(last.from);
      const body = (inc.length > 1 ? `${inc.length} new messages · ` : '') + preview(last);
      const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'chat-' + last.from, renotify: true, data: { peer: last.from } };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => {});
      } else {
        try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); MC.ui.openChat(last.from); n.close(); }; } catch (e) { /* ignore */ }
      }
    }
  }
  // Notification click: app unlock hai to chat kholo, locked hai to login ke baad kholo
  let pendingPeer = null;
  try {
    const q = new URLSearchParams(location.search).get('peer');
    if (q) { pendingPeer = q; history.replaceState(null, '', location.pathname); }
  } catch (e) { /* ignore */ }
  const openPending = () => { if (pendingPeer && MC.ui && MC.ui.ready && S.users.has(pendingPeer)) { MC.ui.openChat(pendingPeer); pendingPeer = null; } };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-chat') { pendingPeer = e.data.peer; openPending(); }
    });
  }

  // ================= Sending =================
  let queue = Promise.resolve();
  function enqueue(m) {
    m.pending = true; m.failed = false;
    queue = queue.then(() => m._send()).catch(() => {});
  }
  function attachReply(m) {
    if (S.replyTo) {
      const r = S.replyTo;
      m.rp = { id: r.id, s: preview(r).slice(0, 120), u: r.from };
      m.reply = r.id;
      MC.core.clearReply();
    } else { m.rp = null; m.reply = ''; }
  }
  function newLocal(type, peer, extra) {
    return Object.assign({
      id: u.mid(), ts: nextTs(peer), from: S.uid, to: peer, type, status: -1, pending: true, failed: false,
      t: '', rp: null, f: null, edited: 0, deleted: 0, starred: 0, upd: 0, reply: '', fileId: '', dec: true, _pl: '__local',
    }, extra || {});
  }
  function addLocal(m) {
    S.byId.set(m.id, m);
    if (!S.msgs.has(m.to)) S.msgs.set(m.to, []);
    S.msgs.get(m.to).push(m);
    if (S.settings.sound) u.beep('out');
    MC.ui.localAdded(m);
    refreshUI();
  }
  async function transmit(m) {
    const payload = await C.encStr(S.key, JSON.stringify({ t: m.t, rp: m.rp || undefined, f: m.f || undefined }), m.id);
    const r = await api.call('send', { id: m.id, to: m.to, type: m.type, payload, replyId: m.reply || '', fileId: m.fileId || '' }, { timeout: 40000 });
    Object.assign(m, r.msg, { pending: false, failed: false, uploading: false });
    m._pl = r.msg.payload; m.dec = true;
    S.since = Math.max(S.since, r.msg.upd || 0);
    sortAll();
    MC.ui.msgChanged(m);
    refreshUI();
  }
  function failed(m, e) {
    m.failed = true; m.pending = false; m.uploading = false;
    if (e && e.code === 'auth') return forceLogout('Session expire ho gaya. Dobara login karo.');
    MC.ui.msgChanged(m);
    if (e && e.code && e.code !== 'network') u.toast(e.message);
  }

  function sendText(text) {
    text = (text || '').trim();
    if (!text || !S.current) return false;
    if (S.editing) { editMsg(S.editing, text); return true; }
    if (text.length > 4000) { u.toast('Message bahut lamba hai (max 4000 characters)'); return false; }
    const m = newLocal('text', S.current, { t: text });
    attachReply(m);
    m._send = async () => { try { await transmit(m); } catch (e) { failed(m, e); } };
    addLocal(m); enqueue(m);
    return true;
  }

  // ----- image / file helpers -----
  async function gz(bytes, mode) {
    const s = mode === 'z' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
    const w = s.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(s.readable).arrayBuffer());
  }
  async function loadBitmap(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ } }
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
      img.src = url;
    });
  }
  const toBlob = (cv, type, q) => new Promise((res) => cv.toBlob(res, type, q));
  async function prepImage(file) {
    const bmp = await loadBitmap(file);
    let w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const MAX = 1280, sc = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(bmp, 0, 0, cw, ch);
    const blob = await toBlob(cv, 'image/jpeg', 0.72);
    const tc = document.createElement('canvas'); const ts = 20 / Math.max(cw, ch);
    tc.width = Math.max(1, Math.round(cw * ts)); tc.height = Math.max(1, Math.round(ch * ts));
    tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
    return { blob, w: cw, h: ch, th: tc.toDataURL('image/jpeg', 0.5) };
  }

  function queueFile(file, caption, extra) {
    const peer = S.current;
    const isImg = /^image\/(jpeg|png|webp|gif|bmp)/.test(file.type) && !(extra && extra.v);
    const m = newLocal(isImg ? 'image' : 'file', peer, {
      t: caption || '', uploading: true,
      f: Object.assign({ n: file.name || 'file', s: file.size, m: file.type || 'application/octet-stream' }, extra || {}),
    });
    attachReply(m);
    m._blob = URL.createObjectURL(file);        // sender ko turant preview
    m._send = async () => {
      try {
        m.uploading = true; m.pending = true; MC.ui.msgChanged(m);
        if (!m.fileId) {
          let bytes;
          if (isImg) {
            const p = await prepImage(file);
            bytes = new Uint8Array(await p.blob.arrayBuffer());
            Object.assign(m.f, { m: 'image/jpeg', w: p.w, h: p.h, th: p.th, s: bytes.length });
            const old = m._blob; m._blob = URL.createObjectURL(p.blob); URL.revokeObjectURL(old);
          } else {
            bytes = new Uint8Array(await file.arrayBuffer());
            if (!m.f.v && typeof CompressionStream !== 'undefined') {
              try { const z = await gz(bytes, 'z'); if (z.length < bytes.length * 0.95) { bytes = z; m.f.z = 1; } } catch (e) { /* send raw */ }
            }
          }
          if (bytes.length > MAX_FILE) { const e = new api.ApiError('too_big', 'File 6 MB se badi hai'); throw e; }
          const ct = await C.encBytes(S.key, bytes);
          const up = await api.call('upload', { data: C.b64e(ct) }, { timeout: 120000 });
          m.fileId = up.fileId;
        }
        await transmit(m);
      } catch (e) { failed(m, e); }
    };
    addLocal(m); enqueue(m);
  }
  function sendFiles(files, caption) {
    if (!S.current) return;
    files = Array.from(files);
    files.forEach((f, i) => {
      if (f.size > 25 * 1024 * 1024) { u.toast(`"${f.name}" bahut badi hai (max 6 MB)`); return; }
      queueFile(f, i === 0 ? caption : '');
    });
  }

  // ----- voice notes -----
  const rec = { mr: null, chunks: [], t0: 0, stream: null, mime: '' };
  async function recStart() {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Is browser me voice recording support nahi hai');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.chunks = []; rec.stream = stream; rec.mr = mr; rec.t0 = Date.now(); rec.mime = mr.mimeType || mime || 'audio/webm';
    mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    mr.start();
  }
  function recStop(send) {
    return new Promise((resolve) => {
      const mr = rec.mr;
      if (!mr) return resolve();
      mr.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        const dur = (Date.now() - rec.t0) / 1000;
        const type = rec.mime.split(';')[0];
        const blob = new Blob(rec.chunks, { type });
        rec.mr = null;
        if (send && dur > 0.7 && S.current) {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          queueFile(new File([blob], 'Voice message.' + ext, { type }), '', { v: 1, d: Math.round(dur) });
        }
        resolve();
      };
      try { mr.stop(); } catch (e) { resolve(); }
    });
  }

  // ================= Edit / Delete / Star =================
  async function editMsg(m, text) {
    try {
      const payload = await C.encStr(S.key, JSON.stringify({ t: text, rp: m.rp || undefined, f: m.f || undefined }), m.id);
      const r = await api.call('edit', { id: m.id, payload });
      await mergeMsgs([r.msg]); S.since = Math.max(S.since, r.msg.upd);
      MC.core.clearEdit(); refreshUI();
    } catch (e) { u.toast(e.message || 'Edit nahi ho paya'); }
  }
  async function deleteMsg(m) {
    try {
      const r = await api.call('del', { id: m.id });
      await mergeMsgs([r.msg]); S.since = Math.max(S.since, r.msg.upd);
      refreshUI();
    } catch (e) { u.toast(e.message || 'Delete nahi ho paya'); }
  }
  async function starMsg(m, on) {
    m.starred = on ? 1 : 0; MC.ui.msgChanged(m);
    try { const r = await api.call('star', { id: m.id, on: on ? 1 : 0 }); S.since = Math.max(S.since, r.msg.upd); }
    catch (e) { m.starred = on ? 0 : 1; MC.ui.msgChanged(m); u.toast('Star nahi ho paya'); }
  }
  async function loadOlder(peer) {
    const arr = (S.msgs.get(peer) || []).filter((m) => !m.pending && !m.failed);
    const before = arr.length ? arr[0].ts : Date.now() + 1;
    const r = await api.call('history', { peer, before, limit: 50 });
    S.more[peer] = !!r.more;
    if (r.msgs.length) await mergeMsgs(r.msgs);
    return r.msgs.length;
  }

  // ================= Profile =================
  async function saveProfile(p) {
    const body = {};
    if (p.name !== undefined) body.nameEnc = await C.encStr(S.key, p.name, S.uid + ':name');
    if (p.about !== undefined) body.aboutEnc = await C.encStr(S.key, p.about, S.uid + ':about');
    if (p.photo !== undefined) body.photoEnc = p.photo ? await C.encStr(S.key, p.photo, S.uid + ':photo') : '';
    const r = await api.call('profile', body);
    S.pv = r.pv;
    const mine = S.me || { uid: S.uid, username: '' };
    if (p.name !== undefined) mine.name = p.name || mine.username;
    if (p.about !== undefined) mine.about = p.about;
    if (p.photo !== undefined) mine.photo = p.photo;
    S.me = mine; S.users.set(S.uid, mine);
    if (MC.ui && MC.ui.ready) { MC.ui.profileChanged(); refreshUI(); }
  }

  // ================= Files (download / view) =================
  const fileCache = new Map();
  function getFileUrl(m) {
    if (m._blob) return Promise.resolve(m._blob);
    if (!m.fileId || !m.f) return Promise.reject(new Error('no file'));
    if (fileCache.has(m.fileId)) return fileCache.get(m.fileId);
    const p = (async () => {
      const r = await api.call('file', { fileId: m.fileId }, { timeout: 90000 });
      let bytes = await C.decBytes(S.key, C.b64d(r.data));
      if (m.f.z) bytes = await gz(bytes, 'u');
      return URL.createObjectURL(new Blob([bytes], { type: m.f.m || 'application/octet-stream' }));
    })();
    fileCache.set(m.fileId, p);
    p.catch(() => fileCache.delete(m.fileId));
    return p;
  }
  async function downloadFile(m) {
    try {
      const url = await getFileUrl(m);
      const a = document.createElement('a');
      a.href = url; a.download = (m.f && m.f.n) || 'file'; document.body.append(a); a.click(); a.remove();
    } catch (e) { u.toast('File download nahi ho payi'); }
  }

  // ================= Misc UI-state helpers =================
  function clearReply() { S.replyTo = null; if (MC.ui && MC.ui.ready) MC.ui.renderReplyBar(); }
  function clearEdit() { S.editing = null; if (MC.ui && MC.ui.ready) MC.ui.renderReplyBar(); }
  function markTyping() {
    const now = Date.now();
    if (!S.current || now - S.typingAt < 2200) return;
    S.typingAt = now;
    api.call('typing', { to: S.current }, { timeout: 8000 }).catch(() => {});
  }
  async function startApp() {
    bindRealtime();
    await api.connect();            // WebSocket (token galat ho to ApiError 'auth')
    await fullSync();
    S.running = true;
    MC.ui.start();
    try { history.replaceState(history.state, '', location.pathname + location.search + '#u'); } catch (e) { /* ignore */ }   // SW ko pata chale: app unlocked
    MC.ui.setConn(true);
    updateTitle();
    catchUp();                      // sync ke dauran aaye events na chhute
    setupPush();
    openPending();
  }
  function retry(m) { if (m.failed && m._send) { enqueue(m); MC.ui.msgChanged(m); } }

  document.addEventListener('visibilitychange', () => { sendVis(); if (!document.hidden) pollNow(); });
  window.addEventListener('focus', () => { sendVis(); pollNow(); });
  window.addEventListener('online', () => { if (S.running && api.socket && !api.connected) api.socket.connect(); });
  window.addEventListener('pointerdown', u.unlockAudio, { once: true });
  window.addEventListener('keydown', u.unlockAudio, { once: true });

  MC.core = {
    applyTheme, setTheme, saveSettings, resolvedTheme,
    login, signup, unlock, restore, logout, forceLogout, lockNow, forgetKey, startApp, afterAuth,
    sendText, sendFiles, recStart, recStop, retry, editMsg, deleteMsg, starMsg, loadOlder, saveProfile,
    getFileUrl, downloadFile, preview, unreadCount, totalUnread, lastMsg, canEdit, nameOf, peerOf,
    clearReply, clearEdit, markTyping, pollNow, askNotif, setupPush, dropPush, refreshUI, isActive, updateTitle, mergeMsgs,
  };
})();
