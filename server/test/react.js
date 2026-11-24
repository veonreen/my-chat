// Reactions + migration test. Run: node test/react.js
// 1) An OLD database (no "reacts" column, with real-looking data) must open, keep its data, and gain the column.
// 2) react: both users see it live, removing works, deleted messages / oversize payloads are refused, sync returns it.
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const Database = require('better-sqlite3');
const { io } = require('socket.io-client');
const PORT = 3998, URL = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://veonreen.github.io';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-react-'));
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => c.repeat(64);
const http = async (body) => (await (await fetch(URL + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: ORIGIN }, body: JSON.stringify(body) })).json());
const sock = (token) => new Promise((res, rej) => {
  const s = io(URL, { auth: { token, vis: true }, transports: ['websocket'], extraHeaders: { Origin: ORIGIN }, reconnection: false });
  s.on('connect', () => res(s)); s.on('connect_error', rej);
});
const rpc = (s, action, d = {}) => new Promise((res) => s.emit('rpc', { action, ...d }, res));
const waitEv = (s, ev, pred = () => true, ms = 3000) => new Promise((res) => {
  const to = setTimeout(() => { s.off(ev, h); res(null); }, ms);
  const h = (d) => { if (pred(d)) { clearTimeout(to); s.off(ev, h); res(d); } };
  s.on(ev, h);
});

(async () => {
  // ---- old-schema DB (exactly the v2 messages table, no reacts column) ----
  const old = new Database(path.join(data, 'mychat.db'));
  old.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, ts INTEGER NOT NULL, frm TEXT NOT NULL, rcv TEXT NOT NULL, type TEXT NOT NULL,
    payload TEXT DEFAULT '', status INTEGER DEFAULT 0, dAt INTEGER DEFAULT 0, sAt INTEGER DEFAULT 0,
    edited INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, starredBy TEXT DEFAULT '', upd INTEGER DEFAULT 0,
    reply TEXT DEFAULT '', fileId TEXT DEFAULT '');`);
  old.prepare("INSERT INTO messages(id,ts,frm,rcv,type,payload,upd) VALUES('mold00000001',1,'uX','uY','text','OLD-CIPHERTEXT',1)").run();
  old.close();

  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: data }, stdio: ['ignore', 'inherit', 'inherit'] });
  await sleep(4000);

  console.log('\n[migration]');
  const chk = new Database(path.join(data, 'mychat.db'), { readonly: true });
  t('reacts column added', chk.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'reacts'));
  t('old row survived intact', chk.prepare("SELECT payload FROM messages WHERE id='mold00000001'").get().payload === 'OLD-CIPHERTEXT');
  chk.close();

  console.log('\n[reactions]');
  const A = await http({ action: 'signup', username: 'alice', password: hex('a'), proof: hex('1'), ksalt: 's', kc: 'k' });
  const B = await http({ action: 'signup', username: 'bob', password: hex('b'), proof: hex('1') });
  const sa = await sock(A.token), sb = await sock(B.token);
  const sent = await rpc(sa, 'send', { id: 'mreact000001', to: B.uid, type: 'text', payload: 'CIPHER' });
  t('message sent', sent.ok, sent);
  t('fresh message has empty reacts', sent.msg && typeof sent.msg.reacts === 'object' && !Object.keys(sent.msg.reacts).length, sent.msg);

  const evA = waitEv(sa, 'upd', (d) => d.msgs.some((m) => m.id === 'mreact000001' && m.reacts[B.uid] === 'ENC-HEART'));
  const r1 = await rpc(sb, 'react', { id: 'mreact000001', enc: 'ENC-HEART' });
  t('bob reacts', r1.ok && r1.msg.reacts[B.uid] === 'ENC-HEART', r1);
  const gotA = await evA;
  t('alice receives bob\'s reaction live', !!gotA);
  const rA = await rpc(sa, 'react', { id: 'mreact000001', enc: 'ENC-FIRE' });
  t('alice reacts too (two reactions on one message)', rA.ok && Object.keys(rA.msg.reacts).length === 2, rA);
  const sync = await rpc(sa, 'sync');
  const m = sync.msgs.find((x) => x.id === 'mreact000001');
  t('sync returns both reactions', m && m.reacts[A.uid] === 'ENC-FIRE' && m.reacts[B.uid] === 'ENC-HEART', m);
  const poll = await rpc(sb, 'poll', { since: 0 });
  t('poll (catch-up after reconnect) returns reactions', poll.msgs.some((x) => x.id === 'mreact000001' && x.reacts[A.uid]));

  const rm = await rpc(sb, 'react', { id: 'mreact000001', enc: '' });
  t('bob removes his reaction', rm.ok && !rm.msg.reacts[B.uid] && rm.msg.reacts[A.uid], rm);
  t('too-large reaction refused', (await rpc(sb, 'react', { id: 'mreact000001', enc: 'x'.repeat(401) })).error === 'too_big');
  t('unknown message refused', (await rpc(sb, 'react', { id: 'mnothere0001', enc: 'e' })).error === 'not_found');
  t('unauthenticated react refused', (await http({ action: 'react', id: 'mreact000001', enc: 'e', token: 'x'.repeat(40) })).error === 'auth');

  await rpc(sa, 'del', { id: 'mreact000001' });
  t('cannot react to a deleted message', (await rpc(sb, 'react', { id: 'mreact000001', enc: 'e' })).error === 'forbidden');

  console.log('\n[push payload]');
  // (push delivery itself is covered by test/push.js; here we only make sure the server code carries no sender/text)
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  t('push payload is the generic star text', /A new star is shining/.test(src) && !/from\.username/.test(src));

  sa.close(); sb.close(); srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
