// Backup kholne ka tareeka (apne PC par):
//   cd server && npm install --no-save age-encryption
//   node tools/decrypt-backup.mjs <mychat-....tar.gz.age> <output.tar.gz> [private-key-file]
// Phir:  tar xzf output.tar.gz   -> backups/snap-*.db (SQLite) + files/ (encrypted attachments)
import { Decrypter } from 'age-encryption';
import fs from 'fs';
import os from 'os';
import path from 'path';

const [, , input, output, keyFile] = process.argv;
if (!input || !output) { console.error('usage: node decrypt-backup.mjs <in.age> <out.tar.gz> [private-key-file]'); process.exit(2); }
const kf = keyFile || path.join(os.homedir(), 'mychat-backup-private-key.txt');
const identity = fs.readFileSync(kf, 'utf8').split('\n').map((l) => l.trim()).find((l) => l.startsWith('AGE-SECRET-KEY-'));
if (!identity) { console.error('private key nahi mili in', kf); process.exit(1); }
const d = new Decrypter();
d.addIdentity(identity);
const plain = await d.decrypt(new Uint8Array(fs.readFileSync(input)));
fs.writeFileSync(output, plain);
console.log('decrypted ->', output, plain.length, 'bytes');
