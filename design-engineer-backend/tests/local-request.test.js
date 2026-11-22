'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { postLocalJson } = require('../services/local-request');
const jobErrors = require('../services/job-errors');

function server(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
}

test('posts JSON and returns status and parsed body after a slow response', async () => {
  const s = await server((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ echo: JSON.parse(raw), auth: req.headers.authorization }));
    }, 300));
  });
  try {
    const r = await postLocalJson(`http://127.0.0.1:${s.address().port}/x`, { headers: { Authorization: 'Bearer t' }, body: { a: 1 } });
    assert.equal(r.ok, true); assert.equal(r.status, 200);
    assert.deepEqual(r.body, { echo: { a: 1 }, auth: 'Bearer t' });
  } finally { s.close(); }
});

test('error statuses resolve with the body so the failure code is kept', async () => {
  const s = await server((req, res) => { req.resume(); req.on('end', () => { res.writeHead(500); res.end('{"code":"INVALID_API_KEY"}'); }); });
  try {
    const r = await postLocalJson(`http://127.0.0.1:${s.address().port}/x`, {});
    assert.equal(r.ok, false); assert.equal(jobErrors.fromResponse(r.body).code, 'INVALID_API_KEY');
  } finally { s.close(); }
});

test('our own time limit still applies and is reported as a timeout', async () => {
  const s = await server(() => {});
  try {
    await assert.rejects(postLocalJson(`http://127.0.0.1:${s.address().port}/x`, { timeoutMs: 200 }),
      (e) => e.name === 'TimeoutError' && jobErrors.classify(e) === 'AGENT_TIMEOUT');
  } finally { s.closeAllConnections(); s.close(); }
});
