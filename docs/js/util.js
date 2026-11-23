/* Galaxy Relax: small helpers (DOM builder, icons, time, avatar, sound, haptics, toast) */
(function () {
  const MC = (window.MC = window.MC || {});
  const u = (MC.u = {});

  u.$ = (s, r) => (r || document).querySelector(s);
  u.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /** h('div', {class:'x', onclick:fn, dataset:{a:1}}, child, 'text', [more]) */
  u.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  };

  u.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  u.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  u.fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  u.mid = () => {
    const r = crypto.getRandomValues(new Uint8Array(8));
    return 'm' + Date.now().toString(36) + Array.from(r, (b) => (b % 36).toString(36)).join('');
  };
  u.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  u.isTouch = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;
  u.haptic = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } };

  // ---------- Icons: Lucide (js/icons.js), drawn as strokes ----------
  const ALIAS = { starO: 'star' };
  const AUTOFILL = { play: 1, pause: 1 };
  u.ic = (name, cls) => {
    const inner = (MC.ICONS || {})[ALIAS[name] || name] || '';
    return `<svg class="ic ${AUTOFILL[name] ? 'fill ' : ''}${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  };
  u.icon = (name, cls) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = u.ic(name, cls); return s; };

  // ---------- Time ----------
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  u.time = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  u.dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  u.dayLabel = (ts) => {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' });
    return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  };
  u.listTime = (ts) => {
    if (!ts) return '';
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    if (diff <= 0) return u.time(ts);
    if (diff === 1) return 'Yesterday';
    return new Date(ts).toLocaleDateString('en-GB');
  };
  u.lastSeen = (ts) => {
    if (!ts || ts < 1000) return '';
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
    if (diff <= 0) return 'last seen today at ' + u.time(ts);
    if (diff === 1) return 'last seen yesterday at ' + u.time(ts);
    return 'last seen ' + new Date(ts).toLocaleDateString('en-GB') + ' at ' + u.time(ts);
  };
  u.dur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- Avatar ----------
  const COLORS = ['#1FB5A3', '#5B8DEF', '#E26AB6', '#E8B44C', '#8B6CF0', '#2FA3C7', '#FF7A6B', '#6F7BE8', '#B58A6B', '#42A5C9'];
  u.colorFor = (s) => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  /** opts.teal => initials use the teal gradient from the stylesheet (chat header) instead of a per-user colour */
  u.fillAvatar = (el, user, opts) => {
    el.classList.add('avatar');
    el.textContent = '';
    const hasPhoto = !!(user && user.photo && /^data:image\//.test(user.photo));
    el.classList.toggle('photo', hasPhoto);
    if (hasPhoto) {
      const img = document.createElement('img');
      img.alt = ''; img.draggable = false;
      img.onerror = () => u.fillAvatar(el, Object.assign({}, user, { photo: '' }), opts);
      img.src = user.photo;
      el.append(img); el.style.background = '';
    } else {
      const name = (user && (user.name || user.username)) || '?';
      el.style.background = '';                    // the gradient comes from the stylesheet (theme aware)
      const s = document.createElement('span');
      s.textContent = Array.from(name.trim())[0] ? Array.from(name.trim())[0].toUpperCase() : '?';
      el.append(s);
    }
    return el;
  };
  u.avatar = (user, size) => { const d = document.createElement('div'); if (size) d.style.setProperty('--sz', size + 'px'); return u.fillAvatar(d, user); };

  // ---------- Rich text (links + search highlight) ----------
  function pushText(frag, s, q) {
    if (!s) return;
    if (!q) { frag.append(s); return; }
    const low = s.toLowerCase(), ql = q.toLowerCase();
    let i = 0, j;
    while ((j = low.indexOf(ql, i)) >= 0) {
      if (j > i) frag.append(s.slice(i, j));
      const mk = document.createElement('mark'); mk.textContent = s.slice(j, j + q.length); frag.append(mk);
      i = j + q.length;
    }
    if (i < s.length) frag.append(s.slice(i));
  }
  u.richText = (text, q) => {
    const frag = document.createDocumentFragment();
    const re = /((?:https?:\/\/|www\.)[^\s<>]+)/gi;
    let last = 0, m;
    while ((m = re.exec(text))) {
      let url = m[0], trail = '';
      const t = url.match(/[.,!?;:)\]}'"]+$/);
      if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
      pushText(frag, text.slice(last, m.index), q);
      const a = document.createElement('a');
      a.href = /^www\./i.test(url) ? 'https://' + url : url;
      a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
      frag.append(a);
      pushText(frag, trail, q);
      last = m.index + m[0].length;
    }
    pushText(frag, text.slice(last), q);
    return frag;
  };
  const EMO = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣|\s)+$/u;
  u.emojiOnly = (t) => {
    t = (t || '').trim();
    if (!t || t.length > 40 || !EMO.test(t)) return false;
    const n = window.Intl && Intl.Segmenter ? Array.from(new Intl.Segmenter().segment(t)).filter((x) => x.segment.trim()).length : Array.from(t).length;
    return n <= 3;
  };

  // ---------- Sound (synthesised, no files): pop / whoosh / reaction / sparkle / planet chime ----------
  let actx, noiseBuf;
  u.unlockAudio = () => {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ }
  };
  const tone = (f0, f1, t0, dur, vol, type) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.03);
  };
  u.sfx = (kind) => {
    if (!actx) return;
    try {
      const t = actx.currentTime;
      if (kind === 'in' || kind === 'pop') { tone(480, 900, t, 0.12, 0.2); tone(1180, 1180, t + 0.07, 0.1, 0.08); }
      else if (kind === 'out' || kind === 'whoosh') {
        if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.4, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
        const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
        s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.4;
        f.frequency.setValueAtTime(380, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.26);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.07); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        s.connect(f); f.connect(g); g.connect(actx.destination); s.start(t); s.stop(t + 0.32);
      }
      else if (kind === 'react') { tone(660, 990, t, 0.14, 0.14); tone(1320, 1320, t + 0.08, 0.16, 0.09); }
      else if (kind === 'sparkle') { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, f, t + i * 0.07, 0.22, 0.07)); }
      else if (kind === 'planet') { tone(523, 523, t, 0.7, 0.07); tone(784, 784, t + 0.04, 0.6, 0.05); tone(1047, 1047, t + 0.09, 0.5, 0.03); }
    } catch (e) { /* ignore */ }
  };
  u.beep = (kind) => u.sfx(kind);

  // ---------- Toast ----------
  u.toast = (msg, ms) => {
    const root = document.getElementById('toast-root');
    const el = u.h('div', { class: 'toast' }, msg);
    root.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms || 2600);
  };
})();
