// v5: a login lasts until the next midnight IST. Run: node test/session.js
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const Database = require('better-sqlite3');
const PORT = 3994, URL = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://veonreen.github.io';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-sess-'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => c.repeat(64);
const post = async (b) => (await (await fetch(URL + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: ORIGIN }, body: JSON.stringify(b) })).json());
const IST = 5.5 * 3600000, nextIstMidnight = (now) => Math.floor((now + IST) / 86400000) * 86400000 + 86400000 - IST;

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: data }, stdio: ['ignore', 'inherit', 'inherit'] });
  await sleep(5000);
  const before = Date.now();
  const A = await post({ action: 'signup', username: 'alice', password: hex('a') });
  const after = Date.now();
  t('signup returns the session end', A.ok && typeof A.exp === 'number', A);
  t('session ends at the next midnight IST', A.exp === nextIstMidnight(before) || A.exp === nextIstMidnight(after), { exp: new Date(A.exp).toISOString() });
  t('...which is less than 24 hours away and in the future', A.exp > after && A.exp - after <= 86400000, A.exp - after);
  t('the end falls exactly on 00:00 IST', ((A.exp + IST) % 86400000) === 0);
  const L = await post({ action: 'login', username: 'alice', password: hex('a') });
  t('login returns the same kind of end', L.ok && L.exp === A.exp && L.token !== A.token, L);
  t('a fresh token works', (await post({ action: 'users', token: L.token })).ok);

  // time travel: pretend midnight has passed for this session
  const db = new Database(path.join(data, 'mychat.db'));
  db.prepare('UPDATE sessions SET expires=? WHERE tokenHash=?').run(Date.now() - 1000, crypto.createHash('sha256').update(L.token).digest('hex'));
  db.close();
  t('after midnight the old token is refused', (await post({ action: 'users', token: L.token })).error === 'auth');
  t('another session of the same day is untouched', (await post({ action: 'users', token: A.token })).ok);
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
