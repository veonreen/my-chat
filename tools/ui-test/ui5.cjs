/* Galaxy Relax v5 UI test (headless Chrome, two phones, a real local server).
 * Needs: puppeteer-core + Chrome. Usage:
 *   TEST_NODE_MODULES=<folder with puppeteer-core> CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/ui-test/ui5.cjs
 * Starts server/server.js on a temp data folder and serves docs/ itself; nothing here touches the real server. */
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(path.join(process.env.TEST_NODE_MODULES || '', 'puppeteer-core'));
const ROOT = path.join(__dirname, '..', '..');
const API_PORT = 3981, WEB_PORT = 8091, CODE = 'TestCode#2026';
const OUT = process.env.SHOTS || path.join(os.tmpdir(), 'ui5-shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', n, c ? '' : JSON.stringify(x ?? '').slice(0, 240)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mychat-ui5-'));
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, PORT: API_PORT, DATA_DIR: data, ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT}` }, stdio: ['ignore', 'inherit', 'inherit'] });
  const web = http.createServer((q, s) => {
    let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/js/config.js') { s.setHeader('Content-Type', 'text/javascript'); return s.end(`window.MYCHAT_API="http://127.0.0.1:${API_PORT}";window.MYCHAT_VERSION="5.0.0";`); }
    const f = path.join(ROOT, 'docs', p);
    if (!f.startsWith(path.join(ROOT, 'docs')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.statusCode = 404; return s.end('nf'); }
    s.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); s.setHeader('Service-Worker-Allowed', '/'); fs.createReadStream(f).pipe(s);
  }).listen(WEB_PORT);
  await sleep(4500);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  async function phone(name) {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
    await p.emulate({ viewport: MOBILE, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36' });
    await p.evaluateOnNewDocument(() => { document.hasFocus = () => true; window.__ev = []; ['touchstart','touchmove','touchend','touchcancel','contextmenu','pointercancel','pointerdown','pointerup','blur','visibilitychange'].forEach((n) => window.addEventListener(n, (e) => window.__ev.push(Math.round(performance.now()) + ':' + n + (e.touches ? '[' + e.touches.length + ',' + (e.target.tagName || '') + '.' + (e.target.className || '') + ']' : '')), true)); });
    p.on('pageerror', (e) => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', (m) => { const x = m.text(); if (m.type() === 'error' && !/favicon|Failed to load resource|WebGL|GPU stall|swiftshader/i.test(x)) errs.push(name + ' console: ' + x.slice(0, 200)); });
    p.on('dialog', (d) => d.dismiss());
    return { ctx, p };
  }
  const wf = (p, fn, ms = 20000, arg) => p.waitForFunction(fn, { timeout: ms, polling: 100 }, arg);
  const url = `http://127.0.0.1:${WEB_PORT}/index.html`;
  const state = (p) => p.evaluate(() => window.MC && MC.stealth ? MC.stealth.state() : 'none');
  async function signup(p, user, name) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await wf(p, () => !document.getElementById('auth').classList.contains('hidden'));
    await p.click('#tab-signup'); await p.type('#f-user', user); await p.type('#f-name', name); await p.type('#f-pass', 'secret-pass-1');
    await p.click('#auth-submit');
    await wf(p, () => MC.stealth && MC.stealth.state() === 'decoy', 40000);
  }
  async function unlock(p) { await p.click('#dc-input'); await p.type('#dc-input', CODE, { delay: 15 }); await wf(p, () => MC.stealth.state() === 'chat', 40000); }

  try {
    // ---------- A signs up, the sky shows ----------
    const A = await phone('A'), B = await phone('B'); const a = A.p, b = B.p;
    await signup(a, 'tester1', 'Alice');
    t('login lands on the sky (decoy)', (await state(a)) === 'decoy');
    await wf(a, () => { const s = MC.stealth.sky(); return s && s.ready(); }, 60000).catch(() => {});
    const st0 = await a.evaluate(() => { const s = MC.stealth.sky(); return s ? s.stats() : null; });
    t('3D sky is up: 5 world meshes baked', st0 && st0.ready && st0.planets === 4, st0);
    await a.screenshot({ path: path.join(OUT, 'a-sky-light.png') });

    // ---------- the day session is stored, and encrypted ----------
    const rec = await a.evaluate(async () => {
      const dbs = await new Promise((res) => { const r = indexedDB.open('mychat-day'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('k'); const o = tx.objectStore('k'); const g = o.get('s'), k = o.get('wk'); tx.oncomplete = () => { db.close(); res({ s: g.result, k: k.result }); }; }; r.onerror = () => res(null); });
      return dbs && { hasSession: !!dbs.s, bytes: dbs.s ? dbs.s.length : 0, keyType: dbs.k && dbs.k.type, extractable: dbs.k && dbs.k.extractable, plain: dbs.s ? new TextDecoder().decode(dbs.s).includes('token') : null };
    });
    t('day session is saved sealed with a non-extractable key', rec && rec.hasSession && rec.keyType === 'secret' && rec.extractable === false && rec.plain === false, rec);
    const exp = await a.evaluate(() => MC.S.exp), IST = 5.5 * 3600000;
    t('the session ends exactly at 00:00 IST', exp > Date.now() && exp - Date.now() <= 86400000 && ((exp + IST) % 86400000) === 0, exp);

    // ---------- first unlock (this code becomes the key), then B joins and unlocks ----------
    await unlock(a);
    t('typing the code opens the chat', (await state(a)) === 'chat');
    await sleep(900);
    t('decoy is gone after the warp (<= 700 ms window)', await a.evaluate(() => document.getElementById('decoy').classList.contains('hidden')));
    await a.evaluate(() => MC.stealth.hide('away'));
    t('hide: the private area is detached from the page', await a.evaluate(() => !document.getElementById('app')));
    await signup(b, 'tester2', 'Bob'); await unlock(b); await sleep(600);

    // ---------- reload: no login needed, straight to the sky ----------
    await a.reload({ waitUntil: 'domcontentloaded' });
    await wf(a, () => MC.stealth && MC.stealth.state() === 'decoy', 30000);
    t('after reload the app opens on the sky, no login screen', await a.evaluate(() => document.getElementById('auth').classList.contains('hidden')));
    t('...and the chat is still closed (no key in memory)', await a.evaluate(() => !MC.core.keyReady()));

    // ---------- warp timing ----------
    await a.click('#dc-input'); const t0 = Date.now(); await a.type('#dc-input', CODE, { delay: 10 });
    await wf(a, () => document.getElementById('decoy').classList.contains('hidden'), 40000);
    const warpMs = Date.now() - t0;
    t('chat open (sky dissolved)', (await state(a)) === 'chat');
    console.log('   (typing + Argon2 + warp took ' + warpMs + ' ms in this slow software renderer)');
    await sleep(500);

    // ---------- conversation, ticks, then the 30 minute clearing ----------
    await wf(a, () => MC.S.users.size === 2 && MC.S.current, 20000);
    await a.type('#input', 'hello from A'); await a.click('#btn-send');
    await wf(b, () => [...MC.S.byId.values()].some((m) => m.t === 'hello from A'), 20000);
    await wf(a, () => [...MC.S.byId.values()].some((m) => m.t === 'hello from A' && m.status === 2), 20000);
    t('B saw it: blue tick (status 2) with a seen time', await a.evaluate(() => { const m = [...MC.S.byId.values()].find((x) => x.t === 'hello from A'); return m.status === 2 && m.sAt > 0; }));
    await b.type('#input', 'reply from B'); await b.click('#btn-send');
    await wf(a, () => [...MC.S.byId.values()].some((m) => m.t === 'reply from B' && m.status === 2), 20000);
    await a.screenshot({ path: path.join(OUT, 'a-chat-light.png') });
    // nothing is cleared yet (only seconds have passed)
    await a.evaluate(() => MC.core.purgeExpired()); await sleep(300);
    t('fresh messages are not cleared', await a.evaluate(() => MC.S.byId.size === 2 && document.querySelectorAll('.row').length === 2));
    // 31 minutes later: sent one counts from the other person seeing it, received one from me seeing it
    await a.evaluate(() => { for (const m of MC.S.byId.values()) { m.sAt -= 31 * 60000; m._shown -= 31 * 60000; } });
    await a.evaluate(() => MC.core.purgeExpired()); await sleep(900);
    const cl = await a.evaluate(() => ({ n: MC.S.byId.size, rows: document.querySelectorAll('.row').length, pill: !!document.querySelector('.safe-pill'), text: document.body.innerText.includes('hello from A') || document.body.innerText.includes('reply from B'), tomb: MC.S.cleared.size }));
    t('after 30 min both seen messages leave the screen and memory', cl.n === 0 && cl.rows === 0 && !cl.text && cl.tomb === 2, cl);
    t('the "safe on the server" pill shows', cl.pill);
    await a.screenshot({ path: path.join(OUT, 'a-chat-cleared.png') });
    // a late reaction/update for a cleared message must not bring it back
    await b.evaluate(() => { const m = [...MC.S.byId.values()].find((x) => x.t === 'hello from A'); return MC.core.react(m, '❤️'); }); await sleep(1200);
    t('a live update does not resurrect a cleared message', await a.evaluate(() => MC.S.byId.size === 0));
    // unseen messages never clear: A goes back to the sky, B writes, A cannot have seen it
    await a.evaluate(() => MC.stealth.hide('away'));
    await b.type('#input', 'unseen one'); await b.click('#btn-send');
    await wf(a, () => [...MC.S.byId.values()].some((m) => m.t === 'unseen one'), 20000).catch(() => {});
    await a.evaluate(() => { for (const m of MC.S.byId.values()) { m.sAt -= 99 * 60000; m._shown = (m._shown || 0) - 99 * 60000; } });
    await a.evaluate(() => MC.core.purgeExpired()); await sleep(300);
    t('an unseen message is never cleared', await a.evaluate(() => { const m = [...MC.S.byId.values()].find((x) => x.t === 'unseen one'); return !!m && m.status < 2; }));
    // typing the code again brings everything back from the server
    await unlock(a); await sleep(700);
    const back = await a.evaluate(() => ({ n: MC.S.byId.size, rows: document.querySelectorAll('.row').length, pill: !!document.querySelector('.safe-pill'), texts: [...MC.S.byId.values()].map((m) => m.t).sort() }));
    t('unlock again: everything is back from the server', back.n === 3 && back.rows === 3 && !back.pill && back.texts.join('|') === 'hello from A|reply from B|unseen one', back);
    await a.screenshot({ path: path.join(OUT, 'a-chat-back.png') });

    // ---------- jump to latest ----------
    await a.evaluate(async () => { for (let i = 0; i < 28; i++) MC.core.sendText('filler message number ' + i + ' to make the list long'); });
    await sleep(2500);
    await a.evaluate(() => { const w = document.getElementById('msgs-wrap'); w.scrollTop = 0; w.dispatchEvent(new Event('scroll')); }); await sleep(500);
    t('scrolled up: the jump-to-latest button glides in', await a.evaluate(() => document.getElementById('scroll-down').classList.contains('on')));
    await a.screenshot({ path: path.join(OUT, 'a-jump.png') });
    await a.click('#scroll-down'); await sleep(1100);
    t('jump button glides to the bottom and goes away', await a.evaluate(() => { const w = document.getElementById('msgs-wrap'); return w.scrollHeight - w.scrollTop - w.clientHeight < 40 && !document.getElementById('scroll-down').classList.contains('on'); }));

    // ---------- 3 second press (touch) ----------
    const press = async (ms, move) => {
      const h = await a.touchscreen.touchStart(8, 500);
      await sleep(600); const ringOn = await a.evaluate(() => !!document.querySelector('.hold-ring.on'));
      if (move) await h.move(...move);
      await sleep(ms - 600); await h.end(); return ringOn;
    };
    let ring = await press(1200);
    t('a 1.2 s press shows the ring but does not hide', ring && (await state(a)) === 'chat');
    ring = await press(1200, [8 + 60, 500]);
    t('moving the finger far cancels', (await state(a)) === 'chat');
    await sleep(2500);
    const hh = await a.touchscreen.touchStart(8, 500); const trace = []; const t00 = Date.now(); for (let i = 0; i < 6; i++) { await sleep(500); trace.push((Date.now() - t00) + ':' + (await a.evaluate(() => MC.stealth.holding() + '/' + MC.stealth.state()))); } console.log('   hold trace', trace.join(' ')); await hh.move(14, 504); await sleep(500);
    const ringShot = await a.screenshot({ path: path.join(OUT, 'a-hold-ring.png') });
    await sleep(1500); await hh.move(11, 502); await sleep(1100);
    t('a 3 s press with a little finger wobble hides the chat', (await state(a)) === 'decoy', await state(a));
    if ((await state(a)) !== 'decoy') console.log('   events:', JSON.stringify(await a.evaluate(() => window.__ev.slice(-14))), 'now', await a.evaluate(() => Math.round(performance.now())));
    await hh.end().catch(() => {});
    t('...and nothing readable is left on the page', await a.evaluate(() => !document.getElementById('app') && !document.body.innerText.includes('hello from A')));
    // a press on the header works too
    await unlock(a); await sleep(900);
    const h2 = await a.touchscreen.touchStart(250, 48); await sleep(3300); await h2.end().catch(() => {});
    t('a 3 s press on the header hides too', (await state(a)) === 'decoy', await state(a));

    // ---------- tilt ----------
    await wf(a, () => { const s = MC.stealth.sky(); return s && s.ready(); }, 60000).catch(() => {});
    const tilt = await a.evaluate(async () => {
      const send = (g, b) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { gamma: g, beta: b, alpha: 0 }));
      send(0, 60); await new Promise((r) => setTimeout(r, 300)); send(24, 40); await new Promise((r) => setTimeout(r, 2500));
      const s1 = MC.stealth.sky().stats(); send(-24, 80); await new Promise((r) => setTimeout(r, 2500)); const s2 = MC.stealth.sky().stats();
      return { on: s1.tilt, x1: s1.vx, x2: s2.vx };
    });
    t('phone tilt moves the sky (left and right differ)', tilt.on && Math.abs(tilt.x1 - tilt.x2) > 0.25, tilt);

    // ---------- themes + desktop ----------
    await a.evaluate(() => MC.core.setTheme('dark')); await sleep(5000);
    await a.screenshot({ path: path.join(OUT, 'a-sky-dark.png') });
    await unlock(a); await sleep(900); await a.screenshot({ path: path.join(OUT, 'a-chat-dark.png') });
    await a.setViewport({ width: 1366, height: 820, deviceScaleFactor: 1, hasTouch: false });
    await sleep(1500);   // puppeteer reloads the page when touch emulation changes => the app opens on the sky again (by design): type the code again
    await unlock(a); await sleep(900); await a.screenshot({ path: path.join(OUT, 'a-desktop-dark.png') });
    await a.evaluate(() => MC.core.setTheme('light')); await sleep(900);
    await a.hover('#rail-sky'); await sleep(500); await a.screenshot({ path: path.join(OUT, 'a-desktop-light.png') });
    t('desktop rail has labels', await a.evaluate(() => document.querySelectorAll('.rail-btn .rl').length >= 5 && getComputedStyle(document.querySelector('.rail-btn .rl')).display !== 'none'));

    // ---------- forced logout clears the stored day session ----------
    await a.evaluate(() => MC.core.forceLogout('test'));
    await sleep(2500); await wf(a, () => !document.getElementById('auth').classList.contains('hidden'), 20000);
    t('forced logout: back at the login screen, stored session gone', await a.evaluate(async () => (await MC.cr.loadSession()) === null));
  } catch (e) { fail++; console.log('  FAIL test crashed:', e.message); }
  console.log(errs.length ? '\nconsole/page errors:\n' + [...new Set(errs)].join('\n') : '\nno console/page errors');
  if (errs.length) fail++;
  console.log(`\n${pass} passed, ${fail} failed   (screenshots: ${OUT})`);
  await browser.close().catch(() => {}); srv.kill(); web.close();
  process.exit(fail ? 1 : 0);
})();
