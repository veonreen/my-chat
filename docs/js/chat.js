/* MyChat — UI: sidebar, chat view, messages, composer, menus, modals */
(function () {
  const MC = window.MC;
  const { u, api } = MC;
  const S = MC.S;
  const core = MC.core;
  const { h, $ } = u;
  const ui = (MC.ui = { ready: false });
  const el = {};
  const nodes = new Map();      // msgId -> { row, sig }
  const seps = new Map();       // dayKey -> element
  let forceStick = false, loadingOlder = false, sbSig = '';
  let matches = [], matchIdx = -1;

  MC.showScreen = function (name) {
    ['splash', 'auth', 'keyscreen', 'neterr', 'app'].forEach((id) => {
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
      'input', 'btn-send', 's-mic', 's-send', 'rec-row', 'rec-cancel', 'rec-time', 'rec-send', 'emoji-panel', 'conn-banner'];
    ids.forEach((id) => { el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });
  }

  function fillIcons() {
    const set = (node, name) => { if (node) node.innerHTML = u.ic(name); };
    set(el.btnTheme, 'moon'); set(el.btnStarred, 'star'); set(el.btnMenu, 'more');
    set(el.nbIc, 'bell'); set(el.nbX, 'close'); set(el.sbSearchIc, 'search'); set(el.sbSearchClear, 'close');
    set(el.sbLock, 'lock'); set(el.emptyLock, 'lock'); set(el.btnBack, 'back');
    set(el.btnSearch, 'search'); set(el.btnChmenu, 'more'); set(el.msClose, 'close'); set(el.msIc, 'search');
    set(el.msUp, 'up'); set(el.msDown, 'down'); set(el.sdIc, 'down'); set(el.btnEmoji, 'emoji'); set(el.btnAttach, 'attach');
    set(el.sMic, 'mic'); set(el.sSend, 'send'); set(el.recCancel, 'trash'); set(el.recSend, 'send');
    ui.themeChanged();
    const pw = document.getElementById('pw-eye'); if (pw) pw.innerHTML = u.ic('eye');
    const ki = document.getElementById('key-ic'); if (ki) ki.innerHTML = u.ic('key');
    const ni = document.getElementById('neterr-ic'); if (ni) ni.innerHTML = u.ic('wifiOff');
  }

  ui.start = function () {
    MC.showScreen('app');
    if (!ui.ready) { cacheEls(); fillIcons(); bindEvents(); buildEmojiPanel(); ui.ready = true; setVh(); }
    ui.profileChanged();
    ui.renderSidebar();
    maybeNotifBanner();
    const peers = [...S.users.keys()].filter((x) => x !== S.uid);
    if (!isMobile() && peers.length === 1) ui.openChat(peers[0]);
  };

  ui.themeChanged = function () {
    if (!el.btnTheme) return;
    el.btnTheme.innerHTML = u.ic(core.resolvedTheme() === 'dark' ? 'sun' : 'moon');
  };

  ui.setConn = function (ok) {
    if (!el.connBanner) return;
    el.connBanner.classList.toggle('hidden', ok);
    el.connBanner.innerHTML = u.ic('wifiOff') + ' Connecting… (internet check karo)';
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
    if (!el.chatList) return;
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
      if (typing) { lastEl.classList.add('typing'); lastEl.textContent = 'typing...'; }
      else if (last) {
        if (last.from === S.uid && !last.deleted) lastEl.append(tickEl(last));
        lastEl.append(core.preview(last));
      } else lastEl.textContent = p.about || 'Say hi 👋';
      frag.append(h('div', { class: 'chat-row' + (S.current === p.uid ? ' active' : ''), onclick: () => ui.openChat(p.uid) },
        u.avatar(p),
        h('div', { class: 'cr-body' },
          h('div', { class: 'cr-top' }, h('span', { class: 'cr-name' }, p.name), h('span', { class: 'cr-time' + (unread ? ' unread' : '') }, last ? u.listTime(last.ts) : '')),
          h('div', { class: 'cr-bot' }, lastEl, unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null))));
    });

    if (q) {                      // messages me search
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
        q ? 'Kuch nahi mila' : peers.length ? '' : 'Abhi koi dusra user nahi hai.\nDusre user ko app ka link do aur signup karne bolo (same Secret Key ke saath).'));
    }
    el.chatList.replaceChildren(frag);
  };
  ui.presenceChanged = function () { ui.renderSidebar(); };

  ui.profileChanged = function () {
    if (!el.btnMe) return;
    el.btnMe.innerHTML = '';
    el.btnMe.append(u.avatar(S.me));
    if (S.current) fillHeader();
  };

  function maybeNotifBanner() {
    const show = 'Notification' in window && Notification.permission === 'default' && S.settings.notif && !MC.LS.get('mychat.nbx', false);
    el.notifBanner.classList.toggle('hidden', !show);
  }

  // ================= Open / close chat =================
  function fillHeader() {
    const p = S.users.get(S.current);
    if (!p) return;
    u.fillAvatar(el.chAvatar, p);
    el.chName.textContent = p.name;
    ui.updateStatus();
  }
  ui.updateStatus = function () {
    if (!S.current || !el.chStatus) return;
    const p = S.users.get(S.current), pr = S.peers[S.current];
    let txt = '', cls = '';
    if (pr && pr.typingTo === S.uid) { txt = 'typing...'; cls = 'typing'; }
    else if (pr && pr.online) { txt = 'online'; cls = 'online'; }
    else if (pr && pr.lastSeen > 1000) txt = u.lastSeen(pr.lastSeen);
    else if (p && p.lastSeen > 1000) txt = u.lastSeen(p.lastSeen);
    if (el.chStatus.textContent !== txt) el.chStatus.textContent = txt;
    el.chStatus.className = 'ch-status ' + cls;
  };

  ui.openChat = function (peer) {
    if (!S.users.has(peer)) return;
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
    if (!S.current) return;
    S.drafts[S.current] = el.input.value;
    S.current = null; S.replyTo = null; S.editing = null;
    document.body.classList.remove('chat-open');
    el.chat.classList.add('hidden'); el.emptyState.classList.remove('hidden');
    el.emojiPanel.parentElement.classList.remove('emoji-open');
    if (!fromPop && history.state && history.state.chat) history.back();
    sbSig = ''; ui.renderSidebar();
  };
  window.addEventListener('popstate', () => { if (S.current && isMobile()) ui.closeChat(true); });

  // ================= Messages rendering =================
  const isNearBottom = () => { const w = el.msgsWrap; return w.scrollHeight - w.scrollTop - w.clientHeight < 150; };
  const scrollBottom = (smooth) => { const w = el.msgsWrap; w.scrollTo({ top: w.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };

  const sigOf = (m) => [m.upd, m.status, m.pending ? 1 : 0, m.failed ? 1 : 0, m.uploading ? 1 : 0, m.starred, m.dec ? 1 : 0, S.searchQ, m._blob ? 1 : 0, m.edited, m.ts, (m.t || '').length].join('|');

  ui.localAdded = function () { forceStick = true; };
  ui.msgChanged = function (m) { if (S.current && core.peerOf(m) === S.current) ui.chatChanged(); };

  ui.chatChanged = function (forceAll) {
    if (!S.current || !el.msgs) return;
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
      if (!n) { n = { row: h('div', { class: 'row', dataset: { id: m.id } }), sig: '' }; nodes.set(m.id, n); }
      if (n.sig !== sg || forceAll) { fillRow(n.row, m); n.sig = sg; }
      n.row.classList.toggle('first', newDay || !prev || prev.from !== m.from || prev.deleted !== m.deleted);
      desired.push(n.row);
      prev = m;
    }
    const c = el.msgs;
    desired.forEach((d, i) => { if (c.children[i] !== d) c.insertBefore(d, c.children[i] || null); });
    while (c.children.length > desired.length) c.lastChild.remove();

    if (stick) { scrollBottom(false); markSeenLocal(); }
    updateFab();
  };

  let olderNode = null;
  function olderEl() {
    if (!olderNode) {
      olderNode = h('div', { class: 'older' }, h('i', { class: 'spin dark' }));
      new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadOlderUI(); }, { root: el.msgsWrap, rootMargin: '200px' }).observe(olderNode);
    }
    return olderNode;
  }
  async function loadOlderUI() {
    if (loadingOlder || !S.current || !S.more[S.current]) return;
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
      h('div', { class: 'q-name', style: { color: mine ? '' : u.colorFor((S.users.get(rp.u) || {}).username) } }, mine ? 'You' : core.nameOf(rp.u)),
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

  function fillRow(row, m) {
    const mine = m.from === S.uid;
    row.classList.remove('in', 'out'); row.classList.add(mine ? 'out' : 'in');
    row.classList.toggle('deleted', !!m.deleted);
    const q = S.searchQ;
    const b = h('div', { class: 'bubble' });
    let hasText = false;

    if (m.deleted) {
      b.classList.add('del');
      b.append(h('span', { class: 'del-txt' }, '🚫 ', mine ? 'You deleted this message' : 'This message was deleted'));
      hasText = true;
    } else {
      b.append(h('button', { class: 'chev', 'aria-label': 'Message options', html: u.ic('down') }));
      if (m.rp) b.append(quoteEl(m.rp));
      if (!m.dec) { b.append(h('div', { class: 'text undec' }, '🔒 Message decrypt nahi ho paya. Secret Key check karo.')); hasText = true; }
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
    if (m.failed) b.append(h('div', { class: 'retry' }, '⚠ Send nahi hua. Tap karke retry karo'));
    row.replaceChildren(h('div', { class: 'swipe-ic', html: u.ic('reply') }), b);
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
    const bar = el.replyBar; if (!bar) return;
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
    u.toast('Copy ho gaya');
  }
  function discard(m) {
    S.byId.delete(m.id);
    const a = S.msgs.get(m.to); if (a) a.splice(a.indexOf(m), 1);
    const n = nodes.get(m.id); if (n) { n.row.remove(); nodes.delete(m.id); }
    core.refreshUI();
  }

  function msgMenu(m, x, y) {
    if (!m || m.deleted) return;
    const mine = m.from === S.uid;
    const items = [];
    if (m.failed) {
      items.push({ icon: 'send', label: 'Retry', fn: () => core.retry(m) }, { icon: 'trash', label: 'Discard', danger: true, fn: () => discard(m) });
    } else if (!m.pending) {
      items.push({ icon: 'reply', label: 'Reply', fn: () => startReply(m) });
      if (m.t) items.push({ icon: 'copy', label: 'Copy', fn: () => copyText(m.t) });
      items.push({ icon: m.starred ? 'starO' : 'star', label: m.starred ? 'Unstar' : 'Star', fn: () => core.starMsg(m, !m.starred) });
      if (core.canEdit(m)) items.push({ icon: 'edit', label: 'Edit', fn: () => startEdit(m) });
      if (m.type !== 'text' && m.fileId) items.push({ icon: 'download', label: 'Download', fn: () => core.downloadFile(m) });
      if (mine) items.push({ icon: 'trash', label: 'Delete for everyone', danger: true, fn: () => confirmBox({ title: 'Delete message?', text: 'Ye message dono taraf se delete ho jayega.', ok: 'Delete', danger: true }).then((y2) => { if (y2) core.deleteMsg(m); }) });
    }
    showMenu(items, { x, y });
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
    } else u.toast('Message nahi mila');
  }

  function bindMessages() {
    const box = el.msgs;
    box.addEventListener('click', (e) => {
      const m = msgOf(e.target); if (!m) return;
      if (e.target.closest('.chev')) { const r = e.target.closest('.chev').getBoundingClientRect(); return msgMenu(m, r.right, r.bottom); }
      if (e.target.closest('.retry')) return core.retry(m);
      const q = e.target.closest('.quote'); if (q) return jumpTo(q.dataset.rid);
      if (e.target.closest('.media') && m.type === 'image') return lightbox(m);
      if (e.target.closest('.fc-dl') || (e.target.closest('.file-card') && !m.uploading)) return core.downloadFile(m);
      if (e.target.closest('.voice-btn')) return toggleVoice(m);
    });
    box.addEventListener('contextmenu', (e) => {
      const m = msgOf(e.target); if (!m || e.target.closest('a')) return;
      e.preventDefault(); msgMenu(m, e.clientX, e.clientY);
    });
    // swipe-to-reply + long press (touch)
    let t0 = null;
    box.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const row = e.target.closest('.row'); if (!row) return;
      const m = S.byId.get(row.dataset.id); if (!m || m.deleted || m.pending || m.failed) return;
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, row, m, dx: 0, lock: false, done: false };
      t0.timer = setTimeout(() => { if (t0 && !t0.lock) { t0.done = true; if (navigator.vibrate) navigator.vibrate(12); msgMenu(m, t.clientX, t.clientY); } }, 480);
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
      if (t0.lock && t0.dx > 60 && !t0.done) { if (navigator.vibrate) navigator.vibrate(8); startReply(t0.m); }
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
      }).catch(() => u.toast('Voice message load nahi hua'));
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
    try {
      await core.recStart();
    } catch (e) { u.toast(e && e.name === 'NotAllowedError' ? 'Mic ki permission do (browser settings)' : (e.message || 'Mic start nahi hua')); return; }
    el.composer.classList.add('recording');
    const t0 = Date.now();
    el.recTime.textContent = '0:00';
    recTimer = setInterval(() => { el.recTime.textContent = u.dur((Date.now() - t0) / 1000); }, 250);
  }
  async function stopRecording(send) {
    clearInterval(recTimer);
    el.composer.classList.remove('recording');
    await core.recStop(send);
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
    const pick = (id) => () => document.getElementById(id).click();
    const items = [
      { icon: 'doc', label: 'Document', color: '#7f66ff', fn: pick('file-doc') },
      { icon: 'image', label: 'Photos', color: '#007bfc', fn: pick('file-img') },
    ];
    if (u.isTouch()) items.push({ icon: 'camera', label: 'Camera', color: '#ff2e74', fn: pick('file-cam') });
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
    if (files.length > 1) body.append(h('div', { class: 'ap-more' }, `+ ${files.length - 1} aur file${files.length > 2 ? 's' : ''}`));
    const cap = h('input', { class: 'ap-cap', placeholder: 'Add a caption…', maxlength: 500 });
    const send = () => { core.sendFiles(files, cap.value.trim()); mod.close(); forceStick = true; };
    cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    const mod = openModal({
      title: files.length > 1 ? `${files.length} files bhejni hain` : 'Preview', cls: 'ap',
      body: [body, h('div', { class: 'ap-foot' }, cap, h('button', { class: 'send-btn on', 'aria-label': 'Send', html: u.ic('send'), onclick: send }))],
      onClose: () => urls.forEach((x) => URL.revokeObjectURL(x)),
    });
    setTimeout(() => cap.focus(), 80);
  }

  // ================= Search in chat =================
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
    items.forEach((it) => {
      menu.append(h('button', { class: 'mi' + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { closeMenu(); it.fn(); } },
        h('span', { class: 'mi-ic', style: it.color ? { background: it.color, color: '#fff' } : null, html: u.ic(it.icon) }), h('span', {}, it.label)));
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
      ov.classList.remove('show'); setTimeout(() => ov.remove(), 220);
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

  function cropSquare(file, size) {
    return new Promise((res, rej) => {
      const im = new Image(); const url = URL.createObjectURL(file);
      im.onload = () => {
        const s = Math.min(im.width, im.height);
        const cv = document.createElement('canvas'); cv.width = cv.height = size;
        cv.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        let q = 0.78, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 30000 && q > 0.3) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        res(out);
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
      im.src = url;
    });
  }

  function openProfile() {
    let photo; // undefined = unchanged, '' = removed
    const big = u.avatar(S.me, 140); big.classList.add('big', 'editable');
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const camBadge = h('span', { class: 'cam-badge', html: u.ic('camera') });
    const wrap = h('div', { class: 'pf-photo', onclick: () => fileIn.click() }, big, camBadge);
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      try { photo = await cropSquare(f, 192); u.fillAvatar(big, { photo, name: S.me.name, username: S.me.username }); } catch (e) { u.toast('Photo load nahi hui'); }
    });
    const name = h('input', { value: S.me.name, maxlength: 40, placeholder: 'Your name' });
    const about = h('input', { value: S.me.about || '', maxlength: 120, placeholder: 'About' });
    const save = h('button', { class: 'btn primary' }, h('span', {}, 'Save'), h('i', { class: 'spin' }));
    const rm = S.me.photo ? h('button', { class: 'link', onclick: () => { photo = ''; u.fillAvatar(big, { name: name.value, username: S.me.username }); } }, 'Remove photo') : null;
    const mod = openModal({
      title: 'Profile', cls: 'profile',
      body: [h('div', { class: 'pf-body' }, wrap, fileIn, rm,
        h('label', { class: 'fld' }, h('span', {}, 'Your name'), name),
        h('label', { class: 'fld' }, h('span', {}, 'About'), about),
        h('div', { class: 'muted small' }, '@' + S.me.username + ' · Naam, about aur photo encrypted store hote hain.'),
        save)],
    });
    save.addEventListener('click', async () => {
      save.classList.add('loading'); save.disabled = true;
      try {
        const p = { name: name.value.trim() || S.me.username, about: about.value.trim() };
        if (photo !== undefined) p.photo = photo;
        await core.saveProfile(p);
        u.toast('Profile save ho gaya'); mod.close();
      } catch (e) { u.toast(e.message || 'Save nahi hua'); save.classList.remove('loading'); save.disabled = false; }
    });
  }

  async function openContact() {
    const p = S.users.get(S.current); if (!p) return;
    const big = u.avatar(p, 160); big.classList.add('big');
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
        h('div', { class: 'ci-sec lockbox' }, h('span', { html: u.ic('lock') }), h('div', {}, h('b', {}, 'End-to-end encrypted'), h('div', { class: 'muted small' }, 'Messages aur files sirf aapke Secret Key se khulte hain. Dono ka code same hona chahiye: ' + code))))],
    });
  }

  function openStarred() {
    const list = [...S.byId.values()].filter((m) => m.starred && !m.deleted).sort((a, b) => b.ts - a.ts);
    const body = h('div', { class: 'st-list' });
    if (!list.length) body.append(h('div', { class: 'sb-empty' }, 'Koi starred message nahi.\nMessage par ⌄ dabake "Star" karo.'));
    let mod;
    list.forEach((m) => body.append(h('div', { class: 'st-item', onclick: () => { mod.close(); ui.openChat(core.peerOf(m)); setTimeout(() => jumpTo(m.id), 80); } },
      h('div', { class: 'st-top' }, h('b', {}, m.from === S.uid ? 'You' : core.nameOf(m.from)), h('span', {}, u.dayLabel(m.ts))),
      h('div', { class: 'st-txt' }, core.preview(m)))));
    mod = openModal({ title: 'Starred messages', cls: 'tall', body: [body] });
  }

  function openSettings() {
    const seg = h('div', { class: 'seg' });
    [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].forEach(([v, l]) => seg.append(h('button', { class: S.settings.theme === v ? 'on' : '', onclick: (e) => { core.setTheme(v); seg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, l)));
    const sw = (label, sub, get, set) => {
      const t = h('button', { class: 'switch' + (get() ? ' on' : ''), role: 'switch', 'aria-checked': String(!!get()) }, h('i'));
      t.addEventListener('click', async () => { const v = await set(!get()); t.classList.toggle('on', !!get()); t.setAttribute('aria-checked', String(!!get())); return v; });
      return h('div', { class: 'set-row' }, h('div', {}, h('div', {}, label), h('div', { class: 'muted small' }, sub)), t);
    };
    const rows = [
      h('div', { class: 'set-sec' }, 'Appearance'), h('div', { class: 'set-row col' }, seg),
      h('div', { class: 'set-sec' }, 'Notifications'),
      sw('Notifications', 'Naye message par alert (app band ho tab bhi, Web Push)', () => S.settings.notif && 'Notification' in window && Notification.permission === 'granted', async (on) => {
        if (on) { S.settings.notif = true; const r = await core.askNotif(); S.settings.notif = r === 'granted'; if (r !== 'granted') u.toast('Browser settings me notifications allow karo'); }
        else { S.settings.notif = false; core.dropPush(); }
        core.saveSettings(); maybeNotifBanner();
      }),
      sw('Message sounds', 'Send / receive tone', () => S.settings.sound, async (on) => { S.settings.sound = on; core.saveSettings(); if (on) { u.unlockAudio(); u.beep('in'); } }),
      h('div', { class: 'set-sec' }, 'Privacy & security'),
      h('button', { class: 'set-btn', onclick: () => confirmBox({ title: 'Secret Key badalni hai?', text: 'Is device se key hat jayegi. Wahi Secret Key dobara daalni padegi.', ok: 'Continue' }).then(async (y) => { if (y) { await MC.cr.delKey(S.uid); location.reload(); } }) },
        h('span', { html: u.ic('key') }), h('div', {}, h('div', {}, 'Secret Key dobara daalo'), h('div', { class: 'muted small' }, 'Is device se key hatao'))),
    ];
    if (ui.installEvt) rows.push(h('button', { class: 'set-btn', onclick: async () => { ui.installEvt.prompt(); ui.installEvt = null; } }, h('span', { html: u.ic('download') }), h('div', {}, h('div', {}, 'Install MyChat app'), h('div', { class: 'muted small' }, 'Home screen par add karo'))));
    else if (/iphone|ipad/i.test(navigator.userAgent) && !window.navigator.standalone) rows.push(h('div', { class: 'muted small pad' }, 'iPhone: Safari me Share ⬆ → "Add to Home Screen" se app install karo.'));
    rows.push(h('button', { class: 'set-btn danger', onclick: () => confirmBox({ title: 'Log out?', text: 'Aap logout ho jaoge.', ok: 'Log out', danger: true }).then((y) => { if (y) core.logout(); }) },
      h('span', { html: u.ic('logout') }), h('div', {}, 'Log out')));
    openModal({ title: 'Settings', cls: 'tall', body: [h('div', { class: 'set-list' }, rows)] });
  }

  // ================= Event binding =================
  function bindEvents() {
    bindMessages();
    el.btnMe.addEventListener('click', openProfile);
    el.btnTheme.addEventListener('click', () => { core.setTheme(core.resolvedTheme() === 'dark' ? 'light' : 'dark'); });
    el.btnStarred.addEventListener('click', openStarred);
    el.btnMenu.addEventListener('click', () => {
      const r = el.btnMenu.getBoundingClientRect();
      showMenu([
        { icon: 'person', label: 'Profile', fn: openProfile },
        { icon: 'star', label: 'Starred messages', fn: openStarred },
        { icon: 'settings', label: 'Settings', fn: openSettings },
        { icon: 'logout', label: 'Log out', danger: true, fn: () => confirmBox({ title: 'Log out?', text: 'Aap logout ho jaoge.', ok: 'Log out', danger: true }).then((y) => { if (y) core.logout(); }) },
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
      inp.addEventListener('change', () => { if (inp.files.length) previewFiles(inp.files); inp.value = ''; });
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
      if (e.key !== 'Escape') return;
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
      window.visualViewport.addEventListener('resize', () => { setVh(); window.scrollTo(0, 0); if (isNearBottom()) scrollBottom(); });
    }
    window.addEventListener('resize', setVh);
    setInterval(() => { if (!document.hidden) ui.updateStatus(); }, 20000);
  }

  ui.confirmBox = confirmBox;
  ui.openSettings = openSettings;
})();
