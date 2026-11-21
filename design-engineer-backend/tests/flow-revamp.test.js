'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const flow = require('../services/flow-revamp');
const { validateSelection } = require('../adapters');

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const PROJECT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FOREIGN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// A tiny PostgREST stand-in: eq./is. filters, order, limit, unique keys, and
// the 011 trigger that records a link when the project's repository changes.
function fakeDb({ migrated = true } = {}) {
  let n = 0;
  const id = () => `cccccccc-cccc-cccc-cccc-${String(++n).padStart(12, '0')}`;
  const t = {
    projects: [
      { id: PROJECT, user_id: USER, name: 'Web', repository: 'acme/web', base_branch: 'main', stack: 'react-js', stack_source: 'detected', repo_context: { framework: 'react' } },
      { id: FOREIGN, user_id: OTHER, name: 'Theirs', repository: 'x/y', base_branch: 'main' },
    ],
    project_repos: [],
    implementation_jobs: [],
    profiles: [{ id: USER, email: 'a@b.c' }],
  };
  const sync = (p) => {
    if (!migrated || !p.repository || !p.base_branch) return;
    const hit = t.project_repos.find((r) => r.project_id === p.id && r.repository === p.repository && r.branch === p.base_branch && r.app_root === '');
    if (hit) Object.assign(hit, { stack: p.stack || null, stack_source: p.stack_source || null, repo_context: p.repo_context || hit.repo_context });
    else t.project_repos.push({ id: id(), project_id: p.id, user_id: p.user_id, repository: p.repository, branch: p.base_branch, app_root: '', stack: p.stack || null, stack_source: p.stack_source || null, repo_context: p.repo_context || null, is_default: !t.project_repos.some((r) => r.project_id === p.id && r.is_default), created_at: new Date(Date.now() + n).toISOString() });
  };
  t.projects.forEach(sync);
  const calls = [];
  function filter(rows, q) {
    const params = new URLSearchParams(q);
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
      if (v === 'is.true') out = out.filter((r) => r[k] === true);
    }
    if (params.get('order')) {
      const keys = params.get('order').split(',').map((s) => s.split('.'));
      out = [...out].sort((a, b) => { for (const [k, d] of keys) { const x = a[k], y = b[k]; if (x === y) continue; const c = x > y ? 1 : -1; return d === 'desc' ? -c : c; } return 0; });
    }
    if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
    return out;
  }
  async function pgQuery(table, { token, method = 'GET', query = '', body }) {
    calls.push({ table, method, query, body });
    if (!migrated && table === 'project_repos') throw new Error('Database error on project_repos (404): Could not find the table \'public.project_repos\' in the schema cache');
    if (!migrated && table === 'profiles' && /ai_agent/.test(query + JSON.stringify(body || {}))) throw new Error('Database error on profiles (400): column profiles.ai_agent does not exist');
    const me = token === 'tok-user' ? USER : OTHER;
    const rows = t[table].filter((r) => (table === 'profiles' ? r.id === me : r.user_id === me));
    if (method === 'GET') return filter(rows, query).map((r) => JSON.parse(JSON.stringify(r)));
    if (method === 'POST') {
      if (table === 'project_repos') {
        if (t.project_repos.some((r) => r.project_id === body.project_id && r.repository === body.repository && r.branch === body.branch && r.app_root === body.app_root)) {
          throw new Error('Database error on project_repos (409): duplicate key value violates unique constraint "project_repos_unique_link"');
        }
        const row = { id: id(), repo_context: null, last_checked_at: null, created_at: new Date(Date.now() + n * 1000).toISOString(), ...body };
        t.project_repos.push(row); return [row];
      }
      const existing = t[table].find((r) => r.id === body.id);
      if (existing) Object.assign(existing, body); else t[table].push({ ...body });
      return [];
    }
    if (method === 'PATCH') {
      const hit = filter(rows, query);
      for (const r of hit) { Object.assign(r, body); if (table === 'projects') sync(r); }
      return hit;
    }
    if (method === 'DELETE') {
      const hit = filter(rows, query);
      t[table] = t[table].filter((r) => !hit.includes(r));
      if (table === 'projects') t.project_repos = t.project_repos.filter((r) => !hit.some((p) => p.id === r.project_id));
      return [];
    }
    throw new Error('unsupported');
  }
  return { t, pgQuery, calls };
}

async function setup(opts) {
  const db = fakeDb(opts);
  const app = express();
  app.use(express.json());
  const requireUser = async (req, res) => {
    const token = (req.headers.authorization || '').slice(7);
    if (!token) { res.status(401).json({ error: 'Missing access token' }); return null; }
    return { token, user: { id: token === 'tok-user' ? USER : OTHER, email: 'a@b.c' } };
  };
  flow.registerRoutes(app, {
    requireUser, pgQuery: db.pgQuery, validateSelection,
    listConnections: async () => [{ provider: 'anthropic', status: 'verified', updated_at: '2026-01-01', encrypted_credential: 'SECRET' }],
    billingHistory: async () => ({ builds: db.t.implementation_jobs.map((j) => ({ jobId: j.id, billedSeconds: j.billed, screenCount: 2 })) }),
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = 'tok-user') => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { db, call, close: () => server.close() };
}

test('lists the project\'s existing repository as the default, active link', async () => {
  const s = await setup();
  try {
    const r = await s.call('GET', `/api/projects/${PROJECT}/repos`);
    assert.equal(r.status, 200);
    assert.equal(r.body.links.length, 1);
    assert.deepEqual([r.body.links[0].repository, r.body.links[0].branch, r.body.links[0].isDefault], ['acme/web', 'main', true]);
    assert.equal(r.body.activeLinkId, r.body.links[0].id);
    assert.equal(r.body.links[0].stack, 'react-js');
  } finally { s.close(); }
});

test('requires sign-in', async () => {
  const s = await setup();
  try { assert.equal((await s.call('GET', `/api/projects/${PROJECT}/repos`, null, null)).status, 401); } finally { s.close(); }
});

test('another user\'s project is not found', async () => {
  const s = await setup();
  try {
    for (const [m, p] of [['GET', `/api/projects/${FOREIGN}/repos`], ['POST', `/api/projects/${FOREIGN}/repos`], ['GET', `/api/projects/${FOREIGN}/builds`]]) {
      const r = await s.call(m, p, m === 'POST' ? { repository: 'a/b', branch: 'main' } : null);
      assert.equal(r.status, 404, p);
    }
  } finally { s.close(); }
});

test('adds a second link that is not the default', async () => {
  const s = await setup();
  try {
    const r = await s.call('POST', `/api/projects/${PROJECT}/repos`, { repository: 'acme/mobile', branch: 'develop' });
    assert.equal(r.status, 201);
    assert.equal(r.body.link.isDefault, false);
    assert.equal(s.db.t.project_repos.filter((x) => x.project_id === PROJECT).length, 2);
    // The project's active repository is unchanged until activated.
    assert.equal(s.db.t.projects[0].repository, 'acme/web');
  } finally { s.close(); }
});

test('rejects a duplicate link with ALREADY_LINKED', async () => {
  const s = await setup();
  try {
    const r = await s.call('POST', `/api/projects/${PROJECT}/repos`, { repository: 'acme/web', branch: 'main' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'ALREADY_LINKED');
  } finally { s.close(); }
});

test('validates repository, branch and stack', async () => {
  const s = await setup();
  try {
    for (const body of [{ repository: 'nope', branch: 'main' }, { repository: 'a/b', branch: 'bad branch' }, { repository: 'a/b', branch: 'main', stack: 'vue' }, { repository: 'a/b', branch: 'main', appRoot: '../etc' }]) {
      assert.equal((await s.call('POST', `/api/projects/${PROJECT}/repos`, body)).status, 400, JSON.stringify(body));
    }
  } finally { s.close(); }
});

test('activating a link copies it onto the project used by plan and implement', async () => {
  const s = await setup();
  try {
    const add = await s.call('POST', `/api/projects/${PROJECT}/repos`, { repository: 'acme/mobile', branch: 'develop', stack: 'react-native' });
    const r = await s.call('POST', `/api/projects/${PROJECT}/repos/${add.body.link.id}/activate`);
    assert.equal(r.status, 200);
    const p = s.db.t.projects[0];
    assert.deepEqual([p.repository, p.base_branch, p.stack, p.stack_source], ['acme/mobile', 'develop', 'react-native', 'user']);
    const list = await s.call('GET', `/api/projects/${PROJECT}/repos`);
    assert.equal(list.body.activeLinkId, add.body.link.id);
    assert.equal(list.body.links.length, 2);
  } finally { s.close(); }
});

test('changing the branch of the active link repoints the project and clears its context', async () => {
  const s = await setup();
  try {
    const link = s.db.t.project_repos[0];
    const r = await s.call('PATCH', `/api/projects/${PROJECT}/repos/${link.id}`, { branch: 'release' });
    assert.equal(r.status, 200);
    assert.equal(r.body.link.branch, 'release');
    assert.equal(r.body.link.repoContext, null);
    assert.equal(s.db.t.projects[0].base_branch, 'release');
  } finally { s.close(); }
});

test('making a link the default clears the previous default', async () => {
  const s = await setup();
  try {
    const add = await s.call('POST', `/api/projects/${PROJECT}/repos`, { repository: 'acme/mobile', branch: 'develop' });
    const r = await s.call('PATCH', `/api/projects/${PROJECT}/repos/${add.body.link.id}`, { isDefault: true });
    assert.equal(r.body.link.isDefault, true);
    assert.equal(s.db.t.project_repos.filter((x) => x.project_id === PROJECT && x.is_default).length, 1);
  } finally { s.close(); }
});

test('unlinking the active default promotes the next link and repoints the project', async () => {
  const s = await setup();
  try {
    const add = await s.call('POST', `/api/projects/${PROJECT}/repos`, { repository: 'acme/mobile', branch: 'develop' });
    const first = s.db.t.project_repos[0];
    const r = await s.call('DELETE', `/api/projects/${PROJECT}/repos/${first.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.defaultLinkId, add.body.link.id);
    assert.deepEqual([s.db.t.projects[0].repository, s.db.t.projects[0].base_branch], ['acme/mobile', 'develop']);
    assert.equal(s.db.t.project_repos.find((x) => x.id === add.body.link.id).is_default, true);
  } finally { s.close(); }
});

test('unlinking the last link clears the project\'s repository', async () => {
  const s = await setup();
  try {
    const r = await s.call('DELETE', `/api/projects/${PROJECT}/repos/${s.db.t.project_repos[0].id}`);
    assert.equal(r.body.defaultLinkId, null);
    assert.equal(s.db.t.projects[0].repository, null);
  } finally { s.close(); }
});

test('builds list the project\'s jobs with billed seconds and the 10 s buffer', async () => {
  const s = await setup();
  try {
    s.db.t.implementation_jobs.push(
      { id: 'j1', user_id: USER, project_id: PROJECT, status: 'completed', result: { pullRequestUrl: 'https://github.com/acme/web/pull/3' }, repository: 'acme/web', base_branch: 'main', coding_agent: 'codex', created_at: '2026-01-02', billed: 373 },
      { id: 'j2', user_id: USER, project_id: PROJECT, status: 'failed', error: 'boom', created_at: '2026-01-01', billed: 190 },
      { id: 'j3', user_id: OTHER, project_id: FOREIGN, status: 'completed', created_at: '2026-01-03' },
    );
    const r = await s.call('GET', `/api/projects/${PROJECT}/builds`);
    assert.equal(r.status, 200);
    assert.equal(r.body.startBufferSeconds, 10);
    assert.deepEqual(r.body.builds.map((b) => [b.jobId, b.billedSeconds]), [['j1', 373], ['j2', 190]]);
    assert.equal(r.body.builds[0].pullRequestUrl, 'https://github.com/acme/web/pull/3');
    assert.equal(r.body.builds[1].error, 'boom');
  } finally { s.close(); }
});

test('account model: empty, then saved with POST, validated', async () => {
  const s = await setup();
  try {
    assert.deepEqual((await s.call('GET', '/api/account/model')).body, { model: null });
    const saved = await s.call('POST', '/api/account/model', { agent: 'claude' });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.model, { agent: 'claude', provider: 'anthropic', model: null });
    assert.deepEqual((await s.call('GET', '/api/account/model')).body.model, { agent: 'claude', provider: 'anthropic', model: null });
    assert.equal((await s.call('POST', '/api/account/model', { agent: 'codex', provider: 'anthropic' })).status, 400);
    assert.equal((await s.call('POST', '/api/account/model', { agent: 'skynet' })).status, 400);
  } finally { s.close(); }
});

test('saved connections never include the credential', async () => {
  const s = await setup();
  try {
    const r = await s.call('GET', '/api/models/connections');
    assert.deepEqual(r.body.connections, [{ provider: 'anthropic', status: 'verified', updatedAt: '2026-01-01' }]);
    assert.doesNotMatch(JSON.stringify(r.body), /SECRET/);
  } finally { s.close(); }
});

test('before migration 011 the new routes answer NOT_AVAILABLE so the plugin falls back', async () => {
  const s = await setup({ migrated: false });
  try {
    for (const [m, p, b] of [['GET', `/api/projects/${PROJECT}/repos`], ['POST', `/api/projects/${PROJECT}/repos`, { repository: 'a/b', branch: 'main' }], ['GET', '/api/account/model'], ['POST', '/api/account/model', { agent: 'codex' }]]) {
      const r = await s.call(m, p, b);
      assert.equal(r.status, 404, p);
      assert.equal(r.body.code, 'NOT_AVAILABLE', p);
    }
  } finally { s.close(); }
});

test('notAvailable recognises PostgREST missing-table and missing-column errors only', () => {
  assert.ok(flow.notAvailable(new Error('Database error on project_repos (404): Could not find the table')));
  assert.ok(flow.notAvailable(new Error('code 42703')));
  assert.ok(flow.notAvailable(new Error('column profiles.ai_agent does not exist')));
  assert.ok(!flow.notAvailable(new Error('Database error on projects (500): timeout')));
});
