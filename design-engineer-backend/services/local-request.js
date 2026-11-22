'use strict';
// POST JSON to this same server and wait as long as the build needs.
//
// Global fetch (undici) aborts when response headers take longer than
// 300 s (headersTimeout). The job container calls its own
// /api/screens/implement, which only answers when the whole build is done,
// so every build over 5 minutes failed even though the agent had finished.
// node:http has no such limit; the only limit here is timeoutMs.
const http = require('node:http');

function postLocalJson(url, { headers = {}, body = {}, timeoutMs = 17 * 60 * 1000 } = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const req = http.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (error) => done(reject, error));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { parsed = {}; }
        done(resolve, { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed });
      });
    });
    // No socket idle timeout: the build legitimately sends nothing for minutes.
    req.setTimeout(0);
    const timer = setTimeout(() => {
      const error = new Error('Implementation request timed out');
      error.name = 'TimeoutError';
      req.destroy(error);
      done(reject, error);
    }, timeoutMs);
    req.on('error', (error) => done(reject, error));
    req.end(payload);
  });
}

module.exports = { postLocalJson };
