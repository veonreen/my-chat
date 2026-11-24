// Change-password + session revocation tests (fresh server, temp DB)
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const { io } = require('socket.io-client');
const PORT = 3997, URL = `http://127.0.0.1:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-chpw-'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 250)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => c.repeat(64);
const post = async (body) => (await (await fetch(URL + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json());
const sock = (token) => new Promise((res, rej) => { const s = io(URL, { auth: { token, vis: true }, transports: ['websocket'], reconnection: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const rpc = (s, action, d = {}) => new Promise((r) => s.emit('rpc', { action, ...d }, r));

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(4000);

  const A = await post({ action: 'signup', username: 'alice', password: hex('a'), proof: hex('1'), ksalt: 's', kc: 'k' });
  const B = await post({ action: 'signup', username: 'bob', password: hex('b'), proof: hex('1') });
  const A2 = await post({ action: 'login', username: 'alice', password: hex('a') });      // alice ka "dusra device"
  const sa1 = await sock(A.token), sa2 = await sock(A2.token);
  await rpc(sa1, 'pushsub', { sub: { endpoint: 'https://push.example/alice', keys: { p256dh: 'p', auth: 'a' } } });

  console.log('[validation]');
  t('wrong current password rejected', (await rpc(sa1, 'chpw', { oldPassword: hex('d'), newPassword: hex('c') })).error === 'bad_password');
  t('same password rejected', (await rpc(sa1, 'chpw', { oldPassword: hex('a'), newPassword: hex('a') })).error === 'same_password');
  t('bad format rejected', (await rpc(sa1, 'chpw', { oldPassword: 'abc', newPassword: hex('c') })).error === 'bad_password');
  t('needs a valid session (no token over HTTP)', (await post({ action: 'chpw', oldPassword: hex('a'), newPassword: hex('c') })).error === 'auth');
  t('failed attempts did NOT change the password', (await post({ action: 'login', username: 'alice', password: hex('a') })).ok === true);

  console.log('[success + other device revoked]');
  const rev = new Promise((res) => { sa2.on('revoked', () => res(true)); setTimeout(() => res(false), 3000); });
  const disc = new Promise((res) => { sa2.on('disconnect', () => res(true)); setTimeout(() => res(false), 3000); });
  const ok = await rpc(sa1, 'chpw', { oldPassword: hex('a'), newPassword: hex('c') });
  t('password changed', ok.ok === true, ok);
  t('other device socket got "revoked" and was disconnected', (await rev) && (await disc));
  t('other device token is dead (HTTP)', (await post({ action: 'sync', token: A2.token })).error === 'auth');
  t('this device stays logged in', (await rpc(sa1, 'sync')).ok === true);
  t('old password no longer logs in', (await post({ action: 'login', username: 'alice', password: hex('a') })).error === 'bad_login');
  const L = await post({ action: 'login', username: 'alice', password: hex('c') });
  t('new password logs in', L.ok === true, L);
  t('push subscription kept after password change', (await (async () => { const D = require('better-sqlite3')(path.join(data, 'mychat.db'), { readonly: true }); const n = D.prepare('SELECT COUNT(*) c FROM push_subs WHERE uid=?').get(A.uid).c; D.close(); return n; })()) === 1);

  console.log('[revocation applies to already-open sockets]');
  const sl = await sock(L.token);
  t('socket works before logout', (await rpc(sl, 'sync')).ok === true);
  await post({ action: 'logout', token: L.token, keepPush: true });
  t('same socket is refused AFTER its session is deleted', (await rpc(sl, 'sync')).error === 'auth');

  console.log('[brute force on chpw]');
  const sb = await sock(B.token);
  let locked = false;
  for (let i = 0; i < 10; i++) { const r = await rpc(sb, 'chpw', { oldPassword: hex('d'), newPassword: hex('c') }); if (r.error === 'locked') locked = true; }
  t('repeated wrong current-password => lockout', locked);
  t('locked even with the right current password', (await rpc(sb, 'chpw', { oldPassword: hex('b'), newPassword: hex('c') })).error === 'locked');
  t('lockout also blocks login for that user', (await post({ action: 'login', username: 'bob', password: hex('b') })).error === 'locked');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  srv.kill(); await sleep(300);
  try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
