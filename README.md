# 💬 MyChat — Private End-to-End Encrypted Chat (2 users)

WhatsApp-Web jaisa premium private chat app. Sirf **2 log** chat kar sakte hain. Messages, photos, files aur profile
**aapke browser me hi encrypt** hote hain. Google Sheet / Drive me sirf encrypted data jaata hai.

🌐 **Live app:** https://veonreen.github.io/my-chat/
📦 **Code:** https://github.com/veonreen/my-chat

---

## 🚀 Kaise use karein (sabse pehle ye padho)

1. Dono users app kholo: https://veonreen.github.io/my-chat/
2. **Pehla user:** "Sign up" → username, password, display name, aur ek **Secret Key** chuno
   (kam se kam 6 characters, jitni lambi utni achhi. Jaise ek chhota sa vaakya).
3. **Dusra user:** "Sign up" → apna username/password, aur **WAHI SAME Secret Key** daalo.
   Galat key daaloge to app signup hi nahi karne dega ✅
4. Ho gaya! Ab chat shuru karo.
5. Mobile par: Chrome me menu → **"Install app" / "Add to Home screen"** karo, to ye asli app jaisa chalega.

> ⚠️ **Secret Key bhool gaye to purane messages wapas nahi aa sakte.** Isko kahin safe likh lo
> (par chat me ya Sheet me mat daalo). Dono users ko ye key kisi aur raaste se (phone par, mil kar) batao.

---

## ✨ Features

| Feature | Kaise kaam karta hai |
|---|---|
| Login / Signup | Username + password. Password browser me PBKDF2 se stretch hota hai, server par **salted SHA-256** hash me store hota hai. Login par session token milta hai (30 din). |
| Real-time feel | Har 2-3 sec me polling (tab chhupa ho to 8 sec). |
| Ticks | ✓ sent, ✓✓ delivered, ✓✓ (blue) seen |
| Typing / Online / Last seen | Header me "typing...", "online", "last seen today at 5:42 pm" |
| Reply | Message par swipe karo (mobile) ya ⌄ / right-click (desktop) |
| Edit | 15 minute tak (apne text messages) |
| Delete for everyone | Dono taraf se hat jaata hai (file ho to Drive se bhi trash) |
| Copy, Star | Star kiye messages: ⭐ icon se dekho |
| Photos | Auto compress (max 1280px JPEG), caption ke saath |
| Documents | gzip compress + encrypt, max ~6 MB |
| Voice messages | Mic button dabao, record karo, bhejo |
| Emoji picker, links | Apna emoji panel; links clickable |
| Search | Sidebar me (chats + messages) aur chat ke andar (🔍) |
| Notifications + sound | Naye message par browser notification + tone |
| Dark / Light mode | Upar 🌙 button, ya Settings me "System" |
| Profile | Naam, photo, about (sab encrypted) |
| PWA | Install kar sakte ho, shell offline khulta hai |

---

## 🔐 Encryption aur Security (sach-sach)

- **E2EE:** AES-GCM-256 (Web Crypto). Key = **PBKDF2-SHA256 (250,000 rounds)** se "Secret Key" + random salt se banti hai.
- **Secret Key server ko kabhi nahi jaati.** Is device par key **non-extractable** form me IndexedDB me rehti hai.
- Message ka encryption **message-id ke saath bind** hai (AAD), to koi ciphertext idhar-udhar nahi badal sakta.
- Jo **encrypted** hai: message text, reply preview, file naam/size/type, photos, documents, voice, profile naam/about/photo.
- Jo **plain** dikhta hai (Sheet me): username, kisne kisko bheja (sender/receiver id), kab bheja, status (ticks), file ka size. Yaani "kya likha" nahi dikhta, "kab aur kitna" dikh sakta hai.
- Signup ke waqt server ko Secret Key ka ek alag **derived proof (hash)** milta hai, taaki bahari insaan 2nd user na ban sake. Isse Secret Key nahi nikalti, par agar key **bahut kamzor** hai to koi guess kar sakta hai. **Isliye lambi key rakho.**
- Notification (app band ho tab) ke liye "Web Push" server chahiye hota hai, jo is design me nahi hai. Notifications tab aate hain jab app/tab khula ho (background me bhi chalega).

---

## 🧱 Kaise bana hai

```
 Browser (GitHub Pages, vanilla JS PWA)
     │  encrypt/decrypt yahin hota hai
     ▼  POST (JSON)
 Google Apps Script Web App  ──►  Google Sheet (Users, Messages, Sessions, Files, Meta)
                              └─►  Google Drive folder "MyChat_Encrypted_Files" (sirf encrypted bytes)
```

```
my-chat/
├─ docs/                  ← Frontend (GitHub Pages isi folder se chalta hai)
│  ├─ index.html, css/style.css
│  ├─ js/  config.js (backend URL) util.js crypto.js api.js emoji.js app.js chat.js boot.js
│  ├─ sw.js, manifest.webmanifest, icons/
├─ backend/               ← Google Apps Script (clasp se push hota hai)
│  ├─ Code.gs, appsscript.json, .clasp.json
└─ README.md
```

**Google Sheet** ke tabs (apne aap ban jaate hain): `Users`, `Messages`, `Sessions`, `Files`, `Meta`.
Sheet me jo free-form strings hain unke aage `~` laga hota hai (taaki Google Sheets unhe formula na samjhe) — usko mat chhedna.

---

## 🛠️ Developer: change karke dobara deploy kaise karein

**Frontend badalna hai** (`docs/` ke andar):
```bash
git add -A && git commit -m "change" && git push
```
1-2 minute me GitHub Pages par live.

**Backend badalna hai** (`backend/Code.gs`):
```bash
cd backend
clasp push --force
clasp create-deployment -i AKfycbxFoTUW_bIo3a3qX-qS0zxZFtv4aoxg6M7HJRMuIjlm25JZLS5mW59d9zcwIBe9NmHD -d "naya version"
```
`-i` se **wahi URL** rehta hai, `docs/js/config.js` badalna nahi padta.
Pehli baar naye permission lage to Apps Script editor me `setup` function ek baar Run karo.

**Backend URL** `docs/js/config.js` me hai.

---

## ❓ Dikkat aaye to

| Problem | Solution |
|---|---|
| "Server ne galat jawab diya" / 403 | Apps Script → Deploy → Manage deployments → **Who has access = Anyone**, version = New version |
| "Secret Key galat hai" | Dono users ki key bilkul same honi chahiye (capital/small letters bhi) |
| 🔒 "Message decrypt nahi ho paya" | Is device par galat Secret Key hai. Settings → "Secret Key dobara daalo" |
| "Ye private chat hai, 2 users already hain" | Limit 2 users ki hai (`MAX_USERS` in `Code.gs`) |
| Message aane me 2-5 sec lagte hain | Google Apps Script ka apna latency hai. Normal hai |
| Naya user chahiye / sab reset | Sheet ke `Users, Messages, Sessions, Files, Meta` tabs me header ko chhod kar rows delete karo |

---

## ⚙️ Limits (Google Apps Script ki wajah se)

- Sirf 2 users, 1 chat.
- Message 4000 characters tak; file ~6 MB tak.
- Latency 2-5 sec (Apps Script ki base speed). Messages turant bubble me dikhte hain, ticks baad me aate hain.
- Free Google account ki daily quota hai; normal 2-person use ke liye kaafi hai.

Made with ❤️ — MyChat ka apna logo aur naam hai.
