/**
 * MyChat — Google Apps Script backend (Web App)
 * ------------------------------------------------------------
 * Database  : Google Sheet (tabs: Users, Messages, Sessions, Files, Meta)
 * Files     : Google Drive folder "MyChat_Encrypted_Files" (only encrypted bytes)
 * Security  : Passwords = salted+iterated SHA-256. Messages/files/profile are
 *             AES-GCM encrypted IN THE BROWSER. Server never sees the Secret Key.
 *
 * Browser talks to this with POST (Content-Type text/plain, JSON body).
 */

// ====== CONFIG ======
var SHEET_ID = '1KaQKTvR31TV-nzeVJnQsdBxNu0R1qUrAbTWTuDhmy3E';
var MAX_USERS = 2;                       // private chat: sirf 2 log
var SESSION_DAYS = 30;
var EDIT_WINDOW_MS = 15 * 60 * 1000;     // edit only within 15 min (like WhatsApp)
var MAX_UPLOAD_B64 = 9000000;            // ~6.5 MB raw file
var PW_ROUNDS = 3;   // browser pehle PBKDF2 se password stretch karta hai; server pe salted SHA-256
var ONLINE_MS = 25000;                   // active in last 25s => "online" (Apps Script latency variable hai)
var TYPING_MS = 5000;
var SETUP_VERSION = '1';
var FOLDER_NAME = 'MyChat_Encrypted_Files';

var HEADERS = {
  Users:    ['uid', 'username', 'salt', 'hash', 'nameEnc', 'aboutEnc', 'photoEnc', 'created', 'lastSeen', 'profUpd'],
  Messages: ['id', 'ts', 'from', 'to', 'type', 'payload', 'status', 'deliveredAt', 'seenAt', 'edited', 'deleted', 'starredBy', 'upd', 'replyId', 'fileId'],
  Sessions: ['tokenHash', 'uid', 'created', 'expires', 'ua'],
  Files:    ['fileId', 'driveId', 'msgId', 'from', 'to', 'size', 'ts'],
  Meta:     ['key', 'value']
};
// columns (1-based) that must stay TEXT so Sheets never turns "123e4" into a number
var TEXT_COLS = {
  Users: [1, 2, 3, 4, 5, 6, 7],
  Messages: [1, 3, 4, 5, 6, 12, 14, 15],
  Sessions: [1, 2, 5],
  Files: [1, 2, 3, 4, 5],
  Meta: [1, 2]
};

// ====== ENTRY POINTS ======
function doGet(e) {
  return json_({ ok: true, app: 'MyChat', time: Date.now() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    ensureSetup_();
    var action = String(req.action || '');
    var PUBLIC = { config: 1, signup: 1, login: 1 };
    var ROUTES = {
      config: config_, signup: signup_, login: login_,
      logout: logout_, sync: sync_, poll: poll_, users: users_,
      send: send_, edit: edit_, del: del_, star: star_,
      history: history_, profile: profile_, upload: upload_, file: file_,
      typing: typing_
    };
    var fn = ROUTES[action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var uid = PUBLIC[action] ? null : authUser_(req.token);
    return json_(fn(req, uid));
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, msg: err.message });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'server', msg: String(err && err.message || err) });
  }
}

/** Editor me ek baar "Run" karo: permissions + sheet tabs + Drive folder ban jayenge. */
function setup() {
  ensureSetup_(true);
  getFolder_();
  Logger.log('MyChat setup done. Sheet: ' + ss_().getUrl());
}

// ====== SMALL HELPERS ======
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// Sheets kisi bhi text ko jo + = - @ se shuru ho (ya number jaisa dikhe) formula/number bana deta hai.
// Isliye har free-form string ke aage '~' lagakar likhte hain, padhte waqt hata dete hain.
function W_(v) { v = String(v == null ? '' : v); return v ? '~' + v : ''; }
function R_(v) { v = String(v == null ? '' : v); return v.charAt(0) === '~' ? v.slice(1) : v; }
function E_(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
// Cache keys ko sheet-ID ke hisaab se alag rakhte hain (test sheet / asli sheet mix na ho)
function cache_() {
  var c = CacheService.getScriptCache(), p = SHEET_ID.slice(0, 8) + ':';
  return {
    get: function (k) { return c.get(p + k); },
    put: function (k, v, t) { c.put(p + k, v, t); },
    remove: function (k) { c.remove(p + k); },
    getAll: function (keys) {
      var r = c.getAll(keys.map(function (k) { return p + k; })), o = {};
      keys.forEach(function (k) { if (r[p + k] != null) o[k] = r[p + k]; });
      return o;
    }
  };
}
// Ek execution me spreadsheet/sheets sirf ek baar kholo (har open ~1s leta hai)
var SS_ = null, SH_ = {};
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(SHEET_ID)); }
function sheet_(name) { return SH_[name] || (SH_[name] = ss_().getSheetByName(name)); }
function bytesToHex_(b) {
  var s = '';
  for (var i = 0; i < b.length; i++) s += ('0' + (b[i] & 0xff).toString(16)).slice(-2);
  return s;
}
function sha256hex_(str) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}
function hashPassword_(salt, pw) {
  var h = sha256hex_(salt + pw);
  for (var i = 1; i < PW_ROUNDS; i++) h = sha256hex_(h + salt);
  return h;
}
function rnd_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function bumpVer_() {
  cache_().put('ver', String(Date.now()) + String(Math.floor(Math.random() * 1000)), 21600);
}
function getVer_() {
  var c = cache_(), v = c.get('ver');
  if (!v) { v = String(Date.now()); c.put('ver', v, 21600); }
  return v;
}
function getPv_() {
  var c = cache_(), v = c.get('pv');
  if (!v) { v = String(Date.now()); c.put('pv', v, 21600); }
  return v;
}
function findRow_(sheet, col, value) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var f = sheet.getRange(2, col, last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findNext();
  return f ? f.getRow() : 0;
}

// ====== SETUP (sheet tabs + headers) ======
function ensureSetup_(force) {
  var c = cache_();
  if (!force && c.get('setup_ok')) return;
  var props = PropertiesService.getScriptProperties();
  var SV = 'setup_v_' + SHEET_ID;
  if (!force && props.getProperty(SV) === SETUP_VERSION) { c.put('setup_ok', '1', 21600); return; }
  var ss = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var cols = HEADERS[name];
    (TEXT_COLS[name] || []).forEach(function (ci) {
      sh.getRange(1, ci, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#d9fdd3');
      sh.setFrozenRows(1);
    }
  });
  // old default empty "Sheet1" hata do (agar khali ho)
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  props.setProperty(SV, SETUP_VERSION);
  c.put('setup_ok', '1', 21600);
}

function getMeta_(key) {
  var sh = sheet_('Meta'), r = findRow_(sh, 1, key);
  return r ? R_(sh.getRange(r, 2).getValue()) : '';
}
function setMeta_(key, value) {
  var sh = sheet_('Meta'), r = findRow_(sh, 1, key);
  if (r) sh.getRange(r, 2).setValue(W_(value));
  else sh.appendRow([key, W_(value)]);
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('folderId');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('folderId', f.getId());
  return f;
}

// ====== AUTH ======
function normUser_(u) { return String(u || '').trim().toLowerCase(); }

function authUser_(token) {
  if (!token || typeof token !== 'string' || token.length < 32) throw E_('auth');
  var th = sha256hex_(token);
  var c = cache_();
  var uid = c.get('s_' + th);
  if (!uid) {
    var sh = sheet_('Sessions');
    var r = findRow_(sh, 1, W_(th));
    if (!r) throw E_('auth');
    var row = sh.getRange(r, 1, 1, 5).getValues()[0];
    if (Number(row[3]) < Date.now()) { sh.deleteRow(r); throw E_('auth'); }
    uid = String(row[1]);
    c.put('s_' + th, uid, 21600);
  }
  return uid;
}

function createSession_(uid, ua) {
  var token = rnd_(64);
  var th = sha256hex_(token);
  var now = Date.now();
  sheet_('Sessions').appendRow([W_(th), uid, now, now + SESSION_DAYS * 86400000, String(ua || '').slice(0, 120)]);
  cache_().put('s_' + th, uid, 21600);
  return token;
}

function userOut_(row) {
  return {
    uid: String(row[0]), username: R_(row[1]),
    nameEnc: R_(row[4]), aboutEnc: R_(row[5]), photoEnc: R_(row[6]),
    created: Number(row[7]) || 0, lastSeen: Number(row[8]) || 0, profUpd: Number(row[9]) || 0
  };
}

function getUidList_() {
  var c = cache_(), v = c.get('uidl');
  if (v) return JSON.parse(v);
  var sh = sheet_('Users'), last = sh.getLastRow();
  var list = [];
  if (last >= 2) list = sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  c.put('uidl', JSON.stringify(list), 21600);
  return list;
}

// ====== PUBLIC ACTIONS ======
function config_() {
  var n = getUidList_().length;
  return { ok: true, hasWorkspace: !!getMeta_('proofHash'), full: n >= MAX_USERS, users: n };
}

function signup_(req) {
  var username = normUser_(req.username);
  var pw = String(req.password || '');
  var proof = String(req.proof || '');
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw E_('bad_username', 'Username 3-20 chars: a-z 0-9 _ .');
  if (!/^[a-f0-9]{64}$/.test(pw)) throw E_('bad_password', 'Password format galat (app update karo)');
  if (!/^[a-f0-9]{64}$/.test(proof)) throw E_('bad_proof');

  return withLock_(function () {
    var users = sheet_('Users');
    if (getUidList_().length >= MAX_USERS) throw E_('full', 'Ye private chat hai, 2 users already hain');
    if (findRow_(users, 2, W_(username))) throw E_('exists', 'Ye username le liya gaya hai');

    var ph = sha256hex_(proof);
    var existing = getMeta_('proofHash');
    if (!existing) {
      // pehla user: workspace banta hai
      var ksalt = String(req.ksalt || ''), kc = String(req.kc || '');
      if (!ksalt || !kc || ksalt.length > 100 || kc.length > 500) throw E_('bad_key');
      setMeta_('proofHash', ph); setMeta_('ksalt', ksalt); setMeta_('kc', kc);
    } else if (existing !== ph) {
      throw E_('wrong_key', 'Secret Key galat hai');
    }

    var uid = 'u' + rnd_(10);
    var salt = rnd_(24);
    var now = Date.now();
    users.appendRow([uid, W_(username), W_(salt), W_(hashPassword_(salt, pw)), '', '', '', now, now, now]);
    cache_().remove('uidl');
    bumpVer_(); cache_().put('pv', String(now), 21600);
    var row = users.getRange(users.getLastRow(), 1, 1, 10).getValues()[0];
    return {
      ok: true, token: createSession_(uid, req.ua), uid: uid, me: userOut_(row),
      ksalt: getMeta_('ksalt'), kc: getMeta_('kc')
    };
  });
}

function login_(req) {
  var username = normUser_(req.username);
  var pw = String(req.password || '');
  var c = cache_(), fk = 'lf_' + username;
  if (Number(c.get(fk) || 0) >= 8) throw E_('locked', 'Bahut galat attempts. 10 minute baad try karo');
  var sh = sheet_('Users');
  var r = username ? findRow_(sh, 2, W_(username)) : 0;
  var row = r ? sh.getRange(r, 1, 1, 10).getValues()[0] : null;
  if (!row || hashPassword_(R_(row[2]), pw) !== R_(row[3])) {
    c.put(fk, String(Number(c.get(fk) || 0) + 1), 600);
    Utilities.sleep(400);
    throw E_('bad_login', 'Username ya password galat hai');
  }
  c.remove(fk);
  sh.getRange(r, 9).setValue(Date.now());
  return {
    ok: true, token: createSession_(String(row[0]), req.ua), uid: String(row[0]), me: userOut_(row),
    ksalt: getMeta_('ksalt'), kc: getMeta_('kc')
  };
}

function logout_(req, uid) {
  var th = sha256hex_(String(req.token));
  var sh = sheet_('Sessions'), r = findRow_(sh, 1, W_(th));
  if (r) sh.deleteRow(r);
  cache_().remove('s_' + th);
  cache_().remove('act_' + uid);
  var ur = findRow_(sheet_('Users'), 1, uid);
  if (ur) sheet_('Users').getRange(ur, 9).setValue(Date.now());
  return { ok: true };
}

// ====== USERS / PRESENCE ======
function users_(req, uid) {
  var sh = sheet_('Users'), last = sh.getLastRow();
  var list = last >= 2 ? sh.getRange(2, 1, last - 1, 10).getValues().map(userOut_) : [];
  return { ok: true, users: list, pv: getPv_() };
}

function presence_(uid, now) {
  var uids = getUidList_().filter(function (u) { return u !== uid; });
  var c = cache_();
  var keys = [];
  uids.forEach(function (u) { keys.push('act_' + u); keys.push('ty_' + u); });
  var got = keys.length ? c.getAll(keys) : {};
  var out = {}, missing = [];
  uids.forEach(function (u) { if (!got['act_' + u]) missing.push(u); });
  if (missing.length) {                       // cache khali => sheet se lastSeen
    var sh = sheet_('Users'), last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, 9).getValues().forEach(function (r) {
      var u = String(r[0]);
      if (missing.indexOf(u) >= 0) { got['act_' + u] = String(Number(r[8]) || 1); c.put('act_' + u, got['act_' + u], 21600); }
    });
  }
  uids.forEach(function (u) {
    var act = Number(got['act_' + u]) || 0, ty = null;
    try { ty = got['ty_' + u] ? JSON.parse(got['ty_' + u]) : null; } catch (e) { ty = null; }
    out[u] = {
      online: now - act < ONLINE_MS, lastSeen: act,
      typingTo: ty && now - ty.ts < TYPING_MS ? ty.to : ''
    };
  });
  return out;
}

function touch_(uid, req, now) {
  var c = cache_();
  if (req.vis) {
    c.put('act_' + uid, String(now), 21600);
    if (now - Number(c.get('lsw_' + uid) || 0) > 60000) {     // sheet me har 60s me ek baar
      c.put('lsw_' + uid, String(now), 21600);
      var r = findRow_(sheet_('Users'), 1, uid);
      if (r) sheet_('Users').getRange(r, 9).setValue(now);
    }
  }
  if (req.typingTo) c.put('ty_' + uid, JSON.stringify({ to: String(req.typingTo), ts: now }), 10);
}

function typing_(req, uid) {
  var now = Date.now();
  cache_().put('ty_' + uid, JSON.stringify({ to: String(req.to || ''), ts: now }), 10);
  cache_().put('act_' + uid, String(now), 21600);
  return { ok: true };
}

// ====== MESSAGES ======
function msgOut_(r, uid) {
  return {
    id: String(r[0]), ts: Number(r[1]), from: String(r[2]), to: String(r[3]), type: String(r[4]),
    payload: R_(r[5]), status: Number(r[6]) || 0, dAt: Number(r[7]) || 0, sAt: Number(r[8]) || 0,
    edited: Number(r[9]) || 0, deleted: Number(r[10]) || 0,
    starred: String(r[11] || '').split(',').indexOf(uid) >= 0 ? 1 : 0,
    upd: Number(r[12]) || 0, reply: String(r[13] || ''), fileId: String(r[14] || '')
  };
}

/** Last nRows rows padho, delivered/seen mark karo, since ke baad wale rows wapas do. */
function fetchWindow_(uid, nRows, since, viewing) {
  var sh = sheet_('Messages'), last = sh.getLastRow();
  if (last < 2) return { msgs: [], maxUpd: since || 0 };
  var start = Math.max(2, last - nRows + 1);
  var vals = sh.getRange(start, 1, last - start + 1, 15).getValues();
  var marks = [];                                   // [index, newStatus]
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[3]) !== uid) continue;             // sirf mere liye aaye hue
    var st = Number(r[6]) || 0;
    if (viewing && String(r[2]) === viewing && st < 2) marks.push([i, 2]);
    else if (st < 1) marks.push([i, 1]);
  }
  if (marks.length) {
    withLock_(function () {
      var now = Date.now();
      marks.forEach(function (m) {
        var r = vals[m[0]], row = start + m[0];
        var d = Number(r[7]) || now, s = m[1] === 2 ? now : (Number(r[8]) || 0);
        sh.getRange(row, 7, 1, 3).setValues([[m[1], d, s]]);
        sh.getRange(row, 13).setValue(now);
        r[6] = m[1]; r[7] = d; r[8] = s; r[12] = now;
      });
      bumpVer_();
    });
  }
  var out = [], maxUpd = since || 0;
  for (var j = 0; j < vals.length; j++) {
    var q = vals[j];
    if (String(q[2]) !== uid && String(q[3]) !== uid) continue;
    var u = Number(q[12]) || 0;
    if (u > maxUpd) maxUpd = u;
    if (!since || u >= since) out.push(msgOut_(q, uid));
  }
  return { msgs: out, maxUpd: maxUpd };
}

function sync_(req, uid) {
  var now = Date.now();
  touch_(uid, req, now);
  var ver = getVer_();
  var w = fetchWindow_(uid, 600, 0, '');
  var us = users_(req, uid);
  return { ok: true, ver: ver, now: now, msgs: w.msgs, maxUpd: w.maxUpd, users: us.users, pv: us.pv, peers: presence_(uid, now) };
}

function poll_(req, uid) {
  var now = Date.now();
  touch_(uid, req, now);
  var ver = getVer_();
  var res = { ok: true, ver: ver, now: now, pv: getPv_(), peers: presence_(uid, now) };
  if (String(req.ver) === ver && !req.force) { res.same = true; return res; }
  var viewing = req.vis && req.viewing ? String(req.viewing) : '';
  var w = fetchWindow_(uid, 400, Number(req.since) || 0, viewing);
  res.msgs = w.msgs; res.maxUpd = w.maxUpd;
  // res.ver = jo version padhne SE PEHLE tha. Agar isi poll me delivered/seen mark hua (ver bump),
  // to client ka agla poll mismatch dekhega aur fresh data le lega.
  return res;
}

function history_(req, uid) {
  var peer = String(req.peer || '');
  var before = Number(req.before) || Infinity;
  var limit = Math.min(100, Number(req.limit) || 50);
  var sh = sheet_('Messages'), last = sh.getLastRow();
  if (last < 2) return { ok: true, msgs: [], more: false };
  var meta = sh.getRange(2, 1, last - 1, 4).getValues();
  var idx = [], more = false;
  for (var i = meta.length - 1; i >= 0; i--) {
    var f = String(meta[i][2]), t = String(meta[i][3]);
    var ok = (f === uid && t === peer) || (f === peer && t === uid);
    if (!ok || Number(meta[i][1]) >= before) continue;
    if (idx.length >= limit) { more = true; break; }
    idx.push(i);
  }
  if (!idx.length) return { ok: true, msgs: [], more: false };
  var lo = Math.min.apply(null, idx), hi = Math.max.apply(null, idx);
  var rows = sh.getRange(2 + lo, 1, hi - lo + 1, 15).getValues();
  var set = {}; idx.forEach(function (k) { set[k - lo] = 1; });
  var out = [];
  rows.forEach(function (r, k) { if (set[k]) out.push(msgOut_(r, uid)); });
  return { ok: true, msgs: out, more: more };
}

function send_(req, uid) {
  var id = String(req.id || '');
  if (!/^m[a-z0-9]{8,30}$/.test(id)) throw E_('bad_id');
  var to = String(req.to || '');
  if (to === uid || getUidList_().indexOf(to) < 0) throw E_('bad_to');
  var type = ['text', 'image', 'file'].indexOf(req.type) >= 0 ? req.type : 'text';
  var payload = String(req.payload || '');
  if (!payload || payload.length > 45000) throw E_('bad_payload', 'Message bahut bada hai');
  var replyId = String(req.replyId || '').slice(0, 40);
  var fileId = String(req.fileId || '').slice(0, 40);

  return withLock_(function () {
    var sh = sheet_('Messages'), last = sh.getLastRow();
    if (last >= 2) {                                   // duplicate retry => wahi message wapas
      var s = Math.max(2, last - 29);
      var ids = sh.getRange(s, 1, last - s + 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === id) {
          return { ok: true, dup: true, msg: msgOut_(sh.getRange(s + i, 1, 1, 15).getValues()[0], uid) };
        }
      }
    }
    if (type !== 'text') {
      var fsh = sheet_('Files'), fr = findRow_(fsh, 1, fileId);
      if (!fr) throw E_('bad_file');
      var frow = fsh.getRange(fr, 1, 1, 7).getValues()[0];
      if (String(frow[3]) !== uid || String(frow[2])) throw E_('bad_file');
      fsh.getRange(fr, 3).setValue(id);
      fsh.getRange(fr, 5).setValue(to);
    }
    var now = Date.now();
    var row = [id, now, uid, to, type, W_(payload), 0, '', '', 0, 0, '', now, replyId, type === 'text' ? '' : fileId];
    sh.appendRow(row);
    cache_().remove('ty_' + uid);
    bumpVer_();
    return { ok: true, msg: msgOut_(row, uid) };
  });
}

function edit_(req, uid) {
  var payload = String(req.payload || '');
  if (!payload || payload.length > 45000) throw E_('bad_payload');
  return withLock_(function () {
    var sh = sheet_('Messages'), r = findRow_(sh, 1, req.id);
    if (!r) throw E_('not_found');
    var row = sh.getRange(r, 1, 1, 15).getValues()[0];
    if (String(row[2]) !== uid || String(row[4]) !== 'text' || Number(row[10])) throw E_('forbidden');
    if (Date.now() - Number(row[1]) > EDIT_WINDOW_MS) throw E_('too_late', 'Edit sirf 15 minute tak ho sakta hai');
    var now = Date.now();
    sh.getRange(r, 6).setValue(W_(payload));
    sh.getRange(r, 10).setValue(1);
    sh.getRange(r, 13).setValue(now);
    row[5] = W_(payload); row[9] = 1; row[12] = now;
    bumpVer_();
    return { ok: true, msg: msgOut_(row, uid) };
  });
}

function del_(req, uid) {
  return withLock_(function () {
    var sh = sheet_('Messages'), r = findRow_(sh, 1, req.id);
    if (!r) throw E_('not_found');
    var row = sh.getRange(r, 1, 1, 15).getValues()[0];
    if (String(row[2]) !== uid) throw E_('forbidden');
    var now = Date.now();
    sh.getRange(r, 6).setValue('');
    sh.getRange(r, 11).setValue(1);
    sh.getRange(r, 13).setValue(now);
    row[5] = ''; row[10] = 1; row[12] = now;
    var fid = String(row[14] || '');
    if (fid) {
      var fsh = sheet_('Files'), fr = findRow_(fsh, 1, fid);
      if (fr) {
        try { DriveApp.getFileById(String(fsh.getRange(fr, 2).getValue())).setTrashed(true); } catch (e) { /* already gone */ }
      }
    }
    bumpVer_();
    return { ok: true, msg: msgOut_(row, uid) };
  });
}

function star_(req, uid) {
  return withLock_(function () {
    var sh = sheet_('Messages'), r = findRow_(sh, 1, req.id);
    if (!r) throw E_('not_found');
    var row = sh.getRange(r, 1, 1, 15).getValues()[0];
    if (String(row[2]) !== uid && String(row[3]) !== uid) throw E_('forbidden');
    var list = String(row[11] || '').split(',').filter(function (x) { return x; });
    var i = list.indexOf(uid);
    if (req.on && i < 0) list.push(uid);
    if (!req.on && i >= 0) list.splice(i, 1);
    var now = Date.now();
    row[11] = list.join(','); row[12] = now;
    sh.getRange(r, 12).setValue(row[11]);
    sh.getRange(r, 13).setValue(now);
    bumpVer_();
    return { ok: true, msg: msgOut_(row, uid) };
  });
}

// ====== PROFILE ======
function profile_(req, uid) {
  return withLock_(function () {
    var sh = sheet_('Users'), r = findRow_(sh, 1, uid);
    if (!r) throw E_('not_found');
    function chk(v, max) { v = String(v); if (v.length > max) throw E_('too_big', 'Data bahut bada hai'); return v; }
    if (req.nameEnc !== undefined) sh.getRange(r, 5).setValue(W_(chk(req.nameEnc, 2000)));
    if (req.aboutEnc !== undefined) sh.getRange(r, 6).setValue(W_(chk(req.aboutEnc, 4000)));
    if (req.photoEnc !== undefined) sh.getRange(r, 7).setValue(W_(chk(req.photoEnc, 45000)));
    var now = Date.now();
    sh.getRange(r, 10).setValue(now);
    cache_().put('pv', String(now), 21600);
    return { ok: true, me: userOut_(sh.getRange(r, 1, 1, 10).getValues()[0]), pv: String(now) };
  });
}

// ====== FILES (encrypted bytes in Drive) ======
function upload_(req, uid) {
  var data = String(req.data || '');
  if (!data || data.length > MAX_UPLOAD_B64) throw E_('too_big', 'File bahut badi hai (max ~6 MB)');
  var bytes = Utilities.base64Decode(data);
  var fileId = 'f' + rnd_(14);
  var blob = Utilities.newBlob(bytes, 'application/octet-stream', fileId + '.enc');
  var file = getFolder_().createFile(blob);
  withLock_(function () {
    sheet_('Files').appendRow([fileId, file.getId(), '', uid, '', bytes.length, Date.now()]);
  });
  return { ok: true, fileId: fileId };
}

function file_(req, uid) {
  var fsh = sheet_('Files'), fr = findRow_(fsh, 1, req.fileId);
  if (!fr) throw E_('not_found');
  var row = fsh.getRange(fr, 1, 1, 7).getValues()[0];
  if (String(row[3]) !== uid && String(row[4]) !== uid) throw E_('forbidden');
  var bytes = DriveApp.getFileById(String(row[1])).getBlob().getBytes();
  return { ok: true, data: Utilities.base64Encode(bytes) };
}

