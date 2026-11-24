# 🌌 Galaxy Relax (MyChat) — Private Encrypted Chat, ek 3D relax app ke peeche chhupa hua — v5

Bahar se ye ek shaant **3D relax app** hai (tairte hue planets, baadal ya raat ka aasmaan). Andar **sirf 2 log** ka private chat hai.
Messages, photos, files aur profile **aapke browser me hi encrypt** hote hain. Server ko sirf ciphertext milta hai.

Ek khufiya **unlock code** type karne par asli chat khulta hai, aur app chhodte hi wapas aasmaan dikhne lagta hai.

🌐 **Live app:** https://veonreen.github.io/my-chat/
🖥️ **Backend (VPS):** https://chat.srv1898582.hstgr.cloud
📦 **Code:** https://github.com/veonreen/my-chat

**Poora app UI English me hai. Ye README Hinglish me hai.**

---

## 🚀 Kaise use karein

1. Dono users app kholo: https://veonreen.github.io/my-chat/ (Chrome me menu → **Add to Home screen** se install karo).
2. **Log in** karo (username + password). Naya user ho to **Join** dabao (username, naam, password). **Ab koi Secret Key nahi hai.**
   **v5:** login **din mein sirf 1 baar** hota hai. Raat **12 baje (midnight IST)** tak login chalta hai, uske baad dobara login. Baaki time app **seedha planet screen (aasmaan)** par khulta hai, bas code type karo.
3. Aasmaan dikhega. Neeche **"Name your planet..."** box asal me unlock box hai. **Unlock code** wahan type karo, chat turant khul jayega (Send/Enter nahi dabana).
4. Settings → **Notifications** on karo. App band hone par bhi "🌟 A new star is shining" aayega.

> ⚠️ **Unlock code hi encryption key hai.** Bhool gaye to purane messages kabhi wapas nahi aa sakte (na main, na server). Code is README me jaanbujh kar nahi likha, kyunki repo public hai. Isko kahin safe likh lo.

---

## 🕶️ Stealth Mode — kaise kaam karta hai

| Step | Kya hota hai |
|---|---|
| 1. App kholo | Naam, icon, title, splash sab **Galaxy Relax**. Login screen par koi "chat" jaisa shabd nahi. |
| 2. Login | Username + password. |
| 3. Aasmaan (decoy) | Asli **3D** aasmaan. **Ungli se ghumao**, **do ungli se zoom**, **planet par tap** karo to chhota effect. Door ke planets dheere aur blur, paas ke tez, to gehrai (parallax) dikhti hai. |
| 4. Unlock code | "Name your planet..." box me code type karo. Box me **normal text** dikhta hai, par autocomplete / autocorrect / spellcheck / keyboard suggestions **band** hain. Match hote hi box khali ho jata hai aur chat khulta hai. |
| 5. Galat text | Kuch nahi hota (na error, na awaaz). |
| 6. Chat khula hai | Jab tak app chhodo nahi, sab chalta rehta hai. |
| 7. Auto-hide | App band, tab/app badla, screen off, window blur => **turant** aasmaan par wapas. |
| 8. Panic | **Phone hilao (shake)** ya **header / khali chat background par 3 second daba ke rakho** => turant aasmaan. Message par chhota long-press (menu) pehle jaisa chalta hai. Menu me **"Back to the sky"** bhi hai. **v5:** phone par ye hold ab touch events se chalta hai, daba ke rakhne par ek **progress ring** bharta dikhta hai, aur ungli thodi hilne se hold nahi tootta (bahut door khiski to cancel). |

- Jab aasmaan dikh raha hai, **chat ka koi message page (DOM) me hota hi nahi**. Poora chat wala hissa page se hata diya jata hai.
- Notification dabane par bas app aage aata hai. **Chat seedha nahi khulta**, code phir bhi type karna padta hai.
- Aasmaan par naya message aaye to ek **sunehra taara chamakta** hai (ye sirf ginti se pata chalta hai, decrypt nahi hota).
- Icon par unread number/badge kabhi nahi aata. Aap aasmaan par ho to dusre ko aap "online" nahi dikhte.

### Themes (Settings → Appearance)
- **Light (default)**: "Ivory Luxury". Ivory/cream, champagne gold sirf accents me. Subah ka aasmaan (halka neela → pink → peach), pastel matte planets, behte baadal, halke roshni ke kan. Chat me frosted-glass bubbles.
- **Dark**: "Black & Gold". Gehra kaala, gold bahut kam. Raat ka asli aasmaan (halki Milky Way, hazaaron taare). Glass bubbles par halka gold kinara.
- **Auto**: **6 AM se 7 PM Light**, raat ko Dark.
- Desktop par apna layout: **side rail + ek bada conversation card + profile card** (list pane nahi, kyunki baat sirf ek insaan se hai).

### v5 me naya
- **Aasmaan (approved animation):** 4 asli planets (chhalle wala gas giant, samundar wala planet + chaand, craters wala patthar, barfeela chhota planet), door ke dhundhle planets, taare, shooting stars. **60 fps target**: phone slow ho to resolution aur effects **apne aap** halke ho jate hain, jagah milte hi wapas badh jate hain. **Phone tilt karo** to aasmaan halka sa ghoomta hai (parallax).
- **Ivory Rose Luxury** default theme (Light) aur gehra Dark theme. Dono me text aur bubbles ka contrast badhaya gaya hai.
- **Composer upar:** message box thoda upar uthaya, neeche ki patli line aur typing ke time ki outline hata di.
- **Jump to latest:** purane messages padhte waqt neeche ek chhota ⬇ button aata hai, dabate hi latest par chala jata hai.
- **Right panel (desktop):** photos na hon to "No shared photos yet".
- **30 minute auto-clear (sirf device se):** jo message **seen** ho chuka hai, wo seen hone ke **30 minute baad** is phone ki screen aur memory se hat jata hai. Unseen message kabhi nahi hatta. **Server par sab safe rehta hai**, code dobara type karte hi sab wapas aa jata hai (naye 30 minute ke saath).

### Mazedaar chat
- Naya message **pop/bounce** ke saath, bhejte waqt **whoosh** sound.
- **Double-tap** => ❤️ udta hai. **Long-press** => 😂 🔥 👍 😮 😢 ❤️ reactions. Reactions bhi **encrypted**.
- **Word effects**: "happy birthday" => confetti, "love" => hearts ki baarish, "congrats" => fireworks. (Settings me band kar sakte ho.)
- Typing bubble (teen uchalte dot), sound effects on/off.

---

## 🔐 Encryption aur Security (sach-sach)

**Unlock code = encryption key**
- Key = **Argon2id** (64 MiB memory, 3 rounds, 1 lane; browser me ek Web Worker me, to screen nahi atakti) se **unlock code + fixed app salt + per-install random salt** se banti hai. Phir AES-GCM-256 (Web Crypto, non-extractable).
- **Code ya uska koi hash server ko kabhi nahi jaata.** Server ke paas sirf: random **per-install salt**, ek chhoti **encrypted "check" value**, aur key version number. Code sahi hai ya nahi, ye phone par hi us check value ko decrypt karke pata chalta hai.
- **Key sirf memory me** rehti hai. Lock / reload / logout par bhool jati hai. Device par kuch bhi save nahi hota, sirf code ki **lambai** (kitne letters), taaki pata chale kab try karna hai. Ek hi session me dobara unlock **turant** (memory me ek throw-away check se), pehli baar Argon2 ke kaaran ~0.5 sec lagta hai.
- Message ka encryption **message-id ke saath bind** (AAD), reaction **(message-id, reactor)** ke saath. Koi ciphertext idhar-udhar nahi badal sakta.
- **Encrypted:** message text, reply preview, file naam/size/type, photos, documents, voice, reactions, profile naam/about.
- **Server ko plain dikhta hai:** username, kisne kisko bheja, kab bheja, ticks, file ka size. "Kya likha" nahi dikhta.
- **Web Push me message text ya sender ka naam nahi** hota. Hamesha "🌟 A new star is shining".

**Code kitna lamba ho (zaroori)**
- Code chhota ho to kamzor key hai. Agar kisi ko database ya backup ki copy mil jaye, wo offline guesses laga sakta hai. Argon2id guess ko **dheema** karta hai, **rok nahi sakta**. Isliye **12 ya zyada characters** rakho (symbol + naam + digits mila ke). Per-install random salt ye ensure karta hai ki guesses har install ke liye alag se karne padte hain.
- Server ko pehle se pata hone wali cheez (check value) aur lambai ka andaza hi sabse kamzor kadi hai. **Is wajah se code ko kahin type/share mat karo.**

**Change secret code (Settings)**
- Code = key, to **sab kuch re-encrypt** hota hai: messages, reactions, profile, files. Order: sab kuch padho (dump) → purani key se decrypt → nayi key se encrypt → files "parked" → ek hi **atomic commit** server par. Is dauran koi naya message aa jaye to commit mana ho jata hai ("stale") aur app dobara shuru karta hai. Beech me fail ho to kuch nahi bigadta (server commit par hi badalta hai).
- Dusre phone ko turant pata chal jata hai, wo **lock ho jata hai** aur naya code poochta hai (wo code aap dono ko khud ek doosre ko batana hai).

**App Lock**
- **v5: Din ka login.** Session **raat 12 baje (IST) tak** chalta hai. Token device par rehta hai, par ek **non-extractable key** se seal hokar (koi use nikaal ke copy nahi kar sakta). Isliye din me app seedha aasmaan par khulta hai. **Unlock code / encryption key ab bhi sirf memory me** rehti hai, kabhi save nahi hoti.
- App background me jaye / screen off ho => chat turant chhup jata hai (aasmaan), key memory se hat jati hai. Wapas aane par bas code type karo, login nahi.
- **Logout** (ya midnight ke baad) par sab local data, saved session aur push subscription hat jati hai.
- Server **har request par session dobara check** karta hai (socket par bhi). Password badalne par dusre devices ke session turant band.
- Signup par ab koi key nahi poochi jati, isliye teesra insaan tabhi signup kar sakta hai jab 2 se kam users hon. Abhi dono accounts ban chuke hain (`MAX_USERS = 2`), to signup band hai.

**Server (VPS) hardening**
- **UFW firewall:** ports 22, 80, 443. **SSH:** sirf key, root/password login band. **Fail2ban**, **automatic security updates**.
- **Node app non-root**, **Docker**: read-only filesystem, capabilities band, memory limit 512 MB, koi port internet par expose nahi (sirf Traefik se HTTPS).
- **Rate limit:** login (20 / 10 min / IP), signup (8 / ghanta / IP), username lockout (8 galat => 10 min). CORS sirf `https://veonreen.github.io`.
- **Daily encrypted backup:** roz 03:00 IST, `age` (public-key) se encrypt, 14 din. **Private key sirf owner ke PC par** (`C:\Users\<aap>\mychat-backup-private-key.txt`).
- **v4 fresh start ke purane backups** (jo purane messages rakhte hain) naye system ke test hone ke **7 din baad apne aap delete** ho jate hain (`/etc/cron.d/mychat-purge-prev4`).

---

## ✨ Features

| Feature | Kaise kaam karta hai |
|---|---|
| Login / Join | Username + password. Password browser me PBKDF2 se stretch, server par **scrypt** hash. Session agli midnight (IST) tak. Max **2 users**. |
| Realtime | WebSocket (Socket.io): message / tick / typing / online turant. Net toote to reconnect + catch-up. |
| Ticks | ✓ sent, ✓✓ delivered, ✓✓ (rang) dekha |
| Header | Naam normal case me, "online" ya "last seen today at 7:34 am" |
| Reply, Copy, Star, Edit | Swipe / long-press / right-click. Edit 15 minute tak |
| Delete for everyone | Dono taraf se hat jata hai, file bhi VPS se |
| Photos, Documents, Voice | Auto compress + encrypt, ~6 MB tak |
| Reactions, word effects, sounds | Upar "Mazedaar chat" dekho |
| Avatars | Saaf initial-letter avatars (photo upload nahi) |
| Stealth Mode | Upar dekho |
| Themes | Light / Dark / Auto |
| Notifications | **App band ho to Web Push (VAPID)**, hamesha "A new star is shining" |
| PWA | Install, shell offline khulta hai |

---

## 🧱 Kaise bana hai

```
 Browser (GitHub Pages, vanilla JS PWA)           encrypt/decrypt yahin hota hai
     │  WSS / HTTPS
     ▼
 Traefik (pehle se VPS par, auto Let's Encrypt SSL)
     ▼
 mychat container (Node.js + Express + Socket.io + SQLite)
     ├─ /data/mychat.db      (users, ciphertext messages, sessions, push subs, salt + check value)
     ├─ /data/files/         (encrypted attachments)
     └─ Web Push (VAPID) ──► browser push service ──► phone/PC notification
```

```
my-chat/
├─ docs/                  ← Frontend (GitHub Pages)
│  ├─ index.html, css/style.css, sw.js, manifest.webmanifest, icons/, fonts/
│  └─ js/  config icons util crypto api emoji fx app chat stealth boot kdf-worker   vendor/ (socket.io, argon2, galaxy3d)
├─ server/                ← Backend (VPS par Docker me)
│  ├─ server.js, backup.js, backup.sh, Dockerfile, docker-compose.yml
│  ├─ test/ (e2e, push, chpw, react, rekey, session)   tools/ (decrypt-backup.mjs, fresh-start.js)
├─ tools/galaxy3d/        ← 3D aasmaan ka source + build script
├─ backend/               ← PURANA Apps Script backend (reference)
└─ README.md
```

---

## 🛠️ Developer: change karke dobara deploy kaise karein

**Frontend** (`docs/`):
```bash
git add -A && git commit -m "change" && git push      # 1-2 minute me GitHub Pages par live
```
Naya version sab devices par bhejna ho to `docs/sw.js` me `CACHE = 'galaxy-vN'` aur `docs/js/config.js` me `MYCHAT_VERSION` badlo.
**3D aasmaan** badalna ho to `tools/galaxy3d/galaxy.src.js` edit karo, phir `cd tools/galaxy3d && npm init -y && npm i three esbuild && node build.cjs`. Icons Lucide (`docs/js/icons.js`), fonts Sora + Manrope (`docs/fonts/`, khud hosted), Argon2 = hash-wasm (`docs/js/vendor/argon2.js`, MIT).

**Backend** (`server/`):
```bash
cd server
tar czf /tmp/s.tgz --exclude=node_modules --exclude=data --exclude=test package.json package-lock.json server.js backup.js Dockerfile docker-compose.yml .dockerignore
scp -i ~/.ssh/mychat_vps /tmp/s.tgz mychat@<VPS-IP>:/docker/mychat/src.tgz
ssh -i ~/.ssh/mychat_vps mychat@<VPS-IP> 'cd /docker/mychat && tar xzf src.tgz && rm src.tgz && sudo docker compose build && sudo docker compose up -d'
```
Sirf `mychat` container dobara banta hai. n8n / Evolution API / Traefik ko koi asar nahi. (VPS par docker ke liye `sudo` lagta hai.)

**Naya salt + check value banana (fresh start ya naya install):** apne PC par code se `ksalt` (32 hex) aur `kc` banao (app ke `crypto.js` jaisa Argon2id), phir VPS par
`CONFIRM=yes node tools/fresh-start.js /data <ksalt> <kc>` (container ke andar). Ye **sab messages/files/reactions/sessions** hata deta hai aur 2 accounts rakhta hai. **Pehle backup lo.** Code VPS par kabhi nahi jaata, sirf `ksalt` aur `kc`.

**Useful commands (VPS par):**
```bash
sudo docker logs -f mychat
sudo /docker/mychat/backup.sh                  # abhi backup lo
sudo fail2ban-client status sshd
```

**Backup restore (apne PC par):**
```bash
scp mychat@<VPS-IP>:/docker/mychat/backups/mychat-<date>.tar.gz.age .
cd server && npm install --no-save age-encryption
node tools/decrypt-backup.mjs ../mychat-<date>.tar.gz.age out.tar.gz
tar xzf out.tar.gz        # backups/snap-*.db (SQLite) + files/
```

**Tests (apne PC par, local):**
```bash
cd server && npm install --no-save socket.io-client@4
node test/e2e.js     # 47: login/join, realtime, ticks, files, rate-limit
node test/react.js   # 15: reactions, purani DB ka migration, push text
node test/rekey.js   # 30: key material, dump/rekey (atomic), stale, fresh-start tool
node test/chpw.js    # 17: password change, session revocation, lockout
node test/push.js    # 9: Web Push
node test/session.js # 8: v5 login midnight IST par khatam
```

**UI test (headless Chrome, 2 phones, local server; live ko nahi chhuta):** `tools/ui-test/ui5.cjs` (27 checks: sky, unlock, 30-min clear, jump button, 3-sec hold + ring, tilt, themes, desktop). Chalane ke liye `puppeteer-core` chahiye:
```bash
TEST_NODE_MODULES=<puppeteer-core wala folder> node tools/ui-test/ui5.cjs
```

---

## ❓ Dikkat aaye to

| Problem | Solution |
|---|---|
| "Connecting…" banner | Net check karo. App khud reconnect karta hai |
| "Cannot reach the server" | `sudo docker ps` me `mychat` healthy hai? `sudo docker logs mychat` |
| Code type karne par kuch nahi hota | Galat code, ya pehli baar ~0.5 sec lagta hai. Ek hi session me dobara turant khulta hai |
| Chat me "Could not be decrypted" | Us phone par purana code/key chal rahi hai. Lock karo, login karo, naya code type karo |
| Dusre phone ne code badla | Aapka phone lock ho jata hai. Login karke **naya code** type karo (dusre se pucho) |
| Login screen aa gaya | v5 me login raat 12 baje (IST) khatam hota hai. Din me ek baar login karo, baaki din seedha aasmaan |
| Purane messages screen se gayab | 30 minute auto-clear (seen ke baad). Server par safe hain, code dobara type karo |
| Dono phones par purana version | Settings ke neeche "Galaxy Relax v..." (abhi 5.0.0). App band karke kholo |
| App band hone par notification nahi | Settings → Notifications on? iPhone par pehle "Add to Home Screen" |
| "This galaxy already has two explorers" | Limit 2 users (`MAX_USERS` in `server/server.js`) |

---

## ⚙️ Limits

- Sirf 2 users, 1 chat. Message 4000 characters tak; file ~6 MB tak.
- Notifications ke liye phone/browser ka push service chahiye, isliye net zaroori hai.
- Is VPS par n8n aur client ki Evolution API bhi chal rahi hain. Chat app unse alag container me hai, par CPU/RAM share hota hai.
