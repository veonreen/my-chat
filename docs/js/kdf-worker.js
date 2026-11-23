/* Galaxy Relax: Argon2id in a Web Worker, so the screen never freezes while the unlock code is being stretched. */
importScripts('vendor/argon2.js');   // exposes the global `hashwasm` (hash-wasm, MIT)
self.onmessage = async (e) => {
  const { id, code, salt, m, t, p } = e.data;
  try {
    const out = await self.hashwasm.argon2id({ password: code, salt, parallelism: p, iterations: t, memorySize: m, hashLength: 32, outputType: 'binary' });
    self.postMessage({ id, out }, [out.buffer]);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
