// Web Push test: mock "push service" (browser vendor jaisa) banao, Bob ko offline rakho, Alice message bheje
// => server ko VAPID-signed + encrypted push mock endpoint par POST karna chahiye. Visible bob => push nahi.
const { spawn } = require('child_process');
const https = require('https'), path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { io } = require('socket.io-client');
const PORT = 3998, URL = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://veonreen.github.io';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-push-'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 300)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => c.repeat(64);
const b64u = (b) => Buffer.from(b).toString('base64url');
const post = async (body) => (await (await fetch(URL + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json());
const sock = (token, vis) => new Promise((res, rej) => { const s = io(URL, { auth: { token, vis }, transports: ['websocket'], reconnection: false }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const rpc = (s, action, d = {}) => new Promise((r) => s.emit('rpc', { action, ...d }, r));

(async () => {
  const hits = [];
  const { execSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-tls-'));
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout ' + tmp + '/k.pem -out ' + tmp + '/c.pem -days 1 -subj /CN=127.0.0.1', { stdio: 'ignore' });
  const mock = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { hits.push({ url: req.url, h: req.headers, len: Buffer.concat(chunks).length }); res.statusCode = req.url.includes('gone') ? 410 : 201; res.end(); });
  }).listen(0);
  const mport = mock.address().port;
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: data, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(1500);

  const A = await post({ action: 'signup', username: 'alice', password: hex('a'), proof: hex('1'), ksalt: 's', kc: 'k' });
  const B = await post({ action: 'signup', username: 'bob', password: hex('b'), proof: hex('1') });
  const sa = await sock(A.token, true);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const sub = { endpoint: `https://127.0.0.1:${mport}/push/abc`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
  // Bob ek baar connect hokar subscribe kare, phir tab band
  let sb = await sock(B.token, true);
  t('bob subscribes to push', (await rpc(sb, 'pushsub', { sub })).ok);
  sb.disconnect(); await sleep(300);

  console.log('[bob offline => push sent]');
  await rpc(sa, 'send', { id: 'mpush000001', to: B.uid, type: 'text', payload: 'SECRET-CIPHERTEXT' });
  await sleep(800);
  t('mock push service received 1 POST', hits.length === 1, hits.length);
  const h = hits[0] || { h: {}, len: 0 };
  t('request is VAPID-signed', /^vapid t=[A-Za-z0-9_.-]+, ?k=[A-Za-z0-9_-]+$/.test(h.h.authorization || ''), h.h.authorization);
  t('payload is encrypted (aes128gcm) and non-empty', h.h['content-encoding'] === 'aes128gcm' && h.len > 50, h.h['content-encoding']);
  t('urgency/TTL headers set', h.h.urgency === 'high' && +h.h.ttl > 0, h.h);
  t('ciphertext/message text never leaves in push', !JSON.stringify(h).includes('SECRET'));

  console.log('[bob visible => no push]');
  hits.length = 0;
  sb = await sock(B.token, true); await sleep(300);
  await rpc(sa, 'send', { id: 'mpush000002', to: B.uid, type: 'text', payload: 'X2' });
  await sleep(600);
  t('no push while bob is visible/online', hits.length === 0, hits.length);

  console.log('[bob hidden tab => push]');
  await rpc(sb, 'vis', { vis: false }); await sleep(200);
  await rpc(sa, 'send', { id: 'mpush000003', to: B.uid, type: 'text', payload: 'X3' });
  await sleep(600);
  t('push sent when bob tab is hidden (even though socket is open)', hits.length === 1, hits.length);

  console.log('[dead subscription cleanup]');
  const gone = { endpoint: `https://127.0.0.1:${mport}/push/gone`, keys: sub.keys };
  await rpc(sb, 'pushsub', { sub: gone });
  sb.disconnect(); await sleep(300);
  await rpc(sa, 'send', { id: 'mpush000004', to: B.uid, type: 'text', payload: 'X4' });
  await sleep(800);
  const Db = require('better-sqlite3')(path.join(data, 'mychat.db'), { readonly: true });
  const left = Db.prepare('SELECT endpoint FROM push_subs').all().map((r) => r.endpoint);
  Db.close();
  t('410 Gone subscription auto-removed, good one kept', left.length === 1 && left[0].endsWith('/abc'), left);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  sa.disconnect(); srv.kill(); mock.close(); await sleep(300);
  try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
