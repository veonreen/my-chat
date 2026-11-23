'use strict';
/**
 * Galaxy Relax v4 "fresh start": deletes ALL messages, files and reactions, clears the encrypted profile fields
 * (they were encrypted with the old key), ends every session, drops the old key material, and installs the new
 * per-install salt + check value. The 2 user accounts (username + password hash) are KEPT.
 *
 *   CONFIRM=yes node fresh-start.js <dataDir> <ksalt: 32 hex chars> <kc: check value from the app>
 *
 * ksalt and kc are computed on the owner's own PC from the unlock code (the code itself never goes to the server).
 * ALWAYS take a backup first (sudo /docker/mychat/backup.sh).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const [dataDir, ksalt, kc] = process.argv.slice(2);
if (process.env.CONFIRM !== 'yes') { console.error('Refusing to run without CONFIRM=yes'); process.exit(2); }
if (!dataDir || !/^[a-f0-9]{32}$/.test(ksalt || '') || !kc || kc.length > 500) { console.error('usage: CONFIRM=yes node fresh-start.js <dataDir> <ksalt 32 hex> <kc>'); process.exit(2); }

const db = new Database(path.join(dataDir, 'mychat.db'));
db.pragma('journal_mode = WAL');
const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const before = { users: count('users'), messages: count('messages'), files: count('files'), sessions: count('sessions') };

db.transaction(() => {
  db.exec('DELETE FROM messages; DELETE FROM files; DELETE FROM sessions;');
  const now = Date.now();
  db.prepare("UPDATE users SET nameEnc='', aboutEnc='', photoEnc='', profUpd=?").run(now);
  db.prepare("DELETE FROM meta WHERE key IN ('proofHash','sc','ksalt','kc','kver')").run();
  const set = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  set.run('ksalt', ksalt); set.run('kc', kc); set.run('kver', '1'); set.run('pv', String(now));
})();

const dir = path.join(dataDir, 'files');
let removed = 0;
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (e) { /* ignore */ } }
db.exec('VACUUM');

const after = { users: count('users'), messages: count('messages'), files: count('files'), sessions: count('sessions') };
console.log(JSON.stringify({ before, after, fileBlobsRemoved: removed }));
db.close();
