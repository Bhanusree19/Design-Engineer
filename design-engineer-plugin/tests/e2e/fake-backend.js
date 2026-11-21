// Injected into the page before the plugin UI loads (page.addInitScript).
// Provides:
//  - a fake Figma main thread (parent.postMessage ↔ window "message"), with
//    clientStorage kept in localStorage so "reopen the plugin" works;
//  - a stateful fake Design Engineer backend behind window.fetch, in two modes:
//      'new'    — the backend from this branch (migration 011 applied),
//      'legacy' — today's backend: the newer routes answer Express's HTML 404.
// Tests read and change it through window.__fake.state() / .set().
(function () {
  'use strict';
  const KEY = '__fakeState';
  const STORE = '__fakeClientStorage';

  function defaults() {
    return {
      mode: 'new',
      seq: 100,
      tokens: ['tok-1'],
      refreshTokens: ['ref-1'],
      refreshFails: false,
      googleAuto: true,
      googlePolls: 0,
      user: { id: 'u1', email: 'hari@example.com' },
      github: { connected: false, user: 'harip0919' },
      githubRevoked: false,
      githubAuto: true,
      codex: { connected: false, user: null },
      codexAuto: true,
      profileModel: null,
      connections: [],
      projects: [],
      links: [],
      contexts: {},
      jobs: [],
      repos: [
        { fullName: 'acme/grocery-app', private: true },
        { fullName: 'acme/grocery-web', private: true },
        { fullName: 'acme/field-sales', private: false },
        { fullName: 'harip0919/grocery-prototype', private: false },
      ],
      branches: {
        'acme/grocery-app': ['main', 'develop'],
        'acme/grocery-web': ['main', 'redesign-2026'],
        'acme/field-sales': ['main', 'develop'],
        'harip0919/grocery-prototype': ['main'],
      },
      // What "reading the repo" finds, keyed by repo@branch. Default: a React Native app.
      repoContexts: {},
      usage: { plan: 'plus', planName: 'Plus', allowanceSeconds: 18000, usedSeconds: 5280, availableSeconds: 12720, remainingSeconds: 12720, reservedSeconds: 0, priceInr: 799, expiresAt: '2026-12-14T00:00:00Z' },
      nextRunSeconds: 363,
      nextJobFails: false,
      jobPollsToFinish: 3,
      selection: [
        { id: '1:1', name: 'Login', type: 'FRAME', width: 390, height: 844 },
        { id: '1:2', name: 'Home', type: 'FRAME', width: 390, height: 844 },
        { id: '1:3', name: 'Cart', type: 'FRAME', width: 390, height: 1180 },
      ],
      opened: [],
      calls: [],
    };
  }

  let S;
  // A test seeds the first open with __fakeSeed; reopening keeps the saved state.
  try {
    S = JSON.parse(localStorage.getItem(KEY)) || Object.assign(defaults(), JSON.parse(localStorage.getItem('__fakeSeed') || '{}'));
  } catch { S = defaults(); }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  save();

  window.__fake = {
    state: () => JSON.parse(JSON.stringify(S)),
    set: (patch) => { Object.assign(S, patch); save(); },
    reset: (patch) => { S = Object.assign(defaults(), patch || {}); save(); localStorage.removeItem(STORE); },
    storage: () => JSON.parse(localStorage.getItem(STORE) || '{}'),
    setStorage: (v) => localStorage.setItem(STORE, JSON.stringify(v)),
  };

  // Polling intervals run 20× faster so tests stay quick.
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => realSetInterval(fn, Math.max(15, (ms || 0) / 20), ...rest);
  window.open = (url) => { S.opened.push(String(url)); save(); return null; };
  try { document.execCommand = () => true; } catch { /* ignore */ }

  // ---------------------------------------------------------------------------
  // Fake Figma main thread
  // ---------------------------------------------------------------------------
  const storage = () => JSON.parse(localStorage.getItem(STORE) || '{}');
  const setStorage = (v) => localStorage.setItem(STORE, JSON.stringify(v));
  const reply = (msg) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: msg } })), 0);
  const fakeParent = {
    postMessage(data) {
      const msg = data && data.pluginMessage;
      if (!msg) return;
      const st = storage();
      switch (msg.type) {
        case 'get-saved-session': reply({ type: 'saved-session', session: st.session || null }); break;
        case 'save-session': st.session = msg.session; setStorage(st); reply({ type: 'session-saved' }); break;
        case 'clear-session': delete st.session; delete st.prefs; setStorage(st); reply({ type: 'session-cleared' }); break;
        case 'get-prefs': reply({ type: 'prefs', prefs: st.prefs || {} }); break;
        case 'set-prefs': {
          const text = JSON.stringify(msg.prefs || {});
          if (text.length <= 20000 && !/api[_-]?key|token|secret/i.test(text)) { st.prefs = msg.prefs; setStorage(st); }
          break;
        }
        case 'get-selection': reply({ type: 'selection-changed', selection: S.selection }); break;
        case 'extract-screens': {
          const picked = S.selection.filter((s) => msg.nodeIds.includes(s.id));
          reply({ type: 'extract-started', total: picked.length });
          setTimeout(() => reply({ type: 'screens-extracted', results: picked.map((s) => ({ screen: s.name, frame: { width: s.width, height: s.height }, nodes: [] })) }), 30);
          break;
        }
        default: break;
      }
    },
  };
  try { Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true }); } catch { window.parent = fakeParent; }

  // ---------------------------------------------------------------------------
  // Fake backend
  // ---------------------------------------------------------------------------
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const html404 = (method, path) => new Response(`<!DOCTYPE html>\n<html lang="en">\n<head><title>Error</title></head>\n<body><pre>Cannot ${method} ${path}</pre></body>\n</html>`, { status: 404, headers: { 'Content-Type': 'text/html' } });
  const id = (p) => `${p}-${++S.seq}`;
  const nowIso = () => new Date(Date.now() + S.seq).toISOString();
  const project = (pid) => S.projects.find((p) => p.id === pid);
  const isNew = () => S.mode === 'new';

  function syncLink(p) {
    if (!isNew() || !p.repository || !p.base_branch) return;
    const hit = S.links.find((l) => l.project_id === p.id && l.repository === p.repository && l.branch === p.base_branch);
    if (hit) Object.assign(hit, { stack: p.stack || null, stack_source: p.stack_source || null, repo_context: p.repo_context || hit.repo_context });
    else S.links.push({ id: id('link'), project_id: p.id, repository: p.repository, branch: p.base_branch, app_root: '', stack: p.stack || null, stack_source: p.stack_source || null, repo_context: p.repo_context || null, is_default: !S.links.some((l) => l.project_id === p.id && l.is_default), created_at: nowIso() });
  }
  const toLink = (l) => ({ id: l.id, projectId: l.project_id, repository: l.repository, branch: l.branch, appRoot: '', stack: l.stack, stackSource: l.stack_source, repoContext: l.repo_context, isDefault: l.is_default, lastCheckedAt: null, createdAt: l.created_at });
  const usage = () => Object.assign({}, S.usage);
  const githubOk = () => S.github.connected && !S.githubRevoked;
  const ghFail = () => json(401, { error: 'GitHub is not connected. Connect GitHub in the plugin first.', code: 'GITHUB_REAUTH_REQUIRED' });

  function context(repo, branch) {
    const c = S.repoContexts[`${repo}@${branch}`];
    if (c) return Object.assign({ repository: repo, branch }, c);
    return {
      version: 1, status: 'existing-app', stack: 'react-native', summary: 'Expo app with 14 components', repository: repo, branch,
      app: { root: '', stack: 'react-native', framework: 'expo', frameworkName: 'Expo', versions: { react: '18', reactNative: '0.74', expo: '51', next: null }, language: 'typescript', packageManager: 'npm', styling: ['StyleSheet'], uiLibraries: [], navigation: ['expo-router'], state: [], testing: [], components: { dirs: ['components'], count: 14, names: ['Button', 'Card'] }, screenDirs: ['app'], themeFiles: [], scripts: [] },
    };
  }

  async function handle(method, url, body, token) {
    const u = new URL(url, 'http://fake.local');
    const path = u.pathname;
    const q = u.searchParams;
    S.calls.push(`${method} ${path}`);
    if (S.calls.length > 400) S.calls.splice(0, 200);

    // --- unauthenticated ---
    if (path === '/auth/refresh' && method === 'POST') {
      if (S.refreshFails || !S.refreshTokens.includes(body.refreshToken)) return json(401, { error: 'Session expired' });
      const t = id('tok'); const r = id('ref');
      S.tokens.push(t); S.refreshTokens.push(r);
      return json(200, { accessToken: t, refreshToken: r, user: S.user });
    }
    if (path === '/auth/google/connect' && method === 'POST') {
      S.googlePolls = 0;
      return json(200, { url: 'https://accounts.google.com/o/oauth2/auth?fake=1', state: 'g-state' });
    }
    if (path === '/auth/google/status') {
      S.googlePolls++;
      if (!S.googleAuto || S.googlePolls < 2) return json(200, { status: 'pending' });
      const t = id('tok'); const r = id('ref');
      S.tokens.push(t); S.refreshTokens.push(r); S.refreshFails = false;
      return json(200, { status: 'done', session: { accessToken: t, refreshToken: r, user: S.user } });
    }

    // --- authenticated ---
    if (!token || !S.tokens.includes(token)) return json(401, { error: 'Invalid or expired access token', code: 'AUTH_EXPIRED' });

    if (path === '/auth/logout') return json(200, { success: true });
    if (path === '/auth/me') {
      return json(200, { user: S.user, profile: { email: S.user.email }, github: { connected: S.github.connected, githubUser: S.github.connected ? S.github.user : null }, projects: S.projects, codex: { connected: S.codex.connected, codexUser: S.codex.user } });
    }

    // GitHub
    if (path === '/api/github/connect') return json(200, { url: 'https://github.com/login/oauth/authorize?fake=1' });
    if (path === '/api/github/status') {
      if (S.githubAuto && S.calls.some((c) => c === 'POST /api/github/connect')) { S.github.connected = true; S.githubRevoked = false; }
      return json(200, { connected: S.github.connected, githubUser: S.github.connected ? S.github.user : null });
    }
    if (path === '/api/github/disconnect') { S.github.connected = false; return json(200, { success: true }); }
    if (path === '/api/repos') return githubOk() ? json(200, { repos: S.repos }) : ghFail();
    let m = /^\/api\/repos\/([^/]+)\/([^/]+)\/branches$/.exec(path);
    if (m) {
      if (!githubOk()) return ghFail();
      const full = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
      const list = S.branches[full];
      if (!list) return json(404, { error: 'Repository not found.' });
      return json(200, { branches: list.map((name) => ({ name })) });
    }

    // Codex + models
    if (path === '/auth/codex/status') return json(200, { connected: S.codex.connected, codexUser: S.codex.user });
    if (path === '/auth/codex/device' && method === 'POST') return json(200, { device_code: 'dev-1', interval: 2, deviceAuth: true, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'K7QD-42XMP' });
    if (path === '/auth/codex/device/dev-1/status') {
      if (S.codexAuto) { S.codex = { connected: true, user: 'hari@example.com' }; return json(200, { status: 'approved', codexUser: 'hari@example.com' }); }
      return json(200, { status: 'pending', codexUser: null });
    }
    if (path === '/api/models/connections' && method === 'POST') {
      if (body.apiKey === 'bad-key') return json(400, { error: 'Anthropic rejected this key. Check it is active and has billing set up.', code: 'KEY_REJECTED' });
      S.connections = S.connections.filter((c) => c.provider !== body.provider).concat([{ provider: body.provider, status: 'verified', updated_at: nowIso() }]);
      return json(200, { connected: true, verified: true, method: 'model-request', billingVerified: false });
    }
    if (path === '/api/models/verify' && method === 'POST') {
      if (S.connections.some((c) => c.provider === body.provider) || body.provider === 'opencode') return json(200, { connected: true, verified: true, method: 'model-request', billingVerified: false });
      return json(400, { error: 'Add an API key for this provider first.', code: 'KEY_REQUIRED' });
    }
    if (path === '/api/models') return json(200, { provider: q.get('provider'), models: [`${q.get('provider')}/big-pickle`, `${q.get('provider')}/fast`] });
    if (path === '/api/models/direct') return json(200, { models: ['model-a', 'model-b'] });

    // Newer routes (migration 011)
    const newRoute = /^\/api\/projects\/[^/]+\/(repos|builds)/.test(path) || path === '/api/account/model' || (path === '/api/models/connections' && method === 'GET');
    if (newRoute && !isNew()) return html404(method, path);
    if (path === '/api/models/connections') return json(200, { connections: S.connections.map((c) => ({ provider: c.provider, status: c.status, updatedAt: c.updated_at })) });
    if (path === '/api/account/model') {
      if (method === 'GET') return json(200, { model: S.profileModel });
      S.profileModel = { agent: body.agent, provider: body.provider || ({ codex: 'openai', claude: 'anthropic' })[body.agent] || 'opencode', model: body.model || null };
      return json(200, { model: S.profileModel });
    }

    // Billing
    if (path === '/api/billing/status') return json(200, { usage: usage(), paymentsEnabled: true, plans: [
      { slug: 'free', name: 'Free', build_minutes: 40, price_inr: 0, currency: 'INR', features: [], sort_order: 1 },
      { slug: 'plus', name: 'Plus', build_minutes: 100, price_inr: 799, currency: 'INR', features: [], sort_order: 2 },
      { slug: 'studio', name: 'Studio', build_minutes: 200, price_inr: 1699, currency: 'INR', features: [], sort_order: 3 },
    ] });
    if (path === '/api/billing/order') return json(200, { checkoutUrl: 'https://pay.example/checkout?fake=1' });
    if (path === '/api/billing/history') {
      return json(200, { payments: [], builds: S.jobs.filter((j) => j.billed != null || j.status !== 'queued').map((j) => ({ jobId: j.id, projectName: (project(j.project_id) || {}).name || null, status: j.status, bucket: 'paid', billedSeconds: j.billed || 0, meterState: j.status === 'running' ? 'running' : 'finished', screenCount: j.screens.length, createdAt: j.created_at, startedAt: null, finishedAt: null, error: j.error || null })) });
    }

    // Projects
    if (path === '/api/projects' && method === 'GET') return json(200, { projects: S.projects });
    if (path === '/api/projects' && method === 'POST') {
      const p = { id: id('proj'), user_id: S.user.id, name: body.name, description: body.description || null, status: 'active', repository: null, base_branch: null, stack: null, stack_source: null, repo_context: null, coding_agent: 'codex', model_provider: 'openai', model_id: null, created_at: nowIso(), updated_at: nowIso() };
      S.projects.unshift(p);
      return json(200, { project: p });
    }
    m = /^\/api\/projects\/([^/]+)(\/.*)?$/.exec(path);
    if (m) {
      const p = project(m[1]);
      const rest = m[2] || '';
      if (!p) return json(404, { error: 'Project not found.', code: isNew() && rest ? 'PROJECT_NOT_FOUND' : undefined });
      if (!rest) {
        if (method === 'GET') return json(200, { project: p, fetchedScreens: [] });
        if (method === 'DELETE') { S.projects = S.projects.filter((x) => x !== p); S.links = S.links.filter((l) => l.project_id !== p.id); return json(200, { success: true }); }
        if (method === 'PATCH') {
          const patch = Object.assign({}, body);
          if (patch.stack !== undefined) patch.stack_source = patch.stack ? 'user' : null;
          if (patch.repository !== undefined || patch.base_branch !== undefined) patch.repo_context = null;
          Object.assign(p, patch, { updated_at: nowIso() });
          syncLink(p);
          return json(200, { project: p });
        }
      }
      if (rest === '/repo-context' && method === 'POST') {
        if (!githubOk()) return ghFail();
        const c = context(p.repository, p.base_branch);
        const auto = c.status === 'existing-app' && !!c.stack;
        p.repo_context = c;
        if (auto) { p.stack = c.stack; p.stack_source = 'detected'; }
        syncLink(p);
        return json(200, { project: p, context: c, autoStack: auto });
      }
      if (rest === '/repos' && method === 'GET') {
        const list = S.links.filter((l) => l.project_id === p.id).sort((a, b) => (b.is_default - a.is_default) || a.created_at.localeCompare(b.created_at));
        const active = list.find((l) => l.repository === p.repository && l.branch === p.base_branch);
        return json(200, { links: list.map(toLink), activeLinkId: active ? active.id : null });
      }
      if (rest === '/repos' && method === 'POST') {
        if (S.links.some((l) => l.project_id === p.id && l.repository === body.repository && l.branch === body.branch)) return json(409, { error: 'That repository and branch are already linked.', code: 'ALREADY_LINKED' });
        const first = !S.links.some((l) => l.project_id === p.id);
        const l = { id: id('link'), project_id: p.id, repository: body.repository, branch: body.branch, app_root: '', stack: body.stack || null, stack_source: body.stack ? 'user' : null, repo_context: null, is_default: first, created_at: nowIso() };
        S.links.push(l);
        return json(201, { link: toLink(l) });
      }
      m = /^\/repos\/([^/]+)(\/activate)?$/.exec(rest);
      if (m) {
        const l = S.links.find((x) => x.id === m[1] && x.project_id === p.id);
        if (!l) return json(404, { error: 'Linked repository not found.', code: 'LINK_NOT_FOUND' });
        if (m[2] && method === 'POST') {
          Object.assign(p, { repository: l.repository, base_branch: l.branch, stack: l.stack, stack_source: l.stack ? (l.stack_source || 'user') : null, repo_context: l.repo_context });
          return json(200, { project: p, link: toLink(l) });
        }
        if (method === 'PATCH') {
          const wasActive = p.repository === l.repository && p.base_branch === l.branch;
          if (body.branch && body.branch !== l.branch) { l.branch = body.branch; l.repo_context = null; }
          if (body.isDefault) { S.links.forEach((x) => { if (x.project_id === p.id) x.is_default = false; }); l.is_default = true; }
          if (wasActive && body.branch) Object.assign(p, { base_branch: l.branch, repo_context: null });
          return json(200, { link: toLink(l) });
        }
        if (method === 'DELETE') {
          S.links = S.links.filter((x) => x !== l);
          const rest2 = S.links.filter((x) => x.project_id === p.id);
          let next = rest2.find((x) => x.is_default) || null;
          if (l.is_default && rest2.length) { next = rest2[0]; next.is_default = true; }
          if (p.repository === l.repository && p.base_branch === l.branch) {
            if (next) Object.assign(p, { repository: next.repository, base_branch: next.branch, stack: next.stack, stack_source: next.stack_source, repo_context: next.repo_context });
            else Object.assign(p, { repository: null, base_branch: null, repo_context: null });
          }
          return json(200, { success: true, defaultLinkId: next ? next.id : null });
        }
      }
      if (rest === '/builds') {
        return json(200, { startBufferSeconds: 10, builds: S.jobs.filter((j) => j.project_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((j) => ({ jobId: j.id, status: j.status, repository: j.repository, branch: j.base_branch, agent: j.agent, provider: null, model: null, screenCount: j.screens.length, billedSeconds: j.billed == null ? null : j.billed, pullRequestUrl: j.result ? j.result.pullRequestUrl : null, error: j.error || null, createdAt: j.created_at, startedAt: null, finishedAt: null })) });
      }
    }

    // Screens + jobs
    if (path === '/api/screens/fetch') return githubOk() ? json(200, { saved: body.screens.map((s) => `${s.screen}.json`), screenCount: body.screens.length }) : ghFail();
    if (path === '/api/screens/plan') {
      const p = project(body.projectId);
      if (!p.stack) return json(400, { error: 'Choose a technology stack for this project before planning.' });
      return json(200, { success: true, plan: `1. Build ${body.screens.map((s) => s.screen).join(', ')}\n2. Reuse existing components`, prompt: 'prompt', proposedBranch: 'implement/login-screens', stack: p.stack, repository: p.repository, baseBranch: p.base_branch, screens: [] });
    }
    if (path === '/api/screens/implement') {
      if (S.usage.availableSeconds < 60) return json(402, { error: 'You have used all your build minutes.', code: 'MINUTES_EXHAUSTED' });
      const p = project(body.projectId);
      const j = { id: `aaaaaaaa-0000-4000-8000-${String(++S.seq).padStart(12, '0')}`, project_id: p.id, status: 'queued', polls: 0, screens: body.screens.map((s) => s.screen), repository: p.repository, base_branch: p.base_branch, agent: p.coding_agent, created_at: nowIso(), result: null, error: null, billed: null };
      S.jobs.push(j);
      return json(200, { jobId: j.id, status: 'queued' });
    }
    m = /^\/api\/jobs\/(.+)$/.exec(path);
    if (m) {
      const j = S.jobs.find((x) => x.id === m[1]);
      if (!j) return json(404, { error: 'Implementation job not found.' });
      if (j.status === 'queued' || j.status === 'running') {
        j.polls++;
        if (j.polls >= 1) j.status = 'running';
        if (j.polls >= S.jobPollsToFinish) {
          const charged = S.nextRunSeconds + (isNew() ? 10 : 0);
          j.billed = charged;
          S.usage.usedSeconds += charged; S.usage.availableSeconds -= charged; S.usage.remainingSeconds -= charged;
          if (S.nextJobFails) { j.status = 'failed'; j.error = 'npm test exited with code 1'; }
          else { j.status = 'completed'; j.result = { screens: j.screens, branch: 'implement/login-screens', pullRequestUrl: `https://github.com/${j.repository}/pull/41` }; }
        }
      }
      return json(200, { id: j.id, status: j.status, result: j.result, error: j.error, createdAt: j.created_at, startedAt: null, finishedAt: null });
    }

    return html404(method, path);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return realFetch(input, init);
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    const headers = (init && init.headers) || {};
    const auth = headers.Authorization || headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    await new Promise((r) => setTimeout(r, 5));
    try {
      return await handle(method, url, body, token);
    } finally {
      save();
    }
  };
})();
