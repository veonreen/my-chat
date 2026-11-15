/* MyChat — small helpers: DOM builder, icons, time, avatar, sound, doodle wallpaper */
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

  // ---------- Icons (Material-style paths) ----------
  const P = {
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
    mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
    attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
    emoji: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-10c.83 0 1.5-.67 1.5-1.5S16.33 7 15.5 7 14 7.67 14 8.5s.67 1.5 1.5 1.5zm-7 0C9.33 10 10 9.33 10 8.5S9.33 7 8.5 7 7 7.67 7 8.5 7.67 10 8.5 10zm3.5 7.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    dcheck: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41z',
    clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    starO: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    doc: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
    down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
    up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z',
    bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
    logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
    eyeOff: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    key: 'M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    wifiOff: 'M24 8.98C20.93 5.9 16.69 4 12 4c-.99 0-1.96.09-2.9.25l2.2 2.2c.23-.01.46-.05.7-.05 3.5 0 6.67 1.4 8.98 3.67L24 8.98zM2.81 2.81 1.39 4.22l2.27 2.27C2.17 7.42.89 8.6 0 9.98l2 1.99C3 10.8 4.1 9.9 5.37 9.2l2.05 2.05A9.9 9.9 0 0 0 4 14l2 2c.9-.9 1.97-1.58 3.14-2l2.04 2.04c-.99.25-1.9.74-2.64 1.43L12 21l3.46-3.46 2.42 2.43 1.41-1.42L2.81 2.81z',
  };
  u.ic = (name, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || ''}"/></svg>`;
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
  const COLORS = ['#00a884', '#53bdeb', '#e26ab6', '#f5a623', '#7e57c2', '#26a69a', '#ef5350', '#5c6bc0', '#8d6e63', '#42a5f5'];
  u.colorFor = (s) => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  u.fillAvatar = (el, user) => {
    el.classList.add('avatar');
    el.textContent = '';
    if (user && user.photo && /^data:image\//.test(user.photo)) {
      const img = document.createElement('img');
      img.alt = ''; img.draggable = false;
      img.onerror = () => u.fillAvatar(el, Object.assign({}, user, { photo: '' }));  // toota photo => initials
      img.src = user.photo;
      el.append(img); el.style.background = '';
    } else {
      const name = (user && (user.name || user.username)) || '?';
      el.style.background = u.colorFor(user ? user.username : name);
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

  // ---------- Sound ----------
  let actx;
  u.unlockAudio = () => {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ }
  };
  u.beep = (kind) => {
    if (!actx) return;
    try {
      const t = actx.currentTime;
      const notes = kind === 'in' ? [[880, 0], [1318.5, 0.1]] : [[620, 0]];
      notes.forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(kind === 'in' ? 0.2 : 0.1, t + d + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
        o.connect(g); g.connect(actx.destination);
        o.start(t + d); o.stop(t + d + 0.22);
      });
    } catch (e) { /* ignore */ }
  };

  // ---------- Toast ----------
  u.toast = (msg, ms) => {
    const root = document.getElementById('toast-root');
    const el = u.h('div', { class: 'toast' }, msg);
    root.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms || 2600);
  };

  // ---------- Doodle wallpaper (our own icons, generated as SVG) ----------
  u.doodle = (color, opacity) => {
    const sh = [
      ['M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z', 20, 24, -12],
      ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', 88, 18, 14],
      ['M4 5h16v11H9l-5 4z', 150, 30, -8],
      ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14c1 2.5 7 2.5 8 0M9 9.5v.5M15 9.5v.5', 214, 20, 10],
      ['M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 40, 92, 8],
      ['M2 12l20-9-6 18-4-7z', 112, 100, -14],
      ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3a3 3 0 0 1 0 6M12 21a3 3 0 0 1 0-6M3 12a3 3 0 0 1 6 0M21 12a3 3 0 0 0-6 0', 176, 96, 0],
      ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c4 3 4 15 0 18M12 3c-4 3-4 15 0 18', 232, 100, 12],
      ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', 18, 170, 6],
      ['M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z', 92, 176, -6],
      ['M3 7h18v13H3zM8 7l2-3h4l2 3M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 154, 170, 8],
      ['M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2', 220, 176, -10],
    ];
    const g = sh.map(([d, x, y, r]) => `<path transform="translate(${x} ${y}) rotate(${r} 12 12) scale(1.15)" d="${d}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="230" viewBox="0 0 260 230"><g fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`;
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  };
})();
