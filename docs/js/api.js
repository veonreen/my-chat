/* MyChat — backend (Apps Script) se baat karne wala chhota client.
 * POST + Content-Type text/plain => browser "preflight" nahi bhejta, isliye CORS error nahi aata.
 */
(function () {
  const MC = (window.MC = window.MC || {});

  class ApiError extends Error {
    constructor(code, msg) { super(msg || code); this.code = code; }
  }

  const api = (MC.api = {
    token: null,
    ApiError,
    async call(action, data, opts) {
      const url = window.MYCHAT_API;
      if (!url || /PASTE/.test(url)) throw new ApiError('no_api', 'Backend URL set nahi hai (docs/js/config.js)');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 25000);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action, token: api.token }, data || {})),
          signal: ctrl.signal,
          redirect: 'follow',
        });
      } catch (e) {
        throw new ApiError('network', 'Server se connect nahi ho pa raha');
      } finally {
        clearTimeout(timer);
      }
      let j;
      try { j = await res.json(); } catch (e) { throw new ApiError('bad_response', 'Server ne galat jawab diya'); }
      if (!j || !j.ok) throw new ApiError((j && j.error) || 'server', (j && j.msg) || 'Kuch gadbad ho gayi');
      return j;
    },
  });
})();
