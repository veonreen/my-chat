/* Galaxy Relax: end-to-end encryption (Web Crypto AES-GCM-256).
 *
 * The unlock code IS the shared key: Argon2id(code, appSalt + per-install random salt) -> AES-GCM key.
 * Neither the code nor any hash of it is ever sent anywhere or written to storage. The server only holds a random
 * salt and a small encrypted "check" value; a device proves the typed code is right by decrypting that value locally.
 */
(function () {
  const MC = (window.MC = window.MC || {});
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = crypto.subtle;

  const b64e = (u8) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  };
  const b64d = (s) => {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

  /** Login password is stretched in the browser (PBKDF2), so the server never sees the real password. */
  async function pwHash(username, password) {
    const base = await subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('mychat-pw-v1:' + String(username).toLowerCase()), iterations: 120000, hash: 'SHA-256' }, base, 256);
    return hex(bits);
  }

  // ---------- unlock code -> key (Argon2id) ----------
  const ARGON = { m: 65536, t: 3, p: 1 };                // 64 MiB, 3 passes, 1 lane
  const APP_SALT = enc.encode('galaxyrelax-v4:');        // fixed app salt; the per-install salt (ksalt) is appended
  let worker = null, wid = 0;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('js/kdf-worker.js');
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(new Uint8Array(e.data.out));
    };
    worker.onerror = () => { pending.forEach((p) => p.reject(new Error('kdf'))); pending.clear(); worker = null; };
    return worker;
  }
  function loadMain() {
    if (window.hashwasm) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/argon2.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
  }
  const saltFor = (ksaltHex) => { const k = unhex(ksaltHex), s = new Uint8Array(APP_SALT.length + k.length); s.set(APP_SALT, 0); s.set(k, APP_SALT.length); return s; };

  /** -> Uint8Array(32). Runs in a worker; falls back to the main thread if workers are unavailable. */
  async function kdfBytes(code, ksaltHex) {
    const salt = saltFor(ksaltHex), pw = String(code).normalize('NFKC');
    try {
      const w = getWorker(), id = ++wid;
      return await new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, code: pw, salt, m: ARGON.m, t: ARGON.t, p: ARGON.p }); });
    } catch (e) {
      await loadMain();
      return window.hashwasm.argon2id({ password: pw, salt, parallelism: ARGON.p, iterations: ARGON.t, memorySize: ARGON.m, hashLength: 32, outputType: 'binary' });
    }
  }
  /** unlock code + per-install salt -> AES-GCM key (non-extractable). */
  async function deriveKey(code, ksaltHex) {
    const bytes = await kdfBytes(code, ksaltHex);
    const key = await subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    bytes.fill(0);
    return key;
  }
  const randKsalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

  /** In-memory only: lets a re-unlock within the same page session be instant (no Argon2 again). Never persisted. */
  async function makeVerifier(code) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const h = await subtle.digest('SHA-256', new Uint8Array([...salt, ...enc.encode(String(code).normalize('NFKC'))]));
    return { salt, h: hex(h) };
  }
  async function checkVerifier(v, code) {
    if (!v) return false;
    const h = await subtle.digest('SHA-256', new Uint8Array([...v.salt, ...enc.encode(String(code).normalize('NFKC'))]));
    return hex(h) === v.h;
  }

  async function encBytes(key, u8, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const p = { name: 'AES-GCM', iv };
    if (aad) p.additionalData = enc.encode(aad);
    const ct = new Uint8Array(await subtle.encrypt(p, key, u8));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0); out.set(ct, 12);
    return out;
  }
  async function decBytes(key, u8, aad) {
    const p = { name: 'AES-GCM', iv: u8.subarray(0, 12) };
    if (aad) p.additionalData = enc.encode(aad);
    return new Uint8Array(await subtle.decrypt(p, key, u8.subarray(12)));
  }
  const encStr = async (key, str, aad) => b64e(await encBytes(key, enc.encode(str), aad));
  const decStr = async (key, b64, aad) => dec.decode(await decBytes(key, b64d(b64), aad));

  /** The small encrypted "check" value the server keeps: decrypting it proves the typed code is right. */
  const KC_TEXT = 'galaxy-relax-ok';
  const makeKc = (key) => encStr(key, KC_TEXT, 'kc');
  async function verifyKc(key, kc) {
    try { return (await decStr(key, kc, 'kc')) === KC_TEXT; } catch (e) { return false; }
  }

  // ---------- day session: the login lasts until midnight (IST) and is kept on this device, encrypted ----------
  // The token is sealed with an AES key that was generated here and can never be exported (non-extractable, kept in IndexedDB),
  // so copying the stored bytes elsewhere reveals nothing. It does NOT hold the unlock code: that is typed again after every
  // reload, so the chat itself stays closed even if somebody opens the app on an unlocked phone.
  const DAY_DB = 'mychat-day';
  const dbOpen = () => new Promise((res, rej) => { const r = indexedDB.open(DAY_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function dbRun(mode, fn) {
    const db = await dbOpen();
    try { return await new Promise((res, rej) => { const tx = db.transaction('k', mode); const out = fn(tx.objectStore('k')); tx.oncomplete = () => res(out && out.result); tx.onerror = tx.onabort = () => rej(tx.error); }); }
    finally { db.close(); }
  }
  async function saveSession(obj) {
    try {
      let key = await dbRun('readonly', (s) => s.get('wk'));
      if (!key) { key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await dbRun('readwrite', (s) => s.put(key, 'wk')); }
      const ct = await encBytes(key, enc.encode(JSON.stringify(obj)), 'day');
      await dbRun('readwrite', (s) => s.put(ct, 's'));
      return true;
    } catch (e) { return false; }                 // no IndexedDB (private window): the app simply asks for the login each time
  }
  async function loadSession() {
    try {
      const key = await dbRun('readonly', (s) => s.get('wk')), ct = await dbRun('readonly', (s) => s.get('s'));
      if (!key || !ct) return null;
      return JSON.parse(dec.decode(await decBytes(key, ct, 'day')));
    } catch (e) { return null; }
  }
  async function clearSession() { try { await dbRun('readwrite', (s) => s.clear()); } catch (e) { /* ignore */ } }

  /** Logout: remove everything this app stored on the device (only 'mychat.*' keys: github.io is shared with other projects). */
  async function wipeLocal() {
    for (const st of [localStorage, sessionStorage]) {
      try { Object.keys(st).filter((k) => k.indexOf('mychat.') === 0).forEach((k) => st.removeItem(k)); } catch (e) { /* ignore */ }
    }
    await clearSession();
    try {
      await new Promise((res) => { const r = indexedDB.deleteDatabase('mychat'); r.onsuccess = r.onerror = r.onblocked = () => res(); setTimeout(res, 1500); });
    } catch (e) { /* ignore */ }
    try {
      const reg = await navigator.serviceWorker.ready;
      (await reg.getNotifications()).forEach((n) => n.close());
    } catch (e) { /* ignore */ }
    try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) { /* ignore */ }
  }
  /** First run of v4 on a device: throw away everything the older versions stored (saved Secret Key vault, settings...). */
  function purgeLegacy() {
    try {
      if (localStorage.getItem('mychat.v4') !== '1') {
        Object.keys(localStorage).filter((k) => k.indexOf('mychat.') === 0).forEach((k) => localStorage.removeItem(k));
        localStorage.setItem('mychat.v4', '1');
      }
    } catch (e) { /* ignore */ }
    try { indexedDB.deleteDatabase('mychat'); } catch (e) { /* ignore */ }
  }

  MC.cr = { b64e, b64d, pwHash, deriveKey, randKsalt, makeVerifier, checkVerifier, encBytes, decBytes, encStr, decStr, makeKc, verifyKc, wipeLocal, purgeLegacy, saveSession, loadSession, clearSession };
})();
