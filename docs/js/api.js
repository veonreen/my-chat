/* MyChat — backend client (v2: WebSocket / Socket.io).
 * - Normal actions (send, edit, seen, typing ...) WebSocket par chalte hain => instant.
 * - Server events PUSH karta hai: 'upd' (msgs), 'peers' (online), 'typing', 'pv' (profile).
 * - login/signup/config, upload/file (bade data) HTTP POST se jaate hain.
 * - Socket band ho to normal actions bhi HTTP fallback se chalte hain.
 */
(function () {
  const MC = (window.MC = window.MC || {});

  class ApiError extends Error {
    constructor(code, msg) { super(msg || code); this.code = code; }
  }
  const HTTP_ONLY = { config: 1, login: 1, signup: 1, upload: 1, file: 1 };

  const api = (MC.api = {
    token: null,
    ApiError,
    socket: null,
    connected: false,
    _h: {},
    base() { return String(window.MYCHAT_API || '').replace(/\/+$/, ''); },
    on(ev, fn) { (api._h[ev] = api._h[ev] || []).push(fn); },
    _emit(ev, d) { (api._h[ev] || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); },

    /** WebSocket kholo. Pehli baar connect hone par resolve; auth galat ho to ApiError('auth'). */
    connect() {
      if (!api.base() || /PASTE/.test(api.base())) return Promise.reject(new ApiError('no_api', 'Backend URL set nahi hai (docs/js/config.js)'));
      api.disconnect();
      return new Promise((resolve, reject) => {
        let first = true;
        const s = (api.socket = window.io(api.base(), {
          auth: (cb) => cb({ token: api.token, vis: !document.hidden }),
          transports: ['websocket', 'polling'],
          reconnectionDelay: 400, reconnectionDelayMax: 4000, timeout: 10000,
        }));
        s.on('connect', () => {
          api.connected = true; api._emit('state', true);
          if (first) { first = false; resolve(); } else api._emit('reconnected');
        });
        s.on('disconnect', () => { api.connected = false; api._emit('state', false); });
        s.on('connect_error', (e) => {
          api.connected = false;
          if (e && e.message === 'auth') {
            if (first) { first = false; s.close(); reject(new ApiError('auth', 'Session expire')); } else { s.close(); api._emit('autherr'); }
            return;
          }
          if (first) { first = false; s.close(); reject(new ApiError('network', 'Server se connect nahi ho pa raha')); }
          else api._emit('state', false);
        });
        ['upd', 'peers', 'typing', 'pv'].forEach((ev) => s.on(ev, (d) => api._emit(ev, d)));
      });
    },
    disconnect() {
      if (api.socket) { try { api.socket.removeAllListeners(); api.socket.close(); } catch (e) { /* ignore */ } }
      api.socket = null; api.connected = false;
    },

    async call(action, data, opts) {
      const timeout = (opts && opts.timeout) || 25000;
      const body = Object.assign({ action, token: api.token }, data || {});
      if (!HTTP_ONLY[action] && api.socket && api.connected) return api._rpc(body, timeout);
      return api._http(body, timeout);
    },

    _rpc(body, timeout) {
      return new Promise((resolve, reject) => {
        api.socket.timeout(timeout).emit('rpc', body, (err, j) => {
          if (err) return reject(new ApiError('network', 'Server se jawab nahi aaya'));
          api._done(j, resolve, reject);
        });
      });
    },

    async _http(body, timeout) {
      const url = api.base();
      if (!url || /PASTE/.test(url)) throw new ApiError('no_api', 'Backend URL set nahi hai (docs/js/config.js)');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let res;
      try {
        res = await fetch(url + '/api', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request => CORS preflight nahi
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        throw new ApiError('network', 'Server se connect nahi ho pa raha');
      } finally {
        clearTimeout(timer);
      }
      let j;
      try { j = await res.json(); } catch (e) { throw new ApiError('bad_response', 'Server ne galat jawab diya'); }
      return new Promise((resolve, reject) => api._done(j, resolve, reject));
    },

    _done(j, resolve, reject) {
      if (!j || !j.ok) return reject(new ApiError((j && j.error) || 'server', (j && j.msg) || 'Kuch gadbad ho gayi'));
      resolve(j);
    },
  });
})();
