# 💬 MyChat — Private End-to-End Encrypted Chat (2 users) — v2 (Realtime)

WhatsApp-Web jaisa premium private chat app. Sirf **2 log** chat kar sakte hain. Messages, photos, files aur profile
**aapke browser me hi encrypt** hote hain. Server ko sirf ciphertext milta hai.

v2 me polling hata di gayi: ab **WebSocket (Socket.io)** hai, to message ~**0.07 sec** me pahunchta hai (pehle 3–8 sec).

🌐 **Live app:** https://veonreen.github.io/my-chat/
🖥️ **Backend (VPS):** https://chat.srv1898582.hstgr.cloud
📦 **Code:** https://github.com/veonreen/my-chat

---

## 🚀 Kaise use karein (sabse pehle ye padho)

1. Dono users app kholo: https://veonreen.github.io/my-chat/
2. **Pehla user:** "Sign up" → username, password, display name, aur ek **Secret Key** chuno
   (kam se kam 6 characters, jitni lambi utni achhi. Jaise ek chhota sa vaakya).
3. **Dusra user:** "Sign up" → apna username/password, aur **WAHI SAME Secret Key** daalo.
   Galat key daaloge to server signup hi nahi karne dega ✅. Teesra insaan kabhi signup nahi kar sakta.
4. Mobile par: Chrome me menu → **"Install app" / "Add to Home screen"**.
5. Settings → **Notifications** on karo. Iske baad app band hone par bhi notification aayega (Web Push).
6. **App Lock (v2.1):** app band karke dobara khologe to har baar login screen aayegi (username + password). Secret Key dobara nahi poochi jaati, wo password se khul jaati hai. Neeche "App Lock" section padho.

> ⚠️ **Secret Key bhool gaye to purane messages wapas nahi aa sakte.** Isko kahin safe likh lo
> (par chat me mat daalo). Dono users ko ye key kisi aur raaste se (phone par, mil kar) batao.

---

## ⚡ Speed (live VPS par naapa gaya)

PC → internet → VPS (Traefik, HTTPS/WSS) → PC, 40 messages:

| Kya | Median | p95 |
|---|---|---|
| **Message delay** (A bheje → B ko mile) | **66 ms** | 81 ms |
| Server ack (delivered tick) | 66 ms | 81 ms |
| Blue tick (B ne dekha → A ko dikha) | 62 ms | 144 ms |
| Typing indicator | 63 ms | 72 ms |
| Online/offline change | ~58 ms | |
| Purana Apps Script (sirf **1 request**) | 2265 ms | 2630 ms |

(Purane app me poll ~2.5 sec par hota tha, to asli delay 3–8 sec tha.)

---

## ✨ Features

| Feature | Kaise kaam karta hai |
|---|---|
| Login / Signup | Username + password. Password browser me PBKDF2 se stretch hota hai, server par **scrypt** hash me store. Session token 30 din. Max **2 users**, uske baad signup band. |
| Realtime | WebSocket (Socket.io). Server naya message / tick / typing / online turant push karta hai. Net toote to apne aap reconnect + miss hua message catch-up. |
| Ticks | ✓ sent, ✓✓ delivered (receiver ka app connected), ✓✓ blue (chat khula hua dekha) |
| Typing / Online / Last seen | Header me "typing...", "online", "last seen today at 5:42 pm" |
| Reply, Copy, Star | Swipe (mobile) ya ⌄ / right-click (desktop). Star sirf apne liye |
| Edit | 15 minute tak (apne text messages) |
| Delete for everyone | Dono taraf se hat jaata hai, file bhi VPS se delete |
| Photos | Auto compress (max 1280px JPEG), caption ke saath |
| Documents | gzip compress + encrypt, max ~6 MB |
| Voice messages | Mic button dabao, record karo, bhejo |
| Emoji, links, search | Emoji panel, clickable links, sidebar + chat ke andar search |
| **App Lock** | Tab/app band karke kholo, ya 1 minute se zyada background me raho => auto-lock, login screen. Menu → "Lock app" se manual lock. Unlock = username + password |
| **Change password** | Settings → "Change password". Purana password server par verify hota hai, phir naya set. Is device ki vault naye password se re-encrypt hoti hai. Dusre devices ke session band ho jate hain |
| Notifications | App khula ho to sound + notification. **App band ho to Web Push (VAPID)** |
| Dark / Light | Upar 🌙 button, ya Settings me "System" |
| PWA | Install kar sakte ho, shell offline khulta hai |

---

## 🔐 Encryption aur Security (sach-sach)

**App ke andar**
- **E2EE:** AES-GCM-256 (Web Crypto). Key = **PBKDF2-SHA256 (250,000 rounds)** se "Secret Key" + random salt se banti hai.
- **Secret Key server ko kabhi nahi jaati.** Is device par key **non-extractable** form me IndexedDB me rehti hai.
- Message ka encryption **message-id ke saath bind** (AAD), to koi ciphertext idhar-udhar nahi badal sakta.
- **Encrypted:** message text, reply preview, file naam/size/type, photos, documents, voice, profile naam/about/photo.
- **Server ko plain dikhta hai:** username, kisne kisko bheja, kab bheja, ticks status, file ka size. "Kya likha" nahi dikhta, "kab aur kitna" dikh sakta hai.
- **Web Push me message ka text nahi hota** (server ko pata hi nahi). Sirf "🔒 Naya message" + sender ka username jaata hai.
- Signup par server ko Secret Key ka alag **derived proof (hash)** milta hai taaki bahari insaan 2nd user na ban sake. **Isliye lambi key rakho.**

**App Lock (v2.1) — kaise kaam karta hai**
- **Session token sirf memory me** rehta hai (JS variable). localStorage / IndexedDB me **save nahi** hota. Isliye tab/app band karte hi token chala jata hai.
- **Secret Key ek "vault" me**, jo tumhare **login password se encrypt** hota hai (PBKDF2-SHA256 250k rounds + AES-GCM, random salt). Login karte hi wahi password vault kholta hai, to Secret Key har baar nahi daalni padti. Password ke bina vault nahi khulta.
- **Auto-lock:** app 1 minute se zyada background me raha, ya laptop sleep se jaga => memory saaf (page reload) aur login screen. Background me jaate hi chat blur ho jata hai (app-switcher me dikhe nahi).
- **Lock != Logout.** Lock par vault bacha rehta hai (sirf password se khulta hai) aur **push subscription bachi rehti hai**, isliye notifications chalte rahte hain (unme message text hota hi nahi). **Logout** par vault, saved key, settings, notifications, push subscription sab is device se hat jata hai; dobara login par Secret Key daalni padegi.
- **Dhyan:** vault ka password-strength tumhare password par tika hai. Device kisi ke haath lag jaye to kamzor password brute-force ho sakta hai, isliye lamba password rakho. Sirf tab band/reload karne par browser server ko bata nahi sakta, to server par wo session bacha reh jata hai (par token browser me hai hi nahi, aur server max 5 sessions rakhta hai, 30 din me expire).
- **Change password (v2.2):** (1) vault purane password se khulta hai aur naye password se (naye salt ke saath) re-encrypt hone ke liye taiyar hota hai, (2) server purana password verify karke naya set karta hai (galat purana password dene par 8 koshish ke baad 10 min lockout), (3) tabhi naya vault store hota hai. Server mana kare to vault jaisa tha waisa rehta hai. **Dusre devices** ke session aur chalu sockets turant band ho jate hain (wahan naye password se login karna hoga, aur unki purani vault khulegi nahi, to ek baar Secret Key poochi jayegi). Is device ka session chalta rehta hai. Agar is device par vault nahi hai (remember off tha) to bas password badalta hai, vault nahi banti. Push subscription nahi hatti.
- Server ab **har request par session dobara check** karta hai (socket par bhi), isliye logout / password change ke baad purana chalu socket bhi turant band ho jata hai.
- Purane v2.0 ne token/key bina password ke rakhi thi: v2.1 pehle load par unhe hata deta hai. Update ke baad **ek baar Secret Key daalni padegi**, phir wo vault me yaad rahegi.

**Server (VPS) hardening**
- **UFW firewall:** sirf ports 22, 80, 443 khule (naye).
- **SSH:** sirf key se login. Password login band, root login band. Naya user `mychat` (sudo).
- **Fail2ban:** baar-baar galat SSH login karne wale IP 1 ghante ke liye block.
- **Automatic security updates** (unattended-upgrades). Kernel update ke baad reboot khud karna padta hai.
- **Node app non-root user** se, **Docker container** me: read-only filesystem, saari Linux capabilities band, memory limit 512 MB, koi port internet par expose nahi (sirf Traefik ke through HTTPS).
- **Rate limit:** login (20 / 10 min / IP), signup (8 / ghanta / IP), + username lockout (8 galat attempts => 10 min). Socket par flood guard. CORS sirf `https://veonreen.github.io`.
- **Daily encrypted backup:** roz 03:00 IST, `age` (public-key) se encrypt, 14 din rakhte hain. **Private key sirf owner ke PC par** (`C:\Users\<aap>\mychat-backup-private-key.txt`), server par sirf public key. Server hack ho jaye to bhi backup nahi khulte.

---

## 🧱 Kaise bana hai

```
 Browser (GitHub Pages, vanilla JS PWA)           encrypt/decrypt yahin hota hai
     │  WSS / HTTPS
     ▼
 Traefik (pehle se VPS par, auto Let's Encrypt SSL)   ← n8n jaisa hi, sirf Docker labels
     ▼
 mychat container (Node.js + Express + Socket.io + SQLite)
     ├─ /data/mychat.db      (SQLite: users, ciphertext messages, sessions, push subs)
     ├─ /data/files/         (encrypted attachments)
     └─ Web Push (VAPID) ──► browser push service ──► phone/PC notification
```

```
my-chat/
├─ docs/                  ← Frontend (GitHub Pages isi folder se chalta hai)
│  ├─ index.html, css/style.css, sw.js, manifest.webmanifest, icons/
│  └─ js/  config.js (backend URL) vendor/socket.io.min.js util.js crypto.js api.js emoji.js app.js chat.js boot.js
├─ server/                ← NAYA backend (VPS par Docker me)
│  ├─ server.js, backup.js, backup.sh, Dockerfile, docker-compose.yml
│  ├─ test/ (e2e.js, push.js)   tools/decrypt-backup.mjs
├─ backend/               ← PURANA Google Apps Script backend (ab use nahi hota, sirf reference)
└─ README.md
```

---

## 🛠️ Developer: change karke dobara deploy kaise karein

**Frontend badalna hai** (`docs/` ke andar):
```bash
git add -A && git commit -m "change" && git push
```
1-2 minute me GitHub Pages par live.
**Naya version sab devices par bhejna ho to:** `docs/sw.js` me `CACHE = 'mychat-vN'` aur `docs/js/config.js` me `MYCHAT_VERSION` badlo. Service worker purana cache delete karke naya laata hai, aur har file `no-cache` se revalidate hoti hai, to GitHub Pages ka 10 min cache bhi purana nahi dikhata.

**Backend badalna hai** (`server/`):
```bash
# apne PC se (SSH key: ~/.ssh/mychat_vps, user: mychat)
cd server
tar czf /tmp/s.tgz --exclude=node_modules --exclude=data --exclude=test package.json package-lock.json server.js backup.js Dockerfile docker-compose.yml .dockerignore
scp -i ~/.ssh/mychat_vps /tmp/s.tgz mychat@<VPS-IP>:/docker/mychat/src.tgz
ssh -i ~/.ssh/mychat_vps mychat@<VPS-IP> 'cd /docker/mychat && tar xzf src.tgz && rm src.tgz && sudo docker compose build && sudo docker compose up -d'
```
Sirf `mychat` container dobara banta hai. n8n / Evolution API / Traefik ko koi asar nahi.

**Useful commands (VPS par, `mychat` user se):**
```bash
sudo docker logs -f mychat                     # live logs
sudo docker compose -f /docker/mychat/docker-compose.yml restart mychat
sudo /docker/mychat/backup.sh                  # abhi backup lo
sudo fail2ban-client status sshd               # kaun block hua
sudo ufw status verbose
```

**Backup restore (apne PC par):**
```bash
scp mychat@<VPS-IP>:/docker/mychat/backups/mychat-<date>.tar.gz.age .
cd server && npm install --no-save age-encryption
node tools/decrypt-backup.mjs ../mychat-<date>.tar.gz.age out.tar.gz
tar xzf out.tar.gz        # backups/snap-*.db (SQLite) + files/
```
Restore ke liye: container band karo, `data/mychat.db` ko snap file se badlo, `data/files/` wapas rakho, container chalao.

**Tests (apne PC par, local):**
```bash
cd server && npm install --no-save socket.io-client@4
node test/e2e.js     # 44 checks: signup/login, realtime, ticks, files, rate-limit ...
node test/push.js    # 9 checks: Web Push (mock push service)
node test/chpw.js    # 17 checks: change password, session revocation, brute-force lockout
```

---

## ❓ Dikkat aaye to

| Problem | Solution |
|---|---|
| "Connecting…" banner | Net check karo. App khud reconnect karta hai aur miss hue messages laata hai |
| "Server se connect nahi ho pa raha" | `sudo docker ps` me `mychat` healthy hai? `sudo docker logs mychat` dekho |
| "Secret Key galat hai" | Dono users ki key bilkul same honi chahiye (capital/small letters bhi) |
| 🔒 "Message decrypt nahi ho paya" | Is device par galat Secret Key hai. Settings → "Secret Key dobara daalo" |
| "Ye private chat hai, 2 users already hain" | Limit 2 users ki hai (`MAX_USERS` in `server/server.js`) |
| Har baar login screen aati hai | Ye App Lock hai, jaan-boojh kar. Chahe to Settings me dekho: lock sirf band/1-min background par hota hai |
| Password badalne ke baad dusre phone par login screen | Ye jaanbujh kar hai (security). Wahan naye password se login karo aur ek baar Secret Key daalo |
| Login ke baad Secret Key poochta hai | Vault nahi mila (logout kiya tha, ya "Secret Key dobara daalo" dabaya). Daalo aur "yaad rakho" tick rakho |
| Dono phones par purana version | Settings ke neeche "MyChat v..." dekho (abhi 2.2.0). Purana ho to app band karke kholo; service worker ka `mychat-v4` cache naya version le aata hai |
| App band hone par notification nahi | Settings → Notifications on? Browser permission allow? iPhone par pehle "Add to Home Screen" zaroori hai |
| "Bahut zyada requests" | Rate limit laga hai, thodi der ruko |
| Naya user chahiye / sab reset | Pehle backup lo, phir `data/mychat.db` ke `users, messages, sessions, files, push_subs` tables khali karo aur `meta` me `proofHash, ksalt, kc` hatao (VAPID keys mat hatao) |

---

## ⚙️ Limits

- Sirf 2 users, 1 chat.
- Message 4000 characters tak; file ~6 MB tak.
- Notifications ke liye phone/browser ka push service (Google/Apple/Mozilla) chahiye, isliye net zaroori hai.
- Is VPS par n8n aur client ki Evolution API bhi chal rahi hain. Chat app unse alag container me hai, par CPU/RAM share hota hai.

Made with ❤️ — MyChat ka apna logo aur naam hai.
