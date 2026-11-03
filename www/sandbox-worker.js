// Runs agent-written code in isolation: no DOM, no storage, no access to app state.
// The only bridge out is http(), which the main thread performs (bypassing CORS in the app).
const pending = new Map();
let seq = 0;

function safe(x) {
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x, null, 1); } catch (_) { return String(x); }
}

self.onmessage = async e => {
  const msg = e.data;
  if (msg.type === 'http_result') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
    return;
  }
  if (msg.type !== 'run') return;

  const logs = [];
  const log = (...a) => { if (logs.length < 200) logs.push(a.map(safe).join(' ')); };
  console.log = console.info = console.warn = console.error = log;
  const http = (url, opts = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const body = opts.body == null || typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    self.postMessage({ type: 'http', id, url: String(url), opts: { method: opts.method, headers: opts.headers, body } });
  });

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('input', 'http', 'log', msg.code);
    const result = await fn(msg.input || {}, http, log);
    self.postMessage({ type: 'done', result: result === undefined ? null : safe(result), logs });
  } catch (err) {
    self.postMessage({ type: 'done', error: String((err && err.stack) || err), logs });
  }
};
