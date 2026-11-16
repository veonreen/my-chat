/* MyChat — End-to-End Encryption (Web Crypto: PBKDF2 -> AES-GCM-256)
 * Secret Key kabhi server ko nahi jaati. Server ko sirf encrypted bytes milte hain.
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

  const baseKey = (secret) =>
    subtle.importKey('raw', enc.encode(String(secret).normalize('NFKC')), 'PBKDF2', false, ['deriveKey', 'deriveBits']);

  /** Secret Key + workspace salt -> AES-GCM key (non-extractable). */
  async function deriveKey(secret, saltB64) {
    const base = await baseKey(secret);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: b64d(saltB64), iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** Alag derivation: server ko sirf iska hash milta hai (2nd user ko sahi key wale ko hi allow karne ke liye). */
  async function proof(secret) {
    const base = await baseKey(secret);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('mychat-proof-v1'), iterations: 150000, hash: 'SHA-256' }, base, 256);
    return hex(bits);
  }

  /** Password ko browser me stretch karo (PBKDF2). Server ko asli password kabhi nahi milta. */
  async function pwHash(username, password) {
    const base = await baseKey(password);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('mychat-pw-v1:' + String(username).toLowerCase()), iterations: 120000, hash: 'SHA-256' }, base, 256);
    return hex(bits);
  }

  const randSalt = () => b64e(crypto.getRandomValues(new Uint8Array(16)));

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

  const KC_TEXT = 'mychat-ok';
  const makeKc = (key) => encStr(key, KC_TEXT, 'kc');
  async function verifyKc(key, kc) {
    try { return (await decStr(key, kc, 'kc')) === KC_TEXT; } catch (e) { return false; }
  }

  // ---- Secret Key "vault": Secret Key ko LOGIN PASSWORD se encrypt karke is device par rakhna ----
  // PBKDF2(password, random salt) -> AES-GCM key -> encrypt(Secret Key). Password ke bina vault khulta nahi.
  // Server ko vault ya password ka koi hissa nahi milta (server ka password-hash alag salt/purpose se bana hai).
  const VAULT = 'mychat.vault';
  const vaultAad = (username) => 'mychat-vault-v1:' + String(username).toLowerCase();
  const vaultKey = async (password, salt, iter) =>
    subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, await baseKey(password), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

  async function vaultSave(username, password, secret) {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 250000;
      const ct = await encBytes(await vaultKey(password, salt, iter), enc.encode(String(secret)), vaultAad(username));
      localStorage.setItem(VAULT, JSON.stringify({ v: 1, u: String(username).toLowerCase(), s: b64e(salt), i: iter, d: b64e(ct) }));
      return true;
    } catch (e) { return false; }
  }
  /** Sahi password + sahi username ho to Secret Key (string) wapas, warna null. */
  async function vaultOpen(username, password) {
    try {
      const v = JSON.parse(localStorage.getItem(VAULT) || 'null');
      if (!v || v.v !== 1 || v.u !== String(username).toLowerCase()) return null;
      const iter = Math.min(1000000, Math.max(100000, Number(v.i) || 250000));
      return dec.decode(await decBytes(await vaultKey(password, b64d(v.s), iter), b64d(v.d), vaultAad(username)));
    } catch (e) { return null; }
  }
  /** Vault kis username ka hai ('' agar vault nahi). */
  const vaultUser = () => { try { const v = JSON.parse(localStorage.getItem(VAULT) || 'null'); return v && v.v === 1 ? v.u : ''; } catch (e) { return ''; } };
  /**
   * Password badalte waqt: purane password se vault kholo, naye password se (naye salt ke saath) dobara encrypt karo.
   * Naya vault STRING lautata hai (abhi store nahi karta: server ne password badal diya tab vaultStore karo).
   * Vault nahi ho ya khul na sake to null.
   */
  async function vaultRewrap(username, oldPassword, newPassword) {
    const secret = await vaultOpen(username, oldPassword);
    if (secret == null) return null;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 250000;
    const ct = await encBytes(await vaultKey(newPassword, salt, iter), enc.encode(secret), vaultAad(username));
    return JSON.stringify({ v: 1, u: String(username).toLowerCase(), s: b64e(salt), i: iter, d: b64e(ct) });
  }
  const vaultStore = (json) => { try { localStorage.setItem(VAULT, json); return true; } catch (e) { return false; } };
  const vaultClear = () => { try { localStorage.removeItem(VAULT); } catch (e) { /* ignore */ } };
  const hasVault = () => { try { return !!localStorage.getItem(VAULT); } catch (e) { return false; } };

  /** Logout par: is app ka sara local data hatao (sirf 'mychat.*' keys: github.io origin dusre projects ke saath shared hota hai). */
  async function wipeLocal() {
    for (const st of [localStorage, sessionStorage]) {
      try { Object.keys(st).filter((k) => k.indexOf('mychat.') === 0).forEach((k) => st.removeItem(k)); } catch (e) { /* ignore */ }
    }
    try {
      await new Promise((res) => { const r = indexedDB.deleteDatabase('mychat'); r.onsuccess = r.onerror = r.onblocked = () => res(); setTimeout(res, 1500); });
    } catch (e) { /* ignore */ }
    try {
      const reg = await navigator.serviceWorker.ready;
      (await reg.getNotifications()).forEach((n) => n.close());
    } catch (e) { /* ignore */ }
    try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) { /* ignore */ }
  }
  /** Purane version (v2.0) ne session token localStorage me aur key IndexedDB me bina password ke rakhi thi: hatao. */
  function purgeLegacy() {
    try { localStorage.removeItem('mychat.session'); localStorage.removeItem('mychat.remember'); localStorage.removeItem('mychat.flash'); } catch (e) { /* ignore */ }
    try { indexedDB.deleteDatabase('mychat'); } catch (e) { /* ignore */ }
  }

  MC.cr = { b64e, b64d, deriveKey, proof, pwHash, randSalt, encBytes, decBytes, encStr, decStr, makeKc, verifyKc, vaultSave, vaultOpen, vaultRewrap, vaultStore, vaultUser, vaultClear, hasVault, wipeLocal, purgeLegacy };
})();
