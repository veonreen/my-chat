'use strict';
/**
 * Galaxy Relax (MyChat) v5 — realtime backend (Express + Socket.io + SQLite)
 * ------------------------------------------------------------
 * - Server SIRF ciphertext dekhta hai. Secret Key / AES key kabhi yahan nahi aati.
 * - Actions purane Apps Script backend jaise hi hain (send, edit, del, history ...),
 *   bas ab WebSocket par chalte hain aur server events PUSH karta hai (polling nahi).
 * - Files: encrypted bytes disk par (DATA_DIR/files).
 * - Web Push (VAPID): app band ho tab bhi notification (payload me koi message text nahi).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const webpush = require('web-push');
const rateLimit = require('express-rate-limit');

// ====== CONFIG ======
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://veonreen.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_USERS = Number(process.env.MAX_USERS) || 2;
// v5: a login lasts until the next midnight in India (IST = UTC+5:30), then the person logs in again.
const IST_MS = 5.5 * 3600000;
const sessionEnd = (now) => Math.floor((now + IST_MS) / 86400000) * 86400000 + 86400000 - IST_MS;
const MAX_SESSIONS = 5;                 // ek user ke max itne active session (naye aane par sabse purane hat'te hain)
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_UPLOAD_B64 = 9000000;
const MAX_PAYLOAD = 45000;
const LOGIN_MAX_FAILS = 8, LOGIN_LOCK_MS = 10 * 60 * 1000;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:veonreen@gmail.com';

fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

// ====== DB ======
const db = new Database(path.join(DATA_DIR, 'mychat.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL,
  nameEnc TEXT DEFAULT '', aboutEnc TEXT DEFAULT '', photoEnc TEXT DEFAULT '',
  created INTEGER, lastSeen INTEGER, profUpd INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, frm TEXT NOT NULL, rcv TEXT NOT NULL, type TEXT NOT NULL,
  payload TEXT DEFAULT '', status INTEGER DEFAULT 0, dAt INTEGER DEFAULT 0, sAt INTEGER DEFAULT 0,
  edited INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, starredBy TEXT DEFAULT '', upd INTEGER DEFAULT 0,
  reply TEXT DEFAULT '', fileId TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(frm, rcv, ts);
CREATE INDEX IF NOT EXISTS idx_msg_rcv_status ON messages(rcv, status);
CREATE INDEX IF NOT EXISTS idx_msg_upd ON messages(upd);
CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER, expires INTEGER, ua TEXT);
CREATE TABLE IF NOT EXISTS files (fileId TEXT PRIMARY KEY, msgId TEXT DEFAULT '', frm TEXT, rcv TEXT DEFAULT '', size INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, uid TEXT NOT NULL, p256dh TEXT, auth TEXT, created INTEGER);
`);
// v3: emoji reactions. reacts = JSON {uid: encryptedEmoji}. Server never sees the emoji (E2EE).
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'reacts')) db.exec("ALTER TABLE messages ADD COLUMN reacts TEXT DEFAULT ''");

const q = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key=?'),
  setMeta: db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  userByName: db.prepare('SELECT * FROM users WHERE username=?'),
  userById: db.prepare('SELECT * FROM users WHERE uid=?'),
  allUsers: db.prepare('SELECT * FROM users ORDER BY created'),
  countUsers: db.prepare('SELECT COUNT(*) c FROM users'),
  insUser: db.prepare('INSERT INTO users(uid,username,salt,hash,created,lastSeen,profUpd) VALUES(?,?,?,?,?,?,?)'),
  setSeen: db.prepare('UPDATE users SET lastSeen=? WHERE uid=?'),
  insSession: db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE tokenHash=?'),
  delSession: db.prepare('DELETE FROM sessions WHERE tokenHash=?'),
  msgById: db.prepare('SELECT * FROM messages WHERE id=?'),
  insMsg: db.prepare(`INSERT INTO messages(id,ts,frm,rcv,type,payload,status,dAt,sAt,edited,deleted,starredBy,upd,reply,fileId)
                      VALUES(@id,@ts,@frm,@rcv,@type,@payload,@status,@dAt,0,0,0,'',@upd,@reply,@fileId)`),
  recent: db.prepare(`SELECT * FROM (SELECT * FROM messages WHERE frm=@u OR rcv=@u ORDER BY ts DESC, id DESC LIMIT @n) ORDER BY ts, id`),
  since: db.prepare('SELECT * FROM messages WHERE (frm=@u OR rcv=@u) AND upd>=@s ORDER BY upd LIMIT 500'),
  hist: db.prepare(`SELECT * FROM messages WHERE ((frm=@u AND rcv=@p) OR (frm=@p AND rcv=@u)) AND ts<@b ORDER BY ts DESC, id DESC LIMIT @l`),
  maxUpd: db.prepare('SELECT COALESCE(MAX(upd),0) m FROM messages WHERE frm=@u OR rcv=@u'),
  delivered: db.prepare(`UPDATE messages SET status=1, dAt=@now, upd=@upd WHERE rcv=@u AND status<1 AND deleted=0 RETURNING *`),
  seen: db.prepare(`UPDATE messages SET status=2, sAt=@now, dAt=CASE WHEN dAt=0 THEN @now ELSE dAt END, upd=@upd
                    WHERE frm=@p AND rcv=@u AND status<2 AND deleted=0 RETURNING *`),
  editMsg: db.prepare('UPDATE messages SET payload=?, edited=1, upd=? WHERE id=?'),
  delMsg: db.prepare("UPDATE messages SET payload='', deleted=1, upd=? WHERE id=?"),
  starMsg: db.prepare('UPDATE messages SET starredBy=?, upd=? WHERE id=?'),
  reactMsg: db.prepare('UPDATE messages SET reacts=?, upd=? WHERE id=?'),
  allMsgs: db.prepare('SELECT id, payload, reacts, deleted FROM messages'),
  rekeyMsg: db.prepare('UPDATE messages SET payload=?, reacts=?, upd=? WHERE id=?'),
  setEnc: db.prepare('UPDATE users SET nameEnc=?, aboutEnc=?, photoEnc=?, profUpd=? WHERE uid=?'),
  allFiles: db.prepare('SELECT fileId FROM files'),
  fileById: db.prepare('SELECT * FROM files WHERE fileId=?'),
  insFile: db.prepare('INSERT INTO files(fileId,msgId,frm,rcv,size,ts) VALUES(?,?,?,?,?,?)'),
  linkFile: db.prepare('UPDATE files SET msgId=?, rcv=? WHERE fileId=?'),
  delFile: db.prepare('DELETE FROM files WHERE fileId=?'),
  setProfile: db.prepare('UPDATE users SET nameEnc=COALESCE(@nameEnc,nameEnc), aboutEnc=COALESCE(@aboutEnc,aboutEnc), photoEnc=COALESCE(@photoEnc,photoEnc), profUpd=@now WHERE uid=@uid'),
  subUpsert: db.prepare('INSERT INTO push_subs(endpoint,uid,p256dh,auth,created) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET uid=excluded.uid,p256dh=excluded.p256dh,auth=excluded.auth'),
  subsOf: db.prepare('SELECT * FROM push_subs WHERE uid=?'),
  subDel: db.prepare('DELETE FROM push_subs WHERE endpoint=?'),
  subDelUid: db.prepare('DELETE FROM push_subs WHERE uid=?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires<?'),
  setPw: db.prepare('UPDATE users SET salt=?, hash=? WHERE uid=?'),
  delOtherSessions: db.prepare('DELETE FROM sessions WHERE uid=? AND tokenHash<>?'),
  trimSessions: db.prepare('DELETE FROM sessions WHERE uid=? AND tokenHash NOT IN (SELECT tokenHash FROM sessions WHERE uid=? ORDER BY created DESC LIMIT ?)'),
};

// ====== VAPID (Web Push keys; ek baar ban ke DB me rehti hain) ======
function getVapid() {
  const pub = q.getMeta.get('vapidPublic'), prv = q.getMeta.get('vapidPrivate');
  if (pub && prv) return { publicKey: pub.value, privateKey: prv.value };
  const k = webpush.generateVAPIDKeys();
  q.setMeta.run('vapidPublic', k.publicKey); q.setMeta.run('vapidPrivate', k.privateKey);
  return k;
}
const VAPID = getVapid();
webpush.setVapidDetails(VAPID_SUBJECT, VAPID.publicKey, VAPID.privateKey);

// ====== SMALL HELPERS ======
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rnd = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString('hex')))));
class E extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
let lastUpd = 0;
const nextUpd = () => (lastUpd = Math.max(Date.now(), lastUpd + 1));
const normUser = (u) => String(u || '').trim().toLowerCase();
const timingEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function parseReacts(s) { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function msgOut(r, uid) {
  return {
    id: r.id, ts: r.ts, from: r.frm, to: r.rcv, type: r.type, payload: r.payload,
    status: r.status, dAt: r.dAt, sAt: r.sAt, edited: r.edited, deleted: r.deleted,
    starred: r.starredBy.split(',').includes(uid) ? 1 : 0, upd: r.upd, reply: r.reply, fileId: r.fileId, reacts: parseReacts(r.reacts),
  };
}
function userOut(r) {
  return { uid: r.uid, username: r.username, nameEnc: r.nameEnc, aboutEnc: r.aboutEnc, photoEnc: r.photoEnc, created: r.created, lastSeen: r.lastSeen, profUpd: r.profUpd };
}
// Key material kept by the server (all of it is public-safe): per-install random salt, a small encrypted "check" value
// that lets a device verify the unlock code locally, and a version counter that changes when the code is changed.
// The unlock code itself, and any hash of it, never reaches the server.
const keyInfo = () => { const k = q.getMeta.get('kc'), v = q.getMeta.get('kver'); return { ksalt: (q.getMeta.get('ksalt') || {}).value || '', kc: k ? k.value : '', kver: v ? Number(v.value) : 0 }; };
const uidList = () => q.allUsers.all().map((u) => u.uid);
const getPv = () => { const m = q.getMeta.get('pv'); return m ? m.value : '0'; };
const bumpPv = () => { const v = String(Date.now()); q.setMeta.run('pv', v); return v; };

// ====== HTTP + SOCKET SERVER ======
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: 10000, pingTimeout: 8000, maxHttpBufferSize: 2e6,
  transports: ['websocket', 'polling'],
});

app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/', (req, res) => res.json({ ok: true, app: 'GalaxyRelax', v: 5, time: Date.now() }));
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// ---- rate limits (login/signup/config par sakht, baaki par dheela) ----
const rl = (windowMs, max) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'rate_limited', msg: 'Too many requests. Please try again in a little while.' }),
});
const limitLogin = rl(10 * 60 * 1000, 20);
const limitSignup = rl(60 * 60 * 1000, 8);
const limitConfig = rl(60 * 1000, 60);
const limitApi = rl(60 * 1000, 600);
app.use(express.text({ type: () => true, limit: '13mb' }));

const loginFails = new Map();          // username -> {n, until}
const lockedOut = (u) => { const f = loginFails.get(u); return f && f.n >= LOGIN_MAX_FAILS && Date.now() < f.until; };
const noteFail = (u) => { const f = loginFails.get(u) || { n: 0, until: 0 }; if (Date.now() > f.until && f.n >= LOGIN_MAX_FAILS) f.n = 0; f.n++; f.until = Date.now() + LOGIN_LOCK_MS; loginFails.set(u, f); };

// ====== PRESENCE (memory me: kaun socket se jura hai) ======
const conns = new Map();               // uid -> Map(socketId -> {vis})
const isConnected = (uid) => (conns.get(uid) || new Map()).size > 0;
const isOnline = (uid) => [...(conns.get(uid) || new Map()).values()].some((c) => c.vis);
const lastActive = new Map();          // uid -> ms
function peersFor(uid) {
  const out = {};
  for (const u of q.allUsers.all()) {
    if (u.uid === uid) continue;
    out[u.uid] = { online: isOnline(u.uid), lastSeen: isOnline(u.uid) ? Date.now() : (lastActive.get(u.uid) || u.lastSeen || 0) };
  }
  return out;
}
function broadcastPresence(uid) {
  const out = { [uid]: { online: isOnline(uid), lastSeen: isOnline(uid) ? Date.now() : (lastActive.get(uid) || 0) } };
  for (const p of uidList()) if (p !== uid) emitTo(p, 'peers', out);
}
function setVis(uid, sid, vis) {
  const m = conns.get(uid); if (!m || !m.has(sid)) return;
  const before = isOnline(uid);
  m.get(sid).vis = !!vis;
  const after = isOnline(uid);
  if (after) lastActive.set(uid, Date.now());
  if (before && !after) { const now = Date.now(); lastActive.set(uid, now); q.setSeen.run(now, uid); }
  if (before !== after) broadcastPresence(uid);
}
const emitTo = (uid, ev, data, exceptSid) => {
  let r = io.to('u:' + uid); if (exceptSid) r = r.except(exceptSid);
  r.emit(ev, data);
};
function pushMsgs(rows, exceptSid) {           // har row ko dono users ke apne "view" me bhejo
  const byUser = {};
  for (const r of rows) for (const uid of [r.frm, r.rcv]) (byUser[uid] = byUser[uid] || []).push(msgOut(r, uid));
  for (const uid of Object.keys(byUser)) emitTo(uid, 'upd', { msgs: byUser[uid] }, exceptSid);
}

// ====== WEB PUSH ======
async function sendPush(toUid) {
  const subs = q.subsOf.all(toUid);
  if (!subs.length) return;
  // Stealth: no sender name, no message text, no "chat" word. The service worker also ignores anything else.
  const payload = JSON.stringify({ t: 'star', title: 'Galaxy Relax', body: '🌟 A new star is shining' });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) q.subDel.run(s.endpoint);
      else console.error('push failed', e.statusCode || '', String(e.message || e).slice(0, 120));
    }
  }));
}

// ====== AUTH ======
function authToken(token) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 200) throw new E('auth');
  const s = q.getSession.get(sha256(token));
  if (!s || s.expires < Date.now()) { if (s) q.delSession.run(s.tokenHash); throw new E('auth'); }
  return s.uid;
}
function createSession(uid, ua) {
  const token = rnd(64), now = Date.now(), exp = sessionEnd(now);
  q.insSession.run(sha256(token), uid, now, exp, String(ua || '').slice(0, 120));
  q.trimSessions.run(uid, uid, MAX_SESSIONS);
  return { token, exp };
}

// ====== PUBLIC ACTIONS ======
const PUBLIC = {
  config() {
    const n = q.countUsers.get().c;
    return { ok: true, hasKey: !!q.getMeta.get('kc'), full: n >= MAX_USERS, users: n, vapid: VAPID.publicKey };
  },
  async signup(req) {
    const username = normUser(req.username), pw = String(req.password || '');
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw new E('bad_username', 'Username 3-20 chars: a-z 0-9 _ .');
    if (!/^[a-f0-9]{64}$/.test(pw)) throw new E('bad_password', 'Invalid password format (please update the app)');
    const salt = rnd(24), hash = await scrypt(pw, salt);          // slow hash first, then the atomic check
    const tx = db.transaction(() => {
      if (q.countUsers.get().c >= MAX_USERS) throw new E('full', 'This galaxy already has two explorers');
      if (q.userByName.get(username)) throw new E('exists', 'That username is already taken');
      const uid = 'u' + rnd(10), now = Date.now();
      q.insUser.run(uid, username, salt, hash, now, now, now);
      bumpPv();
      return uid;
    });
    const uid = tx();
    const pv = getPv();
    for (const p of uidList()) if (p !== uid) emitTo(p, 'pv', { pv });      // the first user sees the new user
    return { ok: true, ...createSession(uid, req.ua), uid, me: userOut(q.userById.get(uid)), ...keyInfo() };
  },
  async login(req) {
    const username = normUser(req.username), pw = String(req.password || '');
    if (lockedOut(username)) throw new E('locked', 'Too many wrong attempts. Try again in 10 minutes');
    const u = username ? q.userByName.get(username) : null;
    const ok = u && /^[a-f0-9]{64}$/.test(pw) && timingEq(await scrypt(pw, u.salt), u.hash);
    if (!ok) { if (!u) await scrypt('x', 'y'); noteFail(username); throw new E('bad_login', 'Wrong username or password'); }
    loginFails.delete(username);
    return { ok: true, ...createSession(u.uid, req.ua), uid: u.uid, me: userOut(u), ...keyInfo() };
  },
};

// ====== AUTHENTICATED ACTIONS ======
// ctx = { uid, sid (socket id ya null), token }
const ACTIONS = {
  logout(req, ctx) {
    q.delSession.run(sha256(ctx.token));
    if (!req.keepPush) q.subDelUid.run(ctx.uid);      // keepPush = App Lock (notifications chalte rahein); warna asli logout
    return { ok: true };
  },
  users() { return { ok: true, users: q.allUsers.all().map(userOut), pv: getPv() }; },
  sync(req, ctx) {
    const rows = q.recent.all({ u: ctx.uid, n: 600 });
    const maxUpd = q.maxUpd.get({ u: ctx.uid }).m;
    return { ok: true, now: Date.now(), msgs: rows.map((r) => msgOut(r, ctx.uid)), maxUpd, users: q.allUsers.all().map(userOut), pv: getPv(), peers: peersFor(ctx.uid), vapid: VAPID.publicKey, ...keyInfo() };
  },
  poll(req, ctx) {                       // reconnect ke baad "kya miss hua" catch-up
    const since = Number(req.since) || 0;
    const rows = q.since.all({ u: ctx.uid, s: since });
    let maxUpd = since; for (const r of rows) if (r.upd > maxUpd) maxUpd = r.upd;
    return { ok: true, now: Date.now(), msgs: rows.map((r) => msgOut(r, ctx.uid)), maxUpd, pv: getPv(), peers: peersFor(ctx.uid) };
  },
  history(req, ctx) {
    const peer = String(req.peer || ''), before = Number(req.before) || 9e15, limit = Math.min(100, Number(req.limit) || 50);
    const rows = q.hist.all({ u: ctx.uid, p: peer, b: before, l: limit + 1 });
    const more = rows.length > limit; if (more) rows.pop();
    return { ok: true, msgs: rows.reverse().map((r) => msgOut(r, ctx.uid)), more };
  },
  send(req, ctx) {
    const uid = ctx.uid, id = String(req.id || '');
    if (!/^m[a-z0-9]{8,30}$/.test(id)) throw new E('bad_id');
    const to = String(req.to || '');
    if (to === uid || !uidList().includes(to)) throw new E('bad_to');
    const type = ['text', 'image', 'file'].includes(req.type) ? req.type : 'text';
    const payload = String(req.payload || '');
    if (!payload || payload.length > MAX_PAYLOAD) throw new E('bad_payload', 'That is too long to send');
    const reply = String(req.replyId || '').slice(0, 40), fileId = type === 'text' ? '' : String(req.fileId || '').slice(0, 40);
    const dup = q.msgById.get(id);
    if (dup) { if (dup.frm !== uid) throw new E('bad_id'); return { ok: true, dup: true, msg: msgOut(dup, uid) }; }
    const row = db.transaction(() => {
      if (type !== 'text') {
        const f = q.fileById.get(fileId);
        if (!f || f.frm !== uid || f.msgId) throw new E('bad_file');
        q.linkFile.run(id, to, fileId);
      }
      const now = Date.now(), delivered = isConnected(to);
      q.insMsg.run({ id, ts: now, frm: uid, rcv: to, type, payload, status: delivered ? 1 : 0, dAt: delivered ? now : 0, upd: nextUpd(), reply, fileId });
      return q.msgById.get(id);
    })();
    pushMsgs([row], ctx.sid);
    if (!isOnline(to)) sendPush(to).catch(() => {});
    return { ok: true, msg: msgOut(row, uid) };
  },
  edit(req, ctx) {
    const payload = String(req.payload || '');
    if (!payload || payload.length > MAX_PAYLOAD) throw new E('bad_payload');
    const m = q.msgById.get(String(req.id || ''));
    if (!m) throw new E('not_found');
    if (m.frm !== ctx.uid || m.type !== 'text' || m.deleted) throw new E('forbidden');
    if (Date.now() - m.ts > EDIT_WINDOW_MS) throw new E('too_late', 'Editing is only possible for 15 minutes');
    q.editMsg.run(payload, nextUpd(), m.id);
    const row = q.msgById.get(m.id);
    pushMsgs([row], ctx.sid);
    return { ok: true, msg: msgOut(row, ctx.uid) };
  },
  del(req, ctx) {
    const m = q.msgById.get(String(req.id || ''));
    if (!m) throw new E('not_found');
    if (m.frm !== ctx.uid) throw new E('forbidden');
    q.delMsg.run(nextUpd(), m.id);
    if (m.fileId) { q.delFile.run(m.fileId); fs.unlink(path.join(DATA_DIR, 'files', m.fileId), () => {}); }
    const row = q.msgById.get(m.id);
    pushMsgs([row], ctx.sid);
    return { ok: true, msg: msgOut(row, ctx.uid) };
  },
  star(req, ctx) {
    const m = q.msgById.get(String(req.id || ''));
    if (!m) throw new E('not_found');
    if (m.frm !== ctx.uid && m.rcv !== ctx.uid) throw new E('forbidden');
    const list = m.starredBy.split(',').filter(Boolean), i = list.indexOf(ctx.uid);
    if (req.on && i < 0) list.push(ctx.uid);
    if (!req.on && i >= 0) list.splice(i, 1);
    q.starMsg.run(list.join(','), nextUpd(), m.id);
    const row = q.msgById.get(m.id);
    emitTo(ctx.uid, 'upd', { msgs: [msgOut(row, ctx.uid)] }, ctx.sid);   // star sirf mere devices ke liye
    return { ok: true, msg: msgOut(row, ctx.uid) };
  },
  keyinit(req, ctx) {                    // very first unlock ever: the first device to unlock creates the check value (only once)
    if (q.getMeta.get('kc')) throw new E('key_exists', 'The key is already set');
    const ksalt = String(req.ksalt || ''), kc = String(req.kc || '');
    if (!/^[a-f0-9]{32}$/.test(ksalt) || !kc || kc.length > 500) throw new E('bad_key', 'Invalid key data');
    q.setMeta.run('ksalt', ksalt); q.setMeta.run('kc', kc); q.setMeta.run('kver', '1');
    for (const uid of uidList()) emitTo(uid, 'keyinfo', keyInfo(), uid === ctx.uid ? ctx.sid : undefined);
    return { ok: true, ...keyInfo() };
  },
  /** Everything that is encrypted with the unlock code: used by "Change secret code" to re-encrypt it all. */
  dump() {
    const msgs = q.allMsgs.all().filter((r) => !r.deleted && r.payload).map((r) => ({ id: r.id, payload: r.payload, reacts: parseReacts(r.reacts) }));
    const users = q.allUsers.all().map((u) => ({ uid: u.uid, nameEnc: u.nameEnc, aboutEnc: u.aboutEnc, photoEnc: u.photoEnc }));
    const files = q.allFiles.all().map((x) => ({ fileId: x.fileId }));
    return { ok: true, msgs, users, files, ...keyInfo() };
  },
  /** Step 1 of a code change, per file: the re-encrypted bytes are parked next to the original (<id>.rk). */
  rekeyfile(req, ctx) {
    const f = q.fileById.get(String(req.fileId || ''));
    if (!f) throw new E('not_found');
    if (f.frm !== ctx.uid && f.rcv !== ctx.uid) throw new E('forbidden');
    const data = String(req.data || '');
    if (!data || data.length > MAX_UPLOAD_B64) throw new E('too_big', 'That file is too large (max about 6 MB)');
    fs.writeFileSync(path.join(DATA_DIR, 'files', f.fileId + '.rk'), Buffer.from(data, 'base64'), { mode: 0o600 });
    return { ok: true };
  },
  /** Step 2: swap every ciphertext to the new key in ONE transaction. Refused if anything changed meanwhile ("stale"). */
  rekey(req, ctx) {
    const stale = () => new E('stale', 'Something changed while re-encrypting. Please try again.');
    const cur = keyInfo();
    if (Number(req.baseVer) !== cur.kver) throw stale();
    const ksalt = String(req.ksalt || ''), kc = String(req.kc || '');
    if (!/^[a-f0-9]{32}$/.test(ksalt) || !kc || kc.length > 500) throw new E('bad_key', 'Invalid key data');
    const inMsgs = Array.isArray(req.msgs) ? req.msgs : [], inUsers = Array.isArray(req.users) ? req.users : [], inFiles = Array.isArray(req.files) ? req.files.map(String) : [];
    const rows = q.allMsgs.all().filter((r) => !r.deleted && r.payload);
    const ids = new Set(rows.map((r) => r.id));
    if (inMsgs.length !== rows.length || new Set(inMsgs.map((m) => m && m.id)).size !== rows.length) throw stale();
    for (const m of inMsgs) {
      if (!m || !ids.has(m.id) || typeof m.payload !== 'string' || !m.payload || m.payload.length > MAX_PAYLOAD) throw stale();
      for (const k of Object.keys(m.reacts || {})) if (typeof m.reacts[k] !== 'string' || m.reacts[k].length > 400) throw stale();
    }
    const urows = q.allUsers.all();
    if (inUsers.length !== urows.length || !inUsers.every((u) => urows.some((r) => r.uid === u.uid))) throw stale();
    const chk = (v, max) => { v = String(v || ''); if (v.length > max) throw stale(); return v; };
    const frows = q.allFiles.all().map((x) => x.fileId);
    if (inFiles.length !== frows.length || !frows.every((x) => inFiles.includes(x))) throw stale();
    for (const id of frows) if (!fs.existsSync(path.join(DATA_DIR, 'files', id + '.rk'))) throw stale();
    db.transaction(() => {
      for (const m of inMsgs) q.rekeyMsg.run(m.payload, Object.keys(m.reacts || {}).length ? JSON.stringify(m.reacts) : '', nextUpd(), m.id);
      const now = Date.now();
      for (const u of inUsers) q.setEnc.run(chk(u.nameEnc, 2000), chk(u.aboutEnc, 4000), chk(u.photoEnc, 45000), now, u.uid);
      q.setMeta.run('ksalt', ksalt); q.setMeta.run('kc', kc); q.setMeta.run('kver', String(cur.kver + 1));
    })();
    for (const id of frows) fs.renameSync(path.join(DATA_DIR, 'files', id + '.rk'), path.join(DATA_DIR, 'files', id));
    const pv = bumpPv();
    const info = keyInfo();
    for (const uid of uidList()) { emitTo(uid, 'keyinfo', info, uid === ctx.uid ? ctx.sid : undefined); emitTo(uid, 'pv', { pv }, uid === ctx.uid ? ctx.sid : undefined); }
    return { ok: true, ...info };
  },
  react(req, ctx) {                      // emoji reaction (encrypted). enc='' => remove my reaction
    const m = q.msgById.get(String(req.id || ''));
    if (!m) throw new E('not_found');
    if (m.frm !== ctx.uid && m.rcv !== ctx.uid) throw new E('forbidden');
    if (m.deleted) throw new E('forbidden');
    const enc = String(req.enc || '');
    if (enc.length > 400) throw new E('too_big', 'Reaction is too large');
    const map = parseReacts(m.reacts);
    if (enc) map[ctx.uid] = enc; else delete map[ctx.uid];
    q.reactMsg.run(Object.keys(map).length ? JSON.stringify(map) : '', nextUpd(), m.id);
    const row = q.msgById.get(m.id);
    pushMsgs([row], ctx.sid);
    return { ok: true, msg: msgOut(row, ctx.uid) };
  },
  seen(req, ctx) {                       // I opened this conversation and saw the messages => blue ticks
    const rows = q.seen.all({ u: ctx.uid, p: String(req.peer || ''), now: Date.now(), upd: nextUpd() });
    if (rows.length) pushMsgs(rows, ctx.sid);
    return { ok: true, msgs: rows.map((r) => msgOut(r, ctx.uid)) };
  },
  typing(req, ctx) {
    const to = String(req.to || '');
    if (uidList().includes(to) && to !== ctx.uid) emitTo(to, 'typing', { from: ctx.uid });
    return { ok: true };
  },
  vis(req, ctx) {
    if (ctx.sid) setVis(ctx.uid, ctx.sid, !!req.vis);
    return { ok: true };
  },
  profile(req, ctx) {
    const chk = (v, max) => { if (v === undefined) return null; v = String(v); if (v.length > max) throw new E('too_big', 'That is too large'); return v; };
    const now = Date.now();
    q.setProfile.run({ uid: ctx.uid, nameEnc: chk(req.nameEnc, 2000), aboutEnc: chk(req.aboutEnc, 4000), photoEnc: chk(req.photoEnc, 45000), now });
    const pv = bumpPv();
    for (const p of uidList()) if (p !== ctx.uid) emitTo(p, 'pv', { pv });
    return { ok: true, me: userOut(q.userById.get(ctx.uid)), pv };
  },
  upload(req, ctx) {
    const data = String(req.data || '');
    if (!data || data.length > MAX_UPLOAD_B64) throw new E('too_big', 'That file is too large (max about 6 MB)');
    const buf = Buffer.from(data, 'base64');
    const fileId = 'f' + rnd(14);
    fs.writeFileSync(path.join(DATA_DIR, 'files', fileId), buf, { mode: 0o600 });
    q.insFile.run(fileId, '', ctx.uid, '', buf.length, Date.now());
    return { ok: true, fileId };
  },
  file(req, ctx) {
    const f = q.fileById.get(String(req.fileId || ''));
    if (!f) throw new E('not_found');
    if (f.frm !== ctx.uid && f.rcv !== ctx.uid) throw new E('forbidden');
    return { ok: true, data: fs.readFileSync(path.join(DATA_DIR, 'files', f.fileId)).toString('base64') };
  },
  pushsub(req, ctx) {
    const s = req.sub || {};
    if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth || String(s.endpoint).length > 1000) throw new E('bad_sub');
    q.subUpsert.run(String(s.endpoint), ctx.uid, String(s.keys.p256dh), String(s.keys.auth), Date.now());
    return { ok: true };
  },
  pushunsub(req) { if (req.endpoint) q.subDel.run(String(req.endpoint)); return { ok: true }; },
  /** Password badlo: purana verify => naya salt+hash. Dusre devices ke sessions band (is device ka chalta rahe). */
  async chpw(req, ctx) {
    const u = q.userById.get(ctx.uid);
    if (!u) throw new E('not_found');
    const oldPw = String(req.oldPassword || ''), newPw = String(req.newPassword || '');
    if (!/^[a-f0-9]{64}$/.test(oldPw) || !/^[a-f0-9]{64}$/.test(newPw)) throw new E('bad_password', 'Invalid password format (please update the app)');
    if (lockedOut(u.username)) throw new E('locked', 'Too many wrong attempts. Try again in 10 minutes');
    if (!timingEq(await scrypt(oldPw, u.salt), u.hash)) { noteFail(u.username); throw new E('bad_password', 'Current password is wrong'); }
    if (oldPw === newPw) throw new E('same_password', 'The new password must differ from the old one');
    loginFails.delete(u.username);
    const salt = rnd(24), hash = await scrypt(newPw, salt);
    q.setPw.run(salt, hash, u.uid);
    const keep = sha256(ctx.token);
    q.delOtherSessions.run(u.uid, keep);
    for (const s of io.sockets.sockets.values()) {        // dusre devices ke chalu sockets bhi kaat do
      if (s.data.uid === u.uid && sha256(s.data.token) !== keep) { s.emit('revoked'); s.disconnect(true); }
    }
    return { ok: true };
  },
};

async function dispatch(req, ctx) {
  if (!req || typeof req !== 'object') throw new E('bad_request');
  const action = String(req.action || '');
  if (Object.prototype.hasOwnProperty.call(PUBLIC, action)) return PUBLIC[action](req);
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw new E('unknown_action');
  const token = ctx.token || req.token;
  const uid = authToken(token);          // har request par session dobara check (socket par bhi): logout/password-change ke baad turant band
  const out = await ACTIONS[action](req, { uid, sid: ctx.sid || null, token });
  return out;
}
function errOut(err) {
  if (err && err.code && typeof err.code === 'string' && err instanceof E) return { ok: false, error: err.code, msg: err.message };
  console.error(err && err.stack || err);
  return { ok: false, error: 'server', msg: 'Something went wrong on the server' };
}

// ---- HTTP: public actions + fallback + upload/file (bade payload) ----
app.post('/api', (req, res, next) => {
  let body; try { body = JSON.parse(req.body); } catch (e) { return res.json({ ok: false, error: 'bad_request' }); }
  req.rpc = body;
  const a = body && body.action;
  if (a === 'login') return limitLogin(req, res, next);
  if (a === 'signup') return limitSignup(req, res, next);
  if (a === 'config') return limitConfig(req, res, next);
  return limitApi(req, res, next);
}, async (req, res) => {
  try { res.json(await dispatch(req.rpc, {})); } catch (e) { res.json(errOut(e)); }
});

// ---- Socket.io ----
io.use((socket, next) => {
  try { socket.data.token = socket.handshake.auth && socket.handshake.auth.token; socket.data.uid = authToken(socket.data.token); next(); }
  catch (e) { next(new Error('auth')); }
});
io.on('connection', (socket) => {
  const uid = socket.data.uid;
  socket.join('u:' + uid);
  if (!conns.has(uid)) conns.set(uid, new Map());
  conns.get(uid).set(socket.id, { vis: !!(socket.handshake.auth && socket.handshake.auth.vis) });
  if (conns.get(uid).get(socket.id).vis) lastActive.set(uid, Date.now());
  // jo messages mere liye pending the => delivered, bhejne walon ko turant batao
  const rows = q.delivered.all({ u: uid, now: Date.now(), upd: nextUpd() });
  if (rows.length) pushMsgs(rows, socket.id);
  broadcastPresence(uid);

  // token-bucket jaisa simple flood guard
  let bucket = 0, t0 = Date.now();
  socket.on('rpc', async (req, cb) => {
    if (typeof cb !== 'function') return;
    const now = Date.now(); if (now - t0 > 10000) { t0 = now; bucket = 0; }
    if (++bucket > 200) return cb({ ok: false, error: 'rate_limited', msg: 'Too fast. Please slow down.' });
    try { cb(await dispatch(req, { uid, sid: socket.id, token: socket.data.token })); } catch (e) { cb(errOut(e)); }
  });
  socket.on('disconnect', () => {
    const m = conns.get(uid);
    if (m) {
      const before = isOnline(uid);
      m.delete(socket.id);
      if (!m.size) conns.delete(uid);
      if (before && !isOnline(uid)) { const now = Date.now(); lastActive.set(uid, now); q.setSeen.run(now, uid); broadcastPresence(uid); }
    }
  });
});

setInterval(() => { try { q.purgeSessions.run(Date.now()); } catch (e) { /* ignore */ } }, 6 * 3600 * 1000).unref();
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Galaxy Relax v5 listening on :${PORT}  data=${DATA_DIR}  origins=${ORIGINS.join(',')}`));
  const stop = () => { io.close(); server.close(); try { db.close(); } catch (e) { /* ignore */ } process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { app, server, io, db };
