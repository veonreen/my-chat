// Local test: server ko 2 users ke saath asli socket.io clients se chalata hai
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const { io } = require('socket.io-client');
const PORT = 3999, URL = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://veonreen.github.io';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => c.repeat(64);
async function http(body, origin = ORIGIN) {
  const r = await fetch(URL + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body: JSON.stringify(body) });
  return { status: r.status, h: r.headers, j: await r.json() };
}
const sock = (token, vis = true) => new Promise((res, rej) => {
  const s = io(URL, { auth: { token, vis }, transports: ['websocket'], extraHeaders: { Origin: ORIGIN }, reconnection: false });
  s.on('connect', () => res(s)); s.on('connect_error', (e) => rej(e));
});
const rpc = (s, action, data = {}) => new Promise((res) => s.emit('rpc', { action, ...data }, res));
const waitEv = (s, ev, pred = () => true, ms = 3000) => new Promise((res) => {
  const to = setTimeout(() => { s.off(ev, h); res(null); }, ms);
  const h = (d) => { if (pred(d)) { clearTimeout(to); s.off(ev, h); res(d); } };
  s.on(ev, h);
});

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(4000);

  console.log('\n[auth]');
  let r = (await http({ action: 'config' })).j;
  t('config: no key yet, vapid key present', r.ok && r.hasKey === false && r.vapid && r.vapid.length > 60, r);
  const A = (await http({ action: 'signup', username: 'Alice', password: hex('a'), proof: hex('1'), ksalt: 'salt1', kc: 'kc1' })).j;
  t('alice signup', A.ok && A.token && A.uid, A);
  const B = (await http({ action: 'signup', username: 'bob', password: hex('b'), proof: hex('1') })).j;
  t('signup needs no secret key; key info is empty until the first unlock', B.ok && B.kver === 0 && !B.kc && !B.ksalt, B);
  t('3rd user blocked (full)', (await http({ action: 'signup', username: 'carol', password: hex('c'), proof: hex('1') })).j.error === 'full');
  t('bad login rejected', (await http({ action: 'login', username: 'alice', password: hex('z') })).j.error === 'bad_login');
  const L = (await http({ action: 'login', username: 'alice', password: hex('a') })).j;
  t('good login', L.ok && L.token, L);
  t('no token => auth error over HTTP', (await http({ action: 'sync' })).j.error === 'auth');
  t('unknown action', (await http({ action: 'nope', token: A.token })).j.error === 'unknown_action');
  const pe = await http({ action: 'config' }, 'https://evil.example');
  t('CORS: evil origin gets no allow header', !pe.h.get('access-control-allow-origin'));
  const po = await http({ action: 'config' });
  t('CORS: pages origin allowed', po.h.get('access-control-allow-origin') === ORIGIN);
  let bad = null; try { await sock('x'.repeat(64)); } catch (e) { bad = e; }
  t('socket with bad token refused', bad && /auth/.test(bad.message), bad && bad.message);

  console.log('\n[realtime]');
  const sa = await sock(A.token), sb = await sock(B.token);
  t('both sockets connect', sa.connected && sb.connected);
  const mid = 'm' + Date.now().toString(36) + 'abcd1';
  const gotB = waitEv(sb, 'upd', (d) => d.msgs.some((m) => m.id === mid));
  const t0 = Date.now();
  const s1 = await rpc(sa, 'send', { id: mid, to: B.uid, type: 'text', payload: 'CIPHERTEXT==' });
  const dB = await gotB; const delay = Date.now() - t0;
  t('send ack ok, status delivered (bob online) = 1', s1.ok && s1.msg.status === 1, s1);
  t('bob receives it via push (no polling) ' + delay + 'ms', !!dB && dB.msgs[0].payload === 'CIPHERTEXT==' && delay < 300, { dB, delay });
  const typ = waitEv(sb, 'typing');
  await rpc(sa, 'typing', { to: B.uid });
  t('typing event reaches bob', ((await typ) || {}).from === A.uid);
  const seenEv = waitEv(sa, 'upd', (d) => d.msgs.some((m) => m.id === mid && m.status === 2));
  const sn = await rpc(sb, 'seen', { peer: A.uid });
  t('seen => alice gets blue tick event', !!(await seenEv) && sn.msgs.length === 1, sn);
  const ed = waitEv(sb, 'upd', (d) => d.msgs.some((m) => m.edited));
  const e1 = await rpc(sa, 'edit', { id: mid, payload: 'EDITED==' });
  t('edit ok + bob notified', e1.ok && e1.msg.edited === 1 && !!(await ed));
  t('bob cannot edit alice message', (await rpc(sb, 'edit', { id: mid, payload: 'x' })).error === 'forbidden');
  const st = await rpc(sb, 'star', { id: mid, on: 1 });
  t('star is per-user', st.msg.starred === 1 && (await rpc(sa, 'history', { peer: B.uid })).msgs[0].starred === 0);
  t('duplicate send id = no dup', (await rpc(sa, 'send', { id: mid, to: B.uid, type: 'text', payload: 'again' })).dup === true);
  t('send to self refused', (await rpc(sa, 'send', { id: 'mself12345', to: A.uid, type: 'text', payload: 'x' })).error === 'bad_to');

  console.log('\n[presence / offline delivery]');
  const offEv = waitEv(sa, 'peers', (d) => d[B.uid] && d[B.uid].online === false);
  sb.disconnect();
  const off = await offEv;
  t('bob goes offline => alice gets presence', !!off && off[B.uid].lastSeen > 0, off);
  const mid2 = 'm' + Date.now().toString(36) + 'abcd2';
  const s2 = await rpc(sa, 'send', { id: mid2, to: B.uid, type: 'text', payload: 'WHILEOFFLINE==' });
  t('send while bob offline => status 0 (sent)', s2.ok && s2.msg.status === 0, s2);
  const dlv = waitEv(sa, 'upd', (d) => d.msgs.some((m) => m.id === mid2 && m.status === 1));
  const sb2 = await sock(B.token);
  t('bob reconnects => delivered tick pushed to alice', !!(await dlv));
  const pl = await rpc(sb2, 'poll', { since: 0 });
  t('catch-up poll returns missed msg', pl.ok && pl.msgs.some((m) => m.id === mid2));
  const bPeers = (await rpc(sb2, 'sync')).peers;
  t('sync has peers (alice online)', bPeers[A.uid] && bPeers[A.uid].online === true);

  console.log('\n[files]');
  const bytes = Buffer.alloc(300000, 7).toString('base64');
  const up = await rpc(sa, 'upload', { data: bytes });
  t('upload ok', up.ok && up.fileId, up);
  const mid3 = 'm' + Date.now().toString(36) + 'abcd3';
  const fm = await rpc(sa, 'send', { id: mid3, to: B.uid, type: 'file', payload: 'FILEMETA==', fileId: up.fileId });
  t('file message linked', fm.ok && fm.msg.fileId === up.fileId, fm);
  const dl = await rpc(sb2, 'file', { fileId: up.fileId });
  t('bob downloads identical bytes', dl.ok && dl.data === bytes);
  t('reuse of linked file id refused', (await rpc(sa, 'send', { id: 'mreuse12345', to: B.uid, type: 'file', payload: 'x', fileId: up.fileId })).error === 'bad_file');
  const delEv = waitEv(sb2, 'upd', (d) => d.msgs.some((m) => m.deleted));
  const dm = await rpc(sa, 'del', { id: mid3 });
  t('delete for everyone + bob notified', dm.ok && dm.msg.deleted === 1 && dm.msg.payload === '' && !!(await delEv));
  t('file gone after delete', (await rpc(sb2, 'file', { fileId: up.fileId })).error === 'not_found');
  await sleep(200);
  const filesLeft = fs.readdirSync(path.join(data, 'files'));
  t('file removed from disk', filesLeft.length === 0, filesLeft);

  console.log('\n[profile / push]');
  const pvEv = waitEv(sb2, 'pv');
  const pr = await rpc(sa, 'profile', { nameEnc: 'ENCNAME==' });
  t('profile update notifies peer', pr.ok && !!(await pvEv));
  t('users shows nameEnc', (await rpc(sb2, 'users')).users.find((u) => u.uid === A.uid).nameEnc === 'ENCNAME==');
  t('pushsub accepted', (await rpc(sa, 'pushsub', { sub: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } } })).ok);
  t('bad pushsub rejected', (await rpc(sa, 'pushsub', { sub: { endpoint: 'x' } })).error === 'bad_sub');

  console.log('\n[history]');
  for (let i = 0; i < 5; i++) await rpc(sa, 'send', { id: 'mh' + i + 'aaaaaaaaa', to: B.uid, type: 'text', payload: 'H' + i });
  const h1 = await rpc(sa, 'history', { peer: B.uid, limit: 3, before: 9e15 });
  t('history pagination (limit 3, more=true)', h1.msgs.length === 3 && h1.more === true);
  const h2 = await rpc(sa, 'history', { peer: B.uid, limit: 50, before: h1.msgs[0].ts });
  t('older page has the rest', h2.msgs.length >= 3 && h2.msgs.every((m) => m.ts < h1.msgs[0].ts));

  console.log('\n[security / rate limit]');
  let locked = false;
  for (let i = 0; i < 10; i++) { const x = (await http({ action: 'login', username: 'bob', password: hex('q') })).j; if (x.error === 'locked') locked = true; }
  t('username lockout after repeated bad logins', locked);
  t('locked user cannot login even with right password', (await http({ action: 'login', username: 'bob', password: hex('b') })).j.error === 'locked');
  let limited = false;
  for (let i = 0; i < 70; i++) { const x = await http({ action: 'config' }); if (x.status === 429) { limited = true; break; } }
  t('IP rate-limit (429) on config flood', limited);
  console.log('\n[app lock: sessions + push]');
  const DB = require('better-sqlite3');
  const rd = (sql, ...a) => { const d = DB(path.join(data, 'mychat.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const subsOf = () => rd('SELECT endpoint FROM push_subs WHERE uid=?', A.uid).length;
  t('alice has a push subscription before lock', subsOf() === 1, subsOf());
  const L2 = (await http({ action: 'login', username: 'alice', password: hex('a') })).j;
  const lk = (await http({ action: 'logout', token: L2.token, keepPush: true })).j;
  t('LOCK (logout keepPush): session invalid, push subscription KEPT', lk.ok && (await http({ action: 'sync', token: L2.token })).j.error === 'auth' && subsOf() === 1, subsOf());
  for (let i = 0; i < 4; i++) await http({ action: 'login', username: 'alice', password: hex('a') });
  const nSess = rd('SELECT COUNT(*) c FROM sessions WHERE uid=?', A.uid)[0].c;
  t('orphan sessions capped at 5 per user (' + nSess + ')', nSess <= 5, nSess);
  const L3 = (await http({ action: 'login', username: 'alice', password: hex('a') })).j;
  const lo = (await http({ action: 'logout', token: L3.token })).j;
  t('full LOGOUT removes push subscription too', lo.ok && subsOf() === 0, subsOf());
  t('logout invalidates token', (await http({ action: 'sync', token: L3.token })).j.error === 'auth');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  [sa, sb2].forEach((s) => s.disconnect());
  srv.kill(); await sleep(300);
  try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* windows file lock */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
