'use strict';
// Usage: node backup.js /data/backups/snap.db  -> consistent SQLite snapshot (live DB ko rokay bina)
const Database = require('better-sqlite3');
const path = require('path');
const out = process.argv[2];
if (!out) { console.error('usage: node backup.js <out.db>'); process.exit(2); }
const db = new Database(path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'mychat.db'), { readonly: true, fileMustExist: true });
db.backup(out).then(() => { console.log('backup ok', out); db.close(); }).catch((e) => { console.error('backup failed', e.message); process.exit(1); });
