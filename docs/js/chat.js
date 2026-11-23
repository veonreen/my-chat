/* Galaxy Relax v4: private area UI (conversation, composer, menus, settings; desktop: icon rail + profile card).
 * ui.sleep() removes the whole private area from the page (used when the decoy sky is showing);
 * ui.start() brings it back. While asleep nothing here renders, so no message exists in the DOM. */
(function () {
  const MC = window.MC;
  const { u, api } = MC;
  const S = MC.S;
  const core = MC.core;
  const { h, $ } = u;
  const ui = (MC.ui = { ready: false, built: false });
  const el = {};
  const nodes = new Map();      // msgId -> { row, sig }
  const seps = new Map();       // dayKey -> element
  let forceStick = false, loadingOlder = false, sbSig = '';
  let matches = [], matchIdx = -1;
  let appEl = null, appNext = null, olderNode = null, typingNode = null, personSig = '';
  const REACTIONS = ['😂', '🔥', '👍', '😮', '😢', '❤️'];

  MC.showScreen = function (name) {
    ['splash', 'auth', 'keyscreen', 'neterr', 'app', 'decoy'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.classList.toggle('hidden', id !== name);
    });
  };

  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

  // ================= Init =================
  function cacheEls() {
    const ids = ['sidebar', 'main', 'btn-me', 'btn-theme', 'btn-starred', 'btn-menu', 'notif-banner', 'nb-on', 'nb-x', 'nb-ic',
      'sb-search', 'sb-search-clear', 'sb-search-ic', 'chat-list', 'sb-lock', 'empty-state', 'empty-lock', 'chat', 'btn-back', 'ch-info',
      'ch-avatar', 'ch-name', 'ch-status', 'btn-search', 'btn-chmenu', 'msg-search', 'ms-close', 'ms-ic', 'ms-input', 'ms-count', 'ms-up', 'ms-down',
      'msgs-wrap', 'msgs', 'scroll-down', 'sd-ic', 'sd-count', 'drop-hint', 'reply-bar', 'composer', 'comp-row', 'btn-emoji', 'btn-attach',
      'input', 'btn-send', 's-mic', 's-send', 'rec-row', 'rec-cancel', 'rec-time', 'rec-send', 'emoji-panel', 'conn-banner', 'rail-chat', 'rail-sky', 'rail-theme', 'rail-star', 'rail-settings', 'rail-me', 'rail-logo-ic', 'person'];
    ids.forEach((id) => { el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });
  }

  function fillIcons() {
    const set = (node, name) => { if (node) node.innerHTML = u.ic(name); };
    set(el.btnStarred, 'star'); set(el.btnMenu, 'more');
    set(el.nbIc, 'bell'); set(el.nbX, 'close'); set(el.sbSearchIc, 'search'); set(el.sbSearchClear, 'close');
    set(el.sbLock, 'lock'); set(el.emptyLock, 'lock'); set(el.btnBack, 'back');
    set(el.btnSearch, 'search'); set(el.btnChmenu, 'more'); set(el.msClose, 'close'); set(el.msIc, 'search');
    set(el.msUp, 'up'); set(el.msDown, 'down'); set(el.sdIc, 'down'); set(el.btnEmoji, 'emoji'); set(el.btnAttach, 'attach');
    set(el.sMic, 'mic'); set(el.sSend, 'send'); set(el.recCancel, 'trash'); set(el.recSend, 'send');
    set(el.railLogoIc, 'orbit'); set(el.railChat, 'emoji'); set(el.railSky, 'moonStar'); set(el.railStar, 'star'); set(el.railSettings, 'settings');
  }

  ui.themeChanged = function () {
    const dark = core.resolvedTheme() === 'dark', ic = u.ic(dark ? 'sun' : 'moon');
    if (el.btnTheme) el.btnTheme.innerHTML = ic;
    if (el.railTheme) el.railTheme.innerHTML = ic;
  };
  const quickTheme = () => { core.setTheme(core.resolvedTheme() === 'dark' ? 'light' : 'dark'); u.haptic(8); };

  /** Take the (still empty) private area out of the page before it has ever been shown. */
  ui.park = function () {
    if (!appEl) appEl = document.getElementById('app');
    if (appEl && appEl.isConnected && !ui.ready) { appNext = appEl.nextSibling; appEl.remove(); }
  };

  ui.start = function () {
    if (!appEl) appEl = document.getElementById('app');
    if (appEl && !appEl.isConnected) document.body.insertBefore(appEl, appNext && appNext.isConnected ? appNext : document.getElementById('overlay-root'));
    if (!ui.built) {
      cacheEls(); fillIcons(); bindEvents(); buildEmojiPanel(); setVh();
      ui.built = true;
    }
    MC.showScreen('app');
    ui.ready = true;
    ui.themeChanged();
    ui.profileChanged();
    sbSig = ''; ui.renderSidebar();
    maybeNotifBanner();
    const peers = [...S.users.keys()].filter((x) => x !== S.uid);
    const target = ui.lastPeer && S.users.has(ui.lastPeer) ? ui.lastPeer : peers.length === 1 ? peers[0] : null;
    if (target) ui.openChat(target);
    core.updateTitle();
  };

  /** Remove the private area from the page. Everything readable is wiped first, then the whole area is detached. */
  ui.sleep = function () {
    if (!ui.built || !ui.ready) return;
    ui.ready = false;
    if (S.current) S.drafts[S.current] = el.input.value;
    ui.lastPeer = S.current;
    if (el.composer.classList.contains('recording')) stopRecording(false);
    for (const m of S.byId.values()) if (m._audio) { try { m._audio.pause(); } catch (e) { /* ignore */ } m._audio = null; }
    document.querySelectorAll('.lightbox').forEach((n) => n.remove());
    ['overlay-root', 'menu-root', 'toast-root'].forEach((id) => { const n = document.getElementById(id); if (n) n.replaceChildren(); });
    el.msgs.replaceChildren(); nodes.clear(); seps.clear(); olderNode = null; typingNode = null;
    el.chatList.replaceChildren(); sbSig = '';
    el.input.value = ''; el.msInput.value = ''; el.sbSearch.value = ''; S.searchQ = ''; matches = []; matchIdx = -1;
    el.msgSearch.classList.add('hidden'); el.msCount.textContent = '';
    el.chName.textContent = ''; el.chStatus.textContent = ''; el.chAvatar.replaceChildren(); el.btnMe.replaceChildren();
    el.replyBar.replaceChildren(); el.replyBar.classList.add('hidden');
    if (el.person) el.person.replaceChildren(); personSig = '';
    el.composer.classList.remove('emoji-open', 'has-text', 'recording');
    el.chat.classList.add('hidden'); el.emptyState.classList.remove('hidden');
    document.body.classList.remove('chat-open', 'privacy');
    S.current = null; S.replyTo = null; S.editing = null;
    appNext = appEl.nextSibling; appEl.remove();
    core.updateTitle();
  };

  ui.setConn = function (ok) {
    if (!el.connBanner) return;
    el.connBanner.classList.toggle('hidden', ok);
    el.connBanner.innerHTML = u.ic('wifiOff') + ' Reconnecting…';
  };

  function setVh() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', vh + 'px');
  }

  // ================= Sidebar =================
  function tickEl(m) {
    const t = h('span', { class: 'tick' });
    if (m.failed) { t.classList.add('failed'); t.innerHTML = '!'; }
    else if (m.pending || m.status < 0) { t.classList.add('pending'); t.innerHTML = u.ic('clock'); }
    else if (m.status === 0) { t.classList.add('t0'); t.innerHTML = u.ic('check'); }
    else if (m.status === 1) { t.classList.add('t1'); t.innerHTML = u.ic('dcheck'); }
    else { t.classList.add('t2'); t.innerHTML = u.ic('dcheck'); }
    return t;
  }

  function peerList() {
    return [...S.users.values()].filter((x) => x.uid !== S.uid);
  }
  function isTyping(peer) { const p = S.peers[peer]; return !!(p && p.typingTo === S.uid); }

  ui.renderSidebar = function () {
    if (!ui.ready || !el.chatList) return;
    const q = el.sbSearch.value.trim().toLowerCase();
    el.sbSearchClear.classList.toggle('hidden', !q);
    const peers = peerList();
    const rows = peers.map((p) => ({ p, last: core.lastMsg(p.uid) }))
      .sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0) || a.p.name.localeCompare(b.p.name));
    const sig = JSON.stringify([q, S.current, rows.map((r) => [r.p.uid, r.p.name, !!r.p.photo, r.last && [r.last.id, r.last.upd, r.last.status, r.last.pending, r.last.failed, r.last.ts], core.unreadCount(r.p.uid), isTyping(r.p.uid)])]);
    if (sig === sbSig) return;
    sbSig = sig;

    const frag = document.createDocumentFragment();
    let shown = 0;
    rows.forEach(({ p, last }) => {
      if (q && !(p.name.toLowerCase().includes(q) || p.username.includes(q))) return;
      shown++;
      const typing = isTyping(p.uid), unread = core.unreadCount(p.uid);
      const lastEl = h('span', { class: 'cr-last' });
      if (typing) { lastEl.classList.add('typing'); lastEl.textContent = 'typing…'; }
      else if (last) {
        if (last.from === S.uid && !last.deleted) lastEl.append(tickEl(last));
        lastEl.append(core.preview(last));
      } else lastEl.textContent = p.about || 'Say hello';
      frag.append(h('div', { class: 'chat-row' + (S.current === p.uid ? ' active' : ''), onclick: () => ui.openChat(p.uid) },
        u.avatar(p),
        h('div', { class: 'cr-body' },
          h('div', { class: 'cr-top' }, h('span', { class: 'cr-name' }, p.name), h('span', { class: 'cr-time' + (unread ? ' unread' : '') }, last ? u.listTime(last.ts) : '')),
          h('div', { class: 'cr-bot' }, lastEl, unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null))));
    });

    if (q) {                      // search inside messages
      const hits = [];
      for (const m of S.byId.values()) {
        if (m.deleted || !m.dec) continue;
        const txt = (m.t || '') + ' ' + (m.f ? m.f.n || '' : '');
        if (txt.toLowerCase().includes(q)) hits.push(m);
      }
      hits.sort((a, b) => b.ts - a.ts);
      if (hits.length) {
        frag.append(h('div', { class: 'sb-section' }, 'Messages'));
        hits.slice(0, 30).forEach((m) => {
          const peer = core.peerOf(m), p = S.users.get(peer);
          if (!p) return; shown++;
          frag.append(h('div', { class: 'chat-row', onclick: () => { ui.openChat(peer); setTimeout(() => jumpTo(m.id), 60); } },
            u.avatar(p),
            h('div', { class: 'cr-body' },
              h('div', { class: 'cr-top' }, h('span', { class: 'cr-name' }, p.name), h('span', { class: 'cr-time' }, u.listTime(m.ts))),
              h('div', { class: 'cr-bot' }, h('span', { class: 'cr-last' }, u.richText(core.preview(m), q))))));
        });
      }
    }
    if (!shown) {
      frag.append(h('div', { class: 'sb-empty' },
        q ? 'Nothing found' : peers.length ? '' : 'Nobody else has joined yet.\nShare the link and ask them to join.'));
    }
    el.chatList.replaceChildren(frag);
  };
  ui.presenceChanged = function () { ui.renderSidebar(); if (ui.ready && S.current) ui.chatChanged(); };

  ui.profileChanged = function () {
    if (!ui.ready || !el.btnMe) return;
    el.btnMe.innerHTML = '';
    el.btnMe.append(u.avatar(S.me));
    if (el.railMe) { el.railMe.innerHTML = ''; el.railMe.append(u.avatar(S.me)); }
    if (S.current) fillHeader();
  };

  function maybeNotifBanner() {
    const show = 'Notification' in window && Notification.permission === 'default' && S.settings.notif && !MC.LS.get('mychat.nbx', false);
    el.notifBanner.classList.toggle('hidden', !show);
  }

  // ================= Open / close conversation =================
  function statusInfo() {
    const p = S.users.get(S.current), pr = S.peers[S.current];
    let txt = '', cls = '';
    if (pr && pr.typingTo === S.uid) { txt = 'typing'; cls = 'typing'; }
    else if (pr && pr.online) { txt = 'online'; cls = 'online'; }
    else if (pr && pr.lastSeen > 1000) txt = u.lastSeen(pr.lastSeen);
    else if (p && p.lastSeen > 1000) txt = u.lastSeen(p.lastSeen);
    return { txt, cls };
  }
  function fillHeader() {
    const p = S.users.get(S.current);
    if (!p) return;
    u.fillAvatar(el.chAvatar, p);
    el.chName.textContent = p.name;
    ui.updateStatus();
    ui.renderPerson();
  }
  ui.updateStatus = function () {
    if (!ui.ready || !S.current || !el.chStatus) return;
    const { txt, cls } = statusInfo();
    if (el.chStatus.textContent !== txt) el.chStatus.textContent = txt;
    el.chStatus.className = 'ch-status ' + cls;
    const sub = el.person && el.person.querySelector('.sub'); if (sub && sub.textContent !== (txt || ' ')) sub.textContent = txt || ' ';
  };
  /** Desktop only (>= 1180 px): the other person's card. Rebuilt only when something it shows has changed. */
  ui.renderPerson = function () {
    if (!ui.ready || !el.person) return;
    const p = S.users.get(S.current);
    if (!p) { el.person.replaceChildren(); personSig = ''; return; }
    const imgs = (S.msgs.get(S.current) || []).filter((m) => m.type === 'image' && !m.deleted && m.f && m.f.th).slice(-6).reverse();
    const sig = [p.uid, p.name, p.about, imgs.map((m) => m.id).join(',')].join('|');
    if (sig === personSig && el.person.childNodes.length) return;
    personSig = sig;
    const big = u.avatar(p, 104); big.classList.add('big');
    const shared = h('div', { class: 'shared' });
    for (let i = 0; i < 6; i++) {
      const m = imgs[i], t = h('i', { class: m ? 'has' : '', onclick: m ? () => lightbox(m) : null });
      if (m) core.getFileUrl(m).then((url) => { t.style.backgroundImage = 'url("' + url + '")'; }).catch(() => {});
      shared.append(t);
    }
    el.person.replaceChildren(big, h('h3', {}, p.name), h('div', { class: 'sub' }, statusInfo().txt || ' '),
      h('div', { class: 'abt' }, p.about || 'Say hello.'),
      h('div', { class: 'acts' },
        h('button', { class: 'act', 'aria-label': 'Search', html: u.ic('search'), onclick: () => openMsgSearch() }),
        h('button', { class: 'act', 'aria-label': 'Starred messages', html: u.ic('star'), onclick: () => openStarred() }),
        h('button', { class: 'act', 'aria-label': 'Settings', html: u.ic('bell'), onclick: () => openSettings() })),
      h('div', { class: 'sec' }, 'Shared photos'), shared,
      h('div', { class: 'enc' }, h('span', { html: u.ic('lock') }), 'End-to-end encrypted'));
  };

  ui.openChat = function (peer) {
    if (!ui.ready || !S.users.has(peer)) return;
    if (S.current && S.current !== peer) S.drafts[S.current] = el.input.value;
    const changed = S.current !== peer;
    S.current = peer; S.replyTo = null; S.editing = null;
    closeMsgSearch(true);
    el.emptyState.classList.add('hidden'); el.chat.classList.remove('hidden');
    document.body.classList.add('chat-open');
    if (isMobile() && !(history.state && history.state.chat)) history.pushState({ chat: 1 }, '');
    fillHeader();
    if (changed) {
      nodes.clear(); seps.clear(); el.msgs.replaceChildren();
      el.input.value = S.drafts[peer] || '';
    }
    autosize(); updateSendState(); ui.renderReplyBar();
    forceStick = true;
    ui.chatChanged(true);
    sbSig = ''; ui.renderSidebar();
    core.pollNow();
    if (!isMobile()) el.input.focus();
  };
  ui.closeChat = function (fromPop) {
    if (!ui.ready || !S.current) return;
    S.drafts[S.current] = el.input.value;
    S.current = null; S.replyTo = null; S.editing = null;
    document.body.classList.remove('chat-open');
    el.chat.classList.add('hidden'); el.emptyState.classList.remove('hidden');
    el.emojiPanel.parentElement.classList.remove('emoji-open');
    if (!fromPop && history.state && history.state.chat) history.back();
    sbSig = ''; ui.renderSidebar();
  };
  window.addEventListener('popstate', () => { if (ui.ready && S.current && isMobile()) ui.closeChat(true); });

  // ================= Messages rendering =================
  const isNearBottom = () => { const w = el.msgsWrap; return w.scrollHeight - w.scrollTop - w.clientHeight < 150; };
  const scrollBottom = (smooth) => { const w = el.msgsWrap; w.scrollTo({ top: w.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };

  const sigOf = (m) => [m.upd, m.status, m.pending ? 1 : 0, m.failed ? 1 : 0, m.uploading ? 1 : 0, m.starred, m.dec ? 1 : 0, S.searchQ, m._blob ? 1 : 0, m.edited, m.ts, (m.t || '').length, JSON.stringify(m.rx || {})].join('|');

  ui.localAdded = function () { forceStick = true; };
  ui.msgChanged = function (m) { if (ui.ready && S.current && core.peerOf(m) === S.current) ui.chatChanged(); };

  ui.chatChanged = function (forceAll) {
    if (!ui.ready || !S.current || !el.msgs) return;
    const arr = S.msgs.get(S.current) || [];
    const stick = forceStick || isNearBottom();
    forceStick = false;
    const desired = [];
    if (S.more[S.current] && arr.length) desired.push(olderEl());
    let prev = null;
    for (const m of arr) {
      const dk = u.dayKey(m.ts);
      const newDay = !prev || u.dayKey(prev.ts) !== dk;
      if (newDay) {
        let s = seps.get(dk);
        if (!s) { s = h('div', { class: 'sep' }, h('span')); seps.set(dk, s); }
        s.firstChild.textContent = u.dayLabel(m.ts);
        desired.push(s);
      }
      let n = nodes.get(m.id);
      const sg = sigOf(m);
      if (!n) {
        n = { row: h('div', { class: 'row', dataset: { id: m.id } }), sig: '' }; nodes.set(m.id, n);
        if (m._fresh) { const r = n.row; r.classList.add('pop'); r.addEventListener('animationend', () => r.classList.remove('pop'), { once: true }); }
        m._fresh = false;
      }
      if (n.sig !== sg || forceAll) { fillRow(n.row, m); n.sig = sg; }
      n.row.classList.toggle('first', newDay || !prev || prev.from !== m.from || prev.deleted !== m.deleted);
      desired.push(n.row);
      prev = m;
    }
    if (isTyping(S.current)) {
      if (!typingNode) typingNode = h('div', { class: 'typing-bubble', 'aria-label': 'typing' }, h('i'), h('i'), h('i'));
      desired.push(typingNode);
    }
    const c = el.msgs;
    desired.forEach((d, i) => { if (c.children[i] !== d) c.insertBefore(d, c.children[i] || null); });
    while (c.children.length > desired.length) c.lastChild.remove();

    if (stick) { scrollBottom(false); markSeenLocal(); }
    updateFab();
    ui.renderPerson();
  };

  function olderEl() {
    if (!olderNode) {
      olderNode = h('div', { class: 'older' }, h('i', { class: 'spin dark' }));
      new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadOlderUI(); }, { root: el.msgsWrap, rootMargin: '200px' }).observe(olderNode);
    }
    return olderNode;
  }
  async function loadOlderUI() {
    if (loadingOlder || !ui.ready || !S.current || !S.more[S.current]) return;
    loadingOlder = true;
    const w = el.msgsWrap, ph = w.scrollHeight, pt = w.scrollTop;
    try { await core.loadOlder(S.current); ui.chatChanged(); w.scrollTop = pt + (w.scrollHeight - ph); }
    catch (e) { /* retry on next intersect */ }
    loadingOlder = false;
  }

  function markSeenLocal() {
    if (!S.current || !core.isActive()) return;
    let any = false;
    for (const m of S.msgs.get(S.current) || []) if (m.to === S.uid && !m._seenLocal) { m._seenLocal = true; any = true; }
    if (any) { sbSig = ''; ui.renderSidebar(); core.updateTitle(); }
  }
  function updateFab() {
    const far = el.msgsWrap.scrollHeight - el.msgsWrap.scrollTop - el.msgsWrap.clientHeight > 320;
    el.scrollDown.classList.toggle('hidden', !far);
    const n = S.current ? core.unreadCount(S.current) : 0;
    const sd = document.getElementById('sd-count');
    sd.classList.toggle('hidden', !n); sd.textContent = n;
  }

  // ----- build one message row -----
  function quoteEl(rp) {
    const mine = rp.u === S.uid;
    return h('div', { class: 'quote', dataset: { rid: rp.id } },
      h('div', { class: 'q-name' }, mine ? 'You' : core.nameOf(rp.u)),
      h('div', { class: 'q-text' }, rp.s || ''));
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const w = e.target; io.unobserve(w);
      const m = w._m, img = w.querySelector('img.real');
      if (!m || !img) return;
      core.getFileUrl(m).then((url) => { img.src = url; img.onload = () => w.classList.add('loaded'); }).catch(() => w.classList.add('err'));
    });
  }, { rootMargin: '300px' });

  function mediaEl(m) {
    const f = m.f || {};
    const wrap = h('div', { class: 'media', style: { aspectRatio: `${f.w || 4} / ${f.h || 3}` } });
    if (f.th) wrap.append(h('img', { class: 'ph', src: f.th, alt: '', draggable: 'false' }));
    wrap.append(h('img', { class: 'real', alt: '', draggable: 'false' }));
    if (m.uploading || (m.pending && m.type === 'image')) wrap.append(h('div', { class: 'upl' }, h('i', { class: 'spin' })));
    wrap._m = m;
    if (m._blob) { const img = wrap.querySelector('img.real'); img.src = m._blob; wrap.classList.add('loaded'); }
    else io.observe(wrap);
    return wrap;
  }
  function fileEl(m) {
    const f = m.f || {};
    const ext = (f.n || '').split('.').pop().slice(0, 4).toUpperCase();
    return h('div', { class: 'file-card' },
      h('div', { class: 'fc-ic' }, h('span', { html: u.ic('doc') }), h('b', {}, ext)),
      h('div', { class: 'fc-info' }, h('div', { class: 'fc-name' }, f.n || 'File'), h('div', { class: 'fc-size' }, u.fmtSize(f.s || 0))),
      m.uploading ? h('i', { class: 'spin dark' }) : h('button', { class: 'icon-btn fc-dl', 'aria-label': 'Download', html: u.ic('download') }));
  }
  function voiceEl(m) {
    const f = m.f || {};
    const playing = m._audio && !m._audio.paused;
    const box = h('div', { class: 'voice' },
      h('button', { class: 'voice-btn', 'aria-label': 'Play', html: u.ic(playing ? 'pause' : 'play') }),
      h('div', { class: 'v-bar' }, h('i')),
      h('span', { class: 'v-dur' }, u.dur(f.d)));
    if (m._audio) bindAudio(m, box);
    return box;
  }
  function bindAudio(m, box) {
    const a = m._audio, bar = box.querySelector('.v-bar i'), dur = box.querySelector('.v-dur'), btn = box.querySelector('.voice-btn');
    const upd = () => {
      if (!document.body.contains(box)) return;
      bar.style.width = (a.duration ? (a.currentTime / a.duration) * 100 : 0) + '%';
      dur.textContent = u.dur(a.paused && !a.currentTime ? (m.f.d || 0) : a.currentTime);
    };
    a.ontimeupdate = upd;
    a.onended = () => { btn.innerHTML = u.ic('play'); bar.style.width = '0'; dur.textContent = u.dur(m.f.d || 0); };
    a.onpause = () => { btn.innerHTML = u.ic('play'); };
    a.onplay = () => { btn.innerHTML = u.ic('pause'); };
    upd();
  }

  function rxChip(m) {
    const groups = new Map();
    for (const uid of Object.keys(m.rx || {})) groups.set(m.rx[uid], (groups.get(m.rx[uid]) || 0) + 1);
    if (!groups.size) return null;
    const chip = h('div', { class: 'rx' + (m.rx[S.uid] ? ' mine' : ''), role: 'button', 'aria-label': 'Reactions' });
    groups.forEach((n, e) => { chip.append(h('span', {}, e)); if (n > 1) chip.append(h('b', {}, String(n))); });
    return chip;
  }

  function fillRow(row, m) {
    const mine = m.from === S.uid;
    row.classList.remove('in', 'out'); row.classList.add(mine ? 'out' : 'in');
    row.classList.toggle('deleted', !!m.deleted);
    const q = S.searchQ;
    const b = h('div', { class: 'bubble' });
    let hasText = false;

    if (m.deleted) {
      b.classList.add('del');
      b.append(h('span', { class: 'del-txt' }, mine ? 'You deleted this message' : 'This message was deleted'));
      hasText = true;
    } else {
      b.append(h('button', { class: 'chev', 'aria-label': 'Message options', html: u.ic('down') }));
      if (m.rp) b.append(quoteEl(m.rp));
      if (!m.dec) { b.append(h('div', { class: 'text undec' }, 'Could not be decrypted with the current code.')); hasText = true; }
      else {
        if (m.type === 'image') b.append(mediaEl(m));
        else if (m.type === 'file') b.append(m.f && m.f.v ? voiceEl(m) : fileEl(m));
        if (m.t) {
          const t = h('div', { class: 'text' }, u.richText(m.t, q), h('span', { class: 'sp' }));
          if (m.type === 'text' && u.emojiOnly(m.t)) { b.classList.add('big-emoji'); }
          b.append(t); hasText = true;
        }
      }
    }
    if (m.type === 'image' && !m.t && !m.deleted && m.dec) b.classList.add('media-only');
    if (m.type === 'image') b.classList.add('has-media');
    if (m.type === 'file' && !(m.f && m.f.v)) b.classList.add('has-file');

    const meta = h('span', { class: 'meta' });
    if (m.starred) meta.append(h('span', { class: 'm-star', html: u.ic('star') }));
    if (m.edited && !m.deleted) meta.append(h('span', { class: 'edited' }, 'edited'));
    meta.append(h('span', { class: 'time' }, u.time(m.ts)));
    if (mine && !m.deleted) meta.append(tickEl(m));
    b.append(meta);
    if (!hasText && !b.classList.contains('media-only')) b.classList.add('tight');
    if (m.failed) b.append(h('div', { class: 'retry' }, 'Not sent. Tap to retry'));
    const chip = m.deleted ? null : rxChip(m);
    row.classList.toggle('has-rx', !!chip);
    row.replaceChildren(h('div', { class: 'swipe-ic', html: u.ic('reply') }), h('div', { class: 'bwrap' }, b, chip));
  }

  // ----- message interactions (delegated) -----
  const msgOf = (t) => { const r = t.closest && t.closest('.row'); return r ? S.byId.get(r.dataset.id) : null; };

  function startReply(m) {
    S.editing = null; S.replyTo = m; ui.renderReplyBar(); el.input.focus();
  }
  function startEdit(m) {
    S.replyTo = null; S.editing = m; el.input.value = m.t; autosize(); updateSendState(); ui.renderReplyBar(); el.input.focus();
  }
  ui.renderReplyBar = function () {
    const bar = el.replyBar; if (!bar || !ui.ready) return;
    bar.replaceChildren();
    const m = S.editing || S.replyTo;
    if (!m) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const name = S.editing ? 'Edit message' : m.from === S.uid ? 'You' : core.nameOf(m.from);
    bar.append(
      h('div', { class: 'rb-card' }, h('div', { class: 'rb-name' }, name), h('div', { class: 'rb-text' }, core.preview(m))),
      h('button', { class: 'icon-btn', 'aria-label': 'Cancel', html: u.ic('close'), onclick: cancelReplyEdit }));
  };
  function cancelReplyEdit() {
    if (S.editing) { el.input.value = S.drafts[S.current] || ''; }
    S.replyTo = null; S.editing = null; ui.renderReplyBar(); autosize(); updateSendState();
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) { const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove(); }
    u.toast('Copied');
  }
  function discard(m) {
    S.byId.delete(m.id);
    const a = S.msgs.get(m.to); if (a) a.splice(a.indexOf(m), 1);
    const n = nodes.get(m.id); if (n) { n.row.remove(); nodes.delete(m.id); }
    core.refreshUI();
  }

  // reactions: a heart flies up from the message, the chip pops in
  async function doReact(m, emoji, x, y) {
    u.haptic(12);
    if (S.settings.sound) u.sfx('react');
    const next = await core.react(m, emoji);
    if (next && MC.fx) {
      const n = nodes.get(m.id), r = n && n.row.querySelector('.bubble');
      const bx = r ? r.getBoundingClientRect() : null;
      MC.fx.flyEmoji(x != null ? x : bx ? bx.left + bx.width / 2 : innerWidth / 2, y != null ? y : bx ? bx.top : innerHeight / 2, next);
    }
  }
  ui.reactFx = function (m, emoji) {
    if (!ui.ready || S.current !== core.peerOf(m)) return;
    const n = nodes.get(m.id), b = n && n.row.querySelector('.bubble');
    if (!b || !MC.fx) return;
    const r = b.getBoundingClientRect();
    MC.fx.flyEmoji(r.left + r.width / 2, r.top, emoji);
    if (S.settings.sound) u.sfx('react');
    u.haptic(10);
  };
  function reactPicker(m) {
    const mine = (m.rx || {})[S.uid];
    return h('div', { class: 'rx-pick' }, REACTIONS.map((e) => h('button', { type: 'button', class: mine === e ? 'on' : '', 'aria-label': 'React ' + e, onclick: (ev) => { closeMenu(); doReact(m, e, ev.clientX, ev.clientY); } }, e)));
  }

  function msgMenu(m, x, y) {
    if (!m || m.deleted) return;
    const mine = m.from === S.uid;
    const items = [];
    let header = null;
    if (m.failed) {
      items.push({ icon: 'send', label: 'Retry', fn: () => core.retry(m) }, { icon: 'trash', label: 'Discard', danger: true, fn: () => discard(m) });
    } else if (!m.pending) {
      header = reactPicker(m);
      items.push({ icon: 'reply', label: 'Reply', fn: () => startReply(m) });
      if (m.t) items.push({ icon: 'copy', label: 'Copy', fn: () => copyText(m.t) });
      items.push({ icon: m.starred ? 'starO' : 'star', label: m.starred ? 'Unstar' : 'Star', fn: () => core.starMsg(m, !m.starred) });
      if (core.canEdit(m)) items.push({ icon: 'edit', label: 'Edit', fn: () => startEdit(m) });
      if (m.type !== 'text' && m.fileId) items.push({ icon: 'download', label: 'Download', fn: () => core.downloadFile(m) });
      if (mine) items.push({ icon: 'trash', label: 'Delete for everyone', danger: true, fn: () => confirmBox({ title: 'Delete message?', text: 'It will be removed for both of you.', ok: 'Delete', danger: true }).then((y2) => { if (y2) core.deleteMsg(m); }) });
    }
    showMenu(items, { x, y, header });
  }

  function jumpTo(id, tries) {
    tries = tries || 0;
    const n = nodes.get(id);
    if (n) {
      n.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      n.row.classList.remove('flash'); void n.row.offsetWidth; n.row.classList.add('flash');
      setTimeout(() => n.row.classList.remove('flash'), 1800);
      return;
    }
    if (S.more[S.current] && tries < 12) {
      core.loadOlder(S.current).then(() => { ui.chatChanged(); jumpTo(id, tries + 1); }).catch(() => {});
    } else u.toast('Message not found');
  }

  function bindMessages() {
    const box = el.msgs;
    let lastTap = { t: 0, id: '', x: 0, y: 0 };
    box.addEventListener('click', (e) => {
      if (e.target.closest('.rx')) { const m0 = msgOf(e.target); if (m0) { const r = e.target.closest('.rx').getBoundingClientRect(); msgMenu(m0, r.left, r.top); } return; }
      const m = msgOf(e.target); if (!m) return;
      if (e.target.closest('.chev')) { const r = e.target.closest('.chev').getBoundingClientRect(); return msgMenu(m, r.right, r.bottom); }
      if (e.target.closest('.retry')) return core.retry(m);
      const q = e.target.closest('.quote'); if (q) return jumpTo(q.dataset.rid);
      if (e.target.closest('.media') && m.type === 'image') return lightbox(m);
      if (e.target.closest('.fc-dl') || (e.target.closest('.file-card') && !m.uploading)) return core.downloadFile(m);
      if (e.target.closest('.voice-btn')) return toggleVoice(m);
      // double tap = heart (only adds; a second double tap on an already hearted message just replays the animation)
      if (m.deleted || m.pending || m.failed || !e.target.closest('.bubble') || e.target.closest('a')) return;
      const now = Date.now();
      if (lastTap.id === m.id && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 44) {
        lastTap.t = 0;
        if (m.rx && m.rx[S.uid] === '❤️') { if (MC.fx) MC.fx.flyEmoji(e.clientX, e.clientY, '❤️'); u.haptic(10); }
        else doReact(m, '❤️', e.clientX, e.clientY);
      } else lastTap = { t: now, id: m.id, x: e.clientX, y: e.clientY };
    });
    box.addEventListener('contextmenu', (e) => {
      const m = msgOf(e.target); if (!m || e.target.closest('a')) return;
      if (!e.target.closest('.bubble')) return;
      e.preventDefault(); msgMenu(m, e.clientX, e.clientY);
    });
    // swipe-to-reply + long press on a bubble (touch). A long press anywhere else is the 3 second panic hold.
    let t0 = null;
    box.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const row = e.target.closest('.row'); if (!row) return;
      const m = S.byId.get(row.dataset.id); if (!m || m.deleted || m.pending || m.failed) return;
      const t = e.touches[0];
      const onBubble = !!e.target.closest('.bubble');
      t0 = { x: t.clientX, y: t.clientY, row, m, dx: 0, lock: false, done: false };
      if (onBubble) t0.timer = setTimeout(() => { if (t0 && !t0.lock) { t0.done = true; u.haptic(12); msgMenu(m, t.clientX, t.clientY); } }, 480);
    }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      if (!t0 || t0.done) return;
      const t = e.touches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (!t0.lock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        clearTimeout(t0.timer);
        if (Math.abs(dy) > Math.abs(dx) || dx < 0) { t0 = null; return; }
        t0.lock = true;
      }
      if (t0.lock) {
        t0.dx = u.clamp(dx, 0, 90);
        const b = t0.row.querySelector('.bubble');
        b.style.transition = 'none'; b.style.transform = `translateX(${t0.dx * 0.9}px)`;
        t0.row.style.setProperty('--sw', Math.min(1, t0.dx / 60));
      }
    }, { passive: true });
    const end = () => {
      if (!t0) return;
      clearTimeout(t0.timer);
      const b = t0.row.querySelector('.bubble');
      if (b) { b.style.transition = ''; b.style.transform = ''; }
      t0.row.style.setProperty('--sw', 0);
      if (t0.lock && t0.dx > 60 && !t0.done) { u.haptic(8); startReply(t0.m); }
      t0 = null;
    };
    box.addEventListener('touchend', end); box.addEventListener('touchcancel', end);

    el.msgsWrap.addEventListener('scroll', () => {
      requestAnimationFrame(() => { updateFab(); if (isNearBottom()) markSeenLocal(); });
    }, { passive: true });
    el.scrollDown.addEventListener('click', () => { scrollBottom(true); });
  }

  function toggleVoice(m) {
    if (!m._audio) {
      core.getFileUrl(m).then((url) => {
        m._audio = new Audio(url);
        const n = nodes.get(m.id); if (n) n.sig = '';
        ui.chatChanged();
        m._audio.play().catch(() => {});
      }).catch(() => u.toast('Could not load the voice note'));
      return;
    }
    for (const x of S.byId.values()) if (x !== m && x._audio && !x._audio.paused) x._audio.pause();
    if (m._audio.paused) m._audio.play().catch(() => {}); else m._audio.pause();
  }

  // ================= Composer =================
  function autosize() {
    const i = el.input; i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight, 130) + 'px';
  }
  function updateSendState() {
    el.composer.classList.toggle('has-text', el.input.value.trim().length > 0);
  }
  function doSend() {
    const text = el.input.value;
    if (!text.trim()) return;
    u.haptic(8);
    if (core.sendText(text)) {
      el.input.value = ''; S.drafts[S.current] = '';
      autosize(); updateSendState();
      if (!isMobile() || document.activeElement === el.input) el.input.focus();
    }
  }
  function insertAtCursor(txt) {
    const i = el.input, s = i.selectionStart || 0, e = i.selectionEnd || 0;
    i.value = i.value.slice(0, s) + txt + i.value.slice(e);
    i.selectionStart = i.selectionEnd = s + txt.length;
    autosize(); updateSendState(); core.markTyping();
  }

  let recTimer = null;
  async function startRecording() {
    MC.stealth.hold(5 * 60 * 1000);                   // the mic prompt makes the browser blur the page
    try {
      await core.recStart();
    } catch (e) { MC.stealth.release(); u.toast(e && e.name === 'NotAllowedError' ? 'Allow the microphone in your browser settings' : (e.message || 'Could not start recording')); return; }
    el.composer.classList.add('recording');
    const t0 = Date.now();
    el.recTime.textContent = '0:00';
    recTimer = setInterval(() => { el.recTime.textContent = u.dur((Date.now() - t0) / 1000); }, 250);
  }
  async function stopRecording(send) {
    clearInterval(recTimer);
    el.composer.classList.remove('recording');
    await core.recStop(send);
    MC.stealth.release();
  }

  function buildEmojiPanel() {
    const panel = el.emojiPanel;
    const tabs = h('div', { class: 'em-tabs' });
    const grid = h('div', { class: 'em-grid' });
    const show = (cat) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === cat.id));
      grid.replaceChildren(h('div', { class: 'em-title' }, cat.name), ...cat.list.map((e) => h('button', { class: 'em', type: 'button' }, e)));
      grid.scrollTop = 0;
    };
    MC.emoji.forEach((cat) => tabs.append(h('button', { type: 'button', dataset: { id: cat.id }, title: cat.name, onclick: () => show(cat) }, cat.icon)));
    grid.addEventListener('mousedown', (e) => e.preventDefault());
    grid.addEventListener('click', (e) => { const b = e.target.closest('.em'); if (b) insertAtCursor(b.textContent); });
    panel.append(tabs, grid);
    show(MC.emoji[0]);
  }
  function toggleEmoji(force) {
    const open = typeof force === 'boolean' ? force : !el.composer.classList.contains('emoji-open');
    el.composer.classList.toggle('emoji-open', open);
    el.btnEmoji.classList.toggle('on', open);
    if (open && isMobile()) el.input.blur();
    setTimeout(() => { if (isNearBottom()) scrollBottom(); }, 260);
  }

  function attachMenu() {
    // opening a file picker / camera makes the browser blur the page; tell Stealth Mode this is expected
    const pick = (id) => () => { MC.stealth.hold(3 * 60 * 1000); document.getElementById(id).click(); };
    const items = [
      { icon: 'doc', label: 'Document', color: '#6F7BE8', fn: pick('file-doc') },
      { icon: 'image', label: 'Photos', color: '#1FB5A3', fn: pick('file-img') },
    ];
    if (u.isTouch()) items.push({ icon: 'camera', label: 'Camera', color: '#FF7A6B', fn: pick('file-cam') });
    const r = el.btnAttach.getBoundingClientRect();
    showMenu(items, { x: r.left, y: r.top, up: true, round: true });
  }

  function previewFiles(files) {
    files = Array.from(files).filter(Boolean);
    if (!files.length || !S.current) return;
    const urls = [];
    const body = h('div', { class: 'ap-body' });
    const first = files[0];
    if (/^image\//.test(first.type)) {
      const url = URL.createObjectURL(first); urls.push(url);
      body.append(h('img', { class: 'ap-img', src: url, alt: '' }));
    } else {
      body.append(h('div', { class: 'ap-doc' }, h('div', { class: 'fc-ic big', html: u.ic('doc') }), h('div', { class: 'ap-name' }, first.name), h('div', { class: 'muted' }, u.fmtSize(first.size))));
    }
    if (files.length > 1) body.append(h('div', { class: 'ap-more' }, `+ ${files.length - 1} more file${files.length > 2 ? 's' : ''}`));
    const cap = h('input', { class: 'ap-cap', placeholder: 'Add a caption…', maxlength: 500 });
    const send = () => { core.sendFiles(files, cap.value.trim()); mod.close(); forceStick = true; };
    cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    const mod = openModal({
      title: files.length > 1 ? `Send ${files.length} files` : 'Preview', cls: 'ap',
      body: [body, h('div', { class: 'ap-foot' }, cap, h('button', { class: 'send-btn', 'aria-label': 'Send', html: u.ic('send'), onclick: send }))],
      onClose: () => urls.forEach((x) => URL.revokeObjectURL(x)),
    });
    setTimeout(() => cap.focus(), 80);
  }

  // ================= Search in conversation =================
  async function openMsgSearch() {
    el.msgSearch.classList.remove('hidden');
    el.msInput.focus();
    let guard = 0;
    while (S.current && S.more[S.current] && guard++ < 40) { try { await core.loadOlder(S.current); } catch (e) { break; } }
    runSearch();
  }
  function closeMsgSearch(silent) {
    if (!el.msgSearch || el.msgSearch.classList.contains('hidden')) return;
    el.msgSearch.classList.add('hidden');
    el.msInput.value = ''; S.searchQ = ''; matches = []; matchIdx = -1; el.msCount.textContent = '';
    if (!silent) ui.chatChanged();
  }
  function runSearch() {
    S.searchQ = el.msInput.value.trim();
    const q = S.searchQ.toLowerCase();
    matches = [];
    if (q) for (const m of S.msgs.get(S.current) || []) {
      if (m.deleted || !m.dec) continue;
      if ((m.t || '').toLowerCase().includes(q) || (m.f && (m.f.n || '').toLowerCase().includes(q))) matches.push(m.id);
    }
    ui.chatChanged();
    matchIdx = matches.length - 1;
    gotoMatch(0);
  }
  function gotoMatch(d) {
    if (!matches.length) { el.msCount.textContent = S.searchQ ? 'No results' : ''; return; }
    matchIdx = (matchIdx + d + matches.length) % matches.length;
    el.msCount.textContent = `${matchIdx + 1}/${matches.length}`;
    jumpTo(matches[matchIdx]);
  }

  // ================= Menus / modals =================
  function closeMenu() { $('#menu-root').replaceChildren(); }
  function showMenu(items, pos) {
    closeMenu();
    const root = $('#menu-root');
    const menu = h('div', { class: 'menu' + (pos.round ? ' attach' : '') });
    if (pos.header) menu.append(pos.header);
    items.forEach((it) => {
      menu.append(h('button', { class: 'mi' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { closeMenu(); it.fn(); } },
        h('span', { class: 'mi-ic', style: it.color ? { background: it.color, color: '#0B0E1A' } : null, html: u.ic(it.icon) }), h('span', {}, it.label)));
    });
    const back = h('div', { class: 'menu-back', onmousedown: closeMenu, oncontextmenu: (e) => { e.preventDefault(); closeMenu(); }, ontouchstart: closeMenu });
    root.append(back, menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = pos.x, y = pos.y;
    if (pos.up) y = pos.y - mh - 8;
    if (x + mw > vw - 8) x = Math.max(8, (pos.right ? pos.x : x) - mw);
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = Math.max(8, vh - mh - 8);
    if (y < 8) y = 8;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    requestAnimationFrame(() => menu.classList.add('show'));
  }

  function openModal({ title, body, cls, onClose, noHead }) {
    const root = $('#overlay-root');
    const sheet = h('div', { class: 'sheet ' + (cls || ''), role: 'dialog', 'aria-modal': 'true' });
    const ov = h('div', { class: 'overlay' }, sheet);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      ov.classList.remove('show'); setTimeout(() => ov.remove(), 260);
      if (onClose) onClose();
    };
    if (!noHead) sheet.append(h('div', { class: 'sh-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Close', html: u.ic('close'), onclick: close }), h('div', { class: 'sh-title' }, title || '')));
    [].concat(body || []).forEach((b) => sheet.append(b));
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov._close = close;
    root.append(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    return { close, sheet };
  }

  function confirmBox({ title, text, ok, danger }) {
    return new Promise((res) => {
      let result = false;
      const m = openModal({
        noHead: true, cls: 'confirm', onClose: () => res(result),
        body: [h('div', { class: 'cf-body' }, h('h3', {}, title), h('p', { class: 'muted' }, text || '')),
          h('div', { class: 'cf-act' },
            h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
            h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { result = true; m.close(); } }, ok || 'OK'))],
      });
    });
  }

  function lightbox(m) {
    const img = h('img', { alt: '' });
    const ov = h('div', { class: 'lightbox' },
      h('div', { class: 'lb-bar' },
        h('div', { class: 'lb-who' }, h('b', {}, m.from === S.uid ? 'You' : core.nameOf(m.from)), h('span', {}, u.dayLabel(m.ts) + ' · ' + u.time(m.ts))),
        h('button', { class: 'icon-btn', 'aria-label': 'Download', html: u.ic('download'), onclick: () => core.downloadFile(m) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', html: u.ic('close'), onclick: () => ov.remove() })),
      h('div', { class: 'lb-img' }, img), m.t ? h('div', { class: 'lb-cap' }, m.t) : null);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('lb-img')) ov.remove(); });
    document.body.append(ov);
    core.getFileUrl(m).then((url) => { img.src = url; });
  }

  function openProfile() {
    const big = u.avatar(S.me, 104); big.classList.add('big'); big.style.alignSelf = 'center'; big.style.marginBottom = '10px';
    const name = h('input', { value: S.me.name, maxlength: 40, placeholder: 'Your name' });
    const about = h('input', { value: S.me.about || '', maxlength: 120, placeholder: 'About' });
    const save = h('button', { class: 'btn primary' }, h('span', {}, 'Save'), h('i', { class: 'spin' }));
    const mod = openModal({
      title: 'Profile', cls: 'profile',
      body: [h('div', { class: 'pf-body' }, big,
        h('label', { class: 'fld' }, h('span', {}, 'Your name'), name),
        h('label', { class: 'fld' }, h('span', {}, 'About'), about),
        h('div', { class: 'muted small' }, '@' + S.me.username + ' · Your name and about are stored encrypted.'),
        save)],
    });
    save.addEventListener('click', async () => {
      save.classList.add('loading'); save.disabled = true;
      try {
        await core.saveProfile({ name: name.value.trim() || S.me.username, about: about.value.trim() });
        u.toast('Profile saved'); mod.close();
      } catch (e) { u.toast(e.message || 'Could not save'); save.classList.remove('loading'); save.disabled = false; }
    });
  }

  async function openContact() {
    const p = S.users.get(S.current); if (!p) return;
    const big = u.avatar(p, 104); big.classList.add('big');
    const pr = S.peers[p.uid];
    let code = '';
    try {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(S.kc));
      code = Array.from(new Uint8Array(d).slice(0, 6), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('').replace(/(.{4})/g, '$1 ').trim();
    } catch (e) { /* ignore */ }
    openModal({
      title: 'Contact info', cls: 'profile',
      body: [h('div', { class: 'pf-body center' }, big, h('h2', {}, p.name), h('div', { class: 'muted' }, '@' + p.username),
        h('div', { class: 'ci-status' }, pr && pr.online ? 'online' : u.lastSeen(p.lastSeen || (pr && pr.lastSeen))),
        h('div', { class: 'ci-sec' }, h('div', { class: 'muted small' }, 'About'), h('div', {}, p.about || '—')),
        h('div', { class: 'ci-sec lockbox' }, h('span', { html: u.ic('lock') }), h('div', {}, h('b', {}, 'End-to-end encrypted'), h('div', { class: 'muted small' }, 'Messages and files open only with your unlock code. Safety code, you should both see the same: ' + code))))],
    });
  }

  function openStarred() {
    const list = [...S.byId.values()].filter((m) => m.starred && !m.deleted).sort((a, b) => b.ts - a.ts);
    const body = h('div', { class: 'st-list' });
    if (!list.length) body.append(h('div', { class: 'sb-empty' }, 'No starred messages yet.\nOpen a message menu and choose Star.'));
    let mod;
    list.forEach((m) => body.append(h('div', { class: 'st-item', onclick: () => { mod.close(); ui.openChat(core.peerOf(m)); setTimeout(() => jumpTo(m.id), 80); } },
      h('div', { class: 'st-top' }, h('b', {}, m.from === S.uid ? 'You' : core.nameOf(m.from)), h('span', {}, u.dayLabel(m.ts))),
      h('div', { class: 'st-txt' }, core.preview(m)))));
    mod = openModal({ title: 'Starred messages', cls: 'tall', body: [body] });
  }

  function openChangePassword() {
    const mk = (ac, ph) => h('input', { type: 'password', autocomplete: ac, placeholder: ph, maxlength: 200 });
    const cur = mk('current-password', 'Current password'), nw = mk('new-password', 'At least 6 characters'), cf = mk('new-password', 'Repeat the new password');
    const err = h('div', { class: 'err hidden' });
    const show = h('input', { type: 'checkbox' });
    show.addEventListener('change', () => [cur, nw, cf].forEach((i) => { i.type = show.checked ? 'text' : 'password'; }));
    const save = h('button', { class: 'btn primary', type: 'submit' }, h('span', {}, 'Change password'), h('i', { class: 'spin' }));
    const form = h('form', { class: 'pf-body', autocomplete: 'on' },
      h('input', { type: 'text', autocomplete: 'username', value: S.me.username, hidden: true, readonly: true }),   // for password managers
      err,
      h('label', { class: 'fld' }, h('span', {}, 'Current password'), cur),
      h('label', { class: 'fld' }, h('span', {}, 'New password'), nw),
      h('label', { class: 'fld' }, h('span', {}, 'Confirm new password'), cf),
      h('label', { class: 'chk' }, show, h('span', {}, 'Show passwords')),
      h('div', { class: 'muted small' }, 'This changes your login password only. Your unlock code stays the same. Other devices are logged out and need the new password.'),
      save);
    const mod = openModal({ title: 'Change password', cls: 'profile', body: [form] });
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); err.style.animation = 'none'; void err.offsetWidth; err.style.animation = ''; };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.classList.add('hidden');
      if (!cur.value) return fail('Enter your current password');
      if (nw.value.length < 6) return fail('The new password needs at least 6 characters');
      if (nw.value === cur.value) return fail('The new password must differ from the old one');
      if (nw.value !== cf.value) return fail('The two new passwords do not match');
      save.classList.add('loading'); save.disabled = true;
      try {
        await core.changePassword(cur.value, nw.value);
        mod.close(); u.toast('Password changed');
      } catch (e) {
        fail(e.code === 'network' ? 'Cannot reach the server' : (e.message || 'Could not change the password'));
        save.classList.remove('loading'); save.disabled = false;
      }
    });
    setTimeout(() => cur.focus(), 120);
  }

  /** Settings -> Change secret code. The code is the encryption key, so everything is re-encrypted (see core.changeCode). */
  function openChangeCode() {
    const mk = (ph) => h('input', { type: 'password', autocomplete: 'off', placeholder: ph, maxlength: 64, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
    const cur = mk('Current code'), nw = mk('New code (8 to 64 characters)'), cf = mk('Repeat the new code');
    const err = h('div', { class: 'err hidden' });
    const steps = h('div', { class: 'steps' });
    const save = h('button', { class: 'btn primary', type: 'submit' }, h('span', {}, 'Change code'), h('i', { class: 'spin' }));
    const form = h('form', { class: 'pf-body', autocomplete: 'off' }, err,
      h('label', { class: 'fld' }, h('span', {}, 'Current code'), cur),
      h('label', { class: 'fld' }, h('span', {}, 'New code'), nw),
      h('label', { class: 'fld' }, h('span', {}, 'Confirm new code'), cf),
      h('div', { class: 'muted small' }, 'The code is also the encryption key, so every message, reaction and file is re-encrypted with the new one. Your companion is asked for the new code the next time they open the sky. Tell them the code yourself: it is never sent anywhere.'),
      steps, save);
    const mod = openModal({ title: 'Change secret code', cls: 'profile', body: [form] });
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); err.style.animation = 'none'; void err.offsetWidth; err.style.animation = ''; };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.classList.add('hidden');
      if (!cur.value) return fail('Enter the current code');
      if (nw.value.length < 8) return fail('Use at least 8 characters');
      if (nw.value === cur.value) return fail('The new code must differ from the current one');
      if (nw.value !== cf.value) return fail('The two new codes do not match');
      save.classList.add('loading'); save.disabled = true;
      try { await core.changeCode(cur.value, nw.value, (t) => { steps.textContent = t; }); mod.close(); u.toast('Secret code changed'); }
      catch (e) { fail(e.code === 'network' ? 'Cannot reach the server' : (e.message || 'Could not change the code')); save.classList.remove('loading'); save.disabled = false; steps.textContent = ''; }
    });
    setTimeout(() => cur.focus(), 120);
  }

  function themeSeg() {
    const seg = h('div', { class: 'seg' });
    [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'orbit']].forEach(([v, l, i]) => seg.append(h('button', {
      type: 'button', class: S.settings.theme === v ? 'on' : '', html: u.ic(i) + '<span>' + l + '</span>',
      onclick: (e) => { core.setTheme(v); seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); u.haptic(8); },
    })));
    return seg;
  }

  function openSettings() {
    const sw = (label, sub, get, set) => {
      const t = h('button', { class: 'switch' + (get() ? ' on' : ''), role: 'switch', 'aria-checked': String(!!get()) }, h('i'));
      t.addEventListener('click', async () => { u.haptic(6); const v = await set(!get()); t.classList.toggle('on', !!get()); t.setAttribute('aria-checked', String(!!get())); return v; });
      return h('div', { class: 'set-row' }, h('div', {}, h('div', {}, label), h('div', { class: 'muted small' }, sub)), t);
    };
    const btn = (icon, title, sub, fn, danger) => h('button', { class: 'set-btn' + (danger ? ' danger' : ''), onclick: fn },
      h('span', { html: u.ic(icon) }), h('div', {}, h('div', {}, title), sub ? h('div', { class: 'muted small' }, sub) : null));
    const rows = [
      h('div', { class: 'set-sec' }, 'Appearance'), themeSeg(),
      h('div', { class: 'muted small pad' }, 'Auto is Light from 6 AM to 7 PM and Dark at night.'),
      h('div', { class: 'set-sec' }, 'Sound and effects'),
      sw('Sound effects', 'Pop, whoosh and reaction sounds', () => S.settings.sound, async (on) => { S.settings.sound = on; core.saveSettings(); if (on) { u.unlockAudio(); u.sfx('in'); } }),
      sw('Word effects', 'Confetti, hearts and fireworks for special words', () => S.settings.effects !== false, async (on) => { S.settings.effects = on; core.saveSettings(); if (on && MC.fx) MC.fx.confetti(); }),
      h('div', { class: 'set-sec' }, 'Alerts'),
      sw('Notifications', 'A quiet “new star” alert, even when the app is closed', () => S.settings.notif && 'Notification' in window && Notification.permission === 'granted', async (on) => {
        if (on) { S.settings.notif = true; const r = await core.askNotif(); S.settings.notif = r === 'granted'; if (r !== 'granted') u.toast('Allow notifications in your browser settings'); }
        else { S.settings.notif = false; core.dropPush(); }
        core.saveSettings(); maybeNotifBanner();
      }),
      h('div', { class: 'set-sec' }, 'Stealth Mode'),
      h('div', { class: 'muted small pad' }, 'This area hides at once when you leave the app, switch tabs or the screen turns off. To hide it yourself, shake the phone or press and hold the header (or an empty part of the conversation) for 3 seconds.'),
      sw('Shake to hide', 'Shake the phone to jump back to the sky', () => S.settings.shake !== false, async (on) => { S.settings.shake = on; core.saveSettings(); if (on) { const r = await MC.stealth.askMotion(); if (r === 'denied') u.toast('Motion access was declined'); } }),
      btn('key', 'Change secret code', 'The code you type in the “Name your planet” box. It is also the encryption key.', () => openChangeCode()),
      h('div', { class: 'set-sec' }, 'Security'),
      h('div', { class: 'muted small pad' }, 'The app locks when it is closed or away for over a minute. Log in again, then type your unlock code in the sky. The code is never stored on this device.'),
      btn('lock', 'Lock now', 'Alerts keep working', () => core.lockNow()),
      btn('edit', 'Change password', 'Your login password only. The unlock code stays the same.', () => openChangePassword()),
    ];
    if (ui.installEvt) rows.push(btn('download', 'Install Galaxy Relax', 'Add it to your home screen', async () => { ui.installEvt.prompt(); ui.installEvt = null; }));
    else if (/iphone|ipad/i.test(navigator.userAgent) && !window.navigator.standalone) rows.push(h('div', { class: 'muted small pad' }, 'iPhone: in Safari tap Share, then “Add to Home Screen”, to install the app.'));
    rows.push(btn('logout', 'Log out', null, () => confirmBox({ title: 'Log out?', text: 'This removes alerts and all other data from this device. You will log in and type your unlock code again next time.', ok: 'Log out', danger: true }).then((y) => { if (y) core.logout(); }), true));
    rows.push(h('div', { class: 'muted small pad' }, 'Galaxy Relax v' + (window.MYCHAT_VERSION || '?')));
    openModal({ title: 'Settings', cls: 'tall', body: [h('div', { class: 'set-list' }, rows)] });
  }

  // ================= Event binding =================
  function bindEvents() {
    bindMessages();
    el.btnMe.addEventListener('click', openProfile);
    el.btnTheme.addEventListener('click', quickTheme);
    el.railTheme.addEventListener('click', quickTheme);
    el.railSky.addEventListener('click', () => MC.stealth.hide('panic'));
    el.railStar.addEventListener('click', openStarred);
    el.railSettings.addEventListener('click', openSettings);
    el.railMe.addEventListener('click', openProfile);
    el.railChat.addEventListener('click', () => { if (S.current) el.input.focus(); });
    el.btnStarred.addEventListener('click', openStarred);
    el.btnMenu.addEventListener('click', () => {
      const r = el.btnMenu.getBoundingClientRect();
      showMenu([
        { icon: 'person', label: 'Profile', fn: openProfile },
        { icon: 'star', label: 'Starred messages', fn: openStarred },
        { icon: 'settings', label: 'Settings', fn: openSettings },
        { icon: 'moonStar', label: 'Back to the sky', fn: () => MC.stealth.hide('panic') },
        { icon: 'lock', label: 'Lock', fn: () => core.lockNow() },
        { icon: 'logout', label: 'Log out', danger: true, fn: () => confirmBox({ title: 'Log out?', text: 'This removes alerts and all other data from this device.', ok: 'Log out', danger: true }).then((y) => { if (y) core.logout(); }) },
      ], { x: r.right, y: r.bottom + 4, right: true });
    });
    el.nbOn.addEventListener('click', async () => { await core.askNotif(); maybeNotifBanner(); });
    el.nbX.addEventListener('click', () => { MC.LS.set('mychat.nbx', true); maybeNotifBanner(); });
    el.sbSearch.addEventListener('input', () => { sbSig = ''; ui.renderSidebar(); });
    el.sbSearchClear.addEventListener('click', () => { el.sbSearch.value = ''; sbSig = ''; ui.renderSidebar(); });

    el.btnBack.addEventListener('click', () => { if (history.state && history.state.chat) history.back(); else ui.closeChat(); });
    el.chInfo.addEventListener('click', openContact);
    el.btnSearch.addEventListener('click', () => { if (el.msgSearch.classList.contains('hidden')) openMsgSearch(); else closeMsgSearch(); });
    el.btnChmenu.addEventListener('click', () => {
      const r = el.btnChmenu.getBoundingClientRect();
      showMenu([
        { icon: 'person', label: 'Contact info', fn: openContact },
        { icon: 'search', label: 'Search', fn: openMsgSearch },
        { icon: 'star', label: 'Starred messages', fn: openStarred },
        { icon: 'moonStar', label: 'Back to the sky', fn: () => MC.stealth.hide('panic') },
      ], { x: r.right, y: r.bottom + 4, right: true });
    });
    el.msClose.addEventListener('click', () => closeMsgSearch());
    el.msInput.addEventListener('input', u.debounce(runSearch, 200));
    el.msInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? 1 : -1); } });
    el.msUp.addEventListener('click', () => gotoMatch(-1));
    el.msDown.addEventListener('click', () => gotoMatch(1));

    // composer
    el.input.addEventListener('input', () => { autosize(); updateSendState(); if (el.input.value.trim()) core.markTyping(); if (!S.editing && S.current) S.drafts[S.current] = el.input.value; });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !u.isTouch() && !e.isComposing) { e.preventDefault(); doSend(); }
    });
    el.input.addEventListener('focus', () => { if (isMobile()) toggleEmoji(false); setTimeout(() => { if (isNearBottom()) scrollBottom(); }, 300); });
    el.input.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); previewFiles(files); }
    });
    el.btnSend.addEventListener('mousedown', (e) => e.preventDefault());
    el.btnSend.addEventListener('click', () => { if (el.input.value.trim()) doSend(); else startRecording(); });
    el.btnEmoji.addEventListener('mousedown', (e) => e.preventDefault());
    el.btnEmoji.addEventListener('click', () => toggleEmoji());
    el.btnAttach.addEventListener('click', attachMenu);
    ['file-img', 'file-cam', 'file-doc'].forEach((id) => {
      const inp = document.getElementById(id);
      inp.addEventListener('change', () => { MC.stealth.release(); if (inp.files.length) previewFiles(inp.files); inp.value = ''; });
      inp.addEventListener('cancel', () => MC.stealth.release());
    });
    el.recCancel.addEventListener('click', () => stopRecording(false));
    el.recSend.addEventListener('click', () => { stopRecording(true); forceStick = true; });

    // drag & drop
    let dragN = 0;
    el.chat.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; el.dropHint.classList.remove('hidden'); } });
    el.chat.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) el.dropHint.classList.add('hidden'); });
    el.chat.addEventListener('dragover', (e) => e.preventDefault());
    el.chat.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; el.dropHint.classList.add('hidden'); if (e.dataTransfer.files.length) previewFiles(e.dataTransfer.files); });

    // keyboard: Esc
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !ui.ready) return;
      const lb = $('.lightbox'); if (lb) return lb.remove();
      if ($('#menu-root .menu')) return closeMenu();
      const ovs = document.querySelectorAll('.overlay'); if (ovs.length) return ovs[ovs.length - 1]._close();
      if (el.composer.classList.contains('recording')) return stopRecording(false);
      if (el.composer.classList.contains('emoji-open')) return toggleEmoji(false);
      if (S.editing || S.replyTo) return cancelReplyEdit();
      if (!el.msgSearch.classList.contains('hidden')) return closeMsgSearch();
      if (S.current) ui.closeChat();
    });

    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvt = e; });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => { setVh(); window.scrollTo(0, 0); if (ui.ready && isNearBottom()) scrollBottom(); });
    }
    window.addEventListener('resize', setVh);
    setInterval(() => { if (!document.hidden && ui.ready) ui.updateStatus(); }, 20000);
  }

  ui.confirmBox = confirmBox;
  ui.openSettings = openSettings;
})();
