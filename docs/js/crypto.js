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

  // ---- Key ko is device (IndexedDB) me rakhna: non-extractable CryptoKey ----
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mychat', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('keys');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveKey(id, key, ksalt) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put({ key, ksalt }, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* private mode etc. */ }
  }
  async function loadKey(id, ksalt) {
    try {
      const db = await idb();
      const v = await new Promise((res, rej) => {
        const rq = db.transaction('keys').objectStore('keys').get(id);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      return v && v.ksalt === ksalt ? v.key : null;
    } catch (e) { return null; }
  }
  async function delKey(id) {
    try {
      const db = await idb();
      await new Promise((res) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch (e) { /* ignore */ }
  }

  MC.cr = { b64e, b64d, deriveKey, proof, randSalt, encBytes, decBytes, encStr, decStr, makeKc, verifyKc, saveKey, loadKey, delKey };
})();
