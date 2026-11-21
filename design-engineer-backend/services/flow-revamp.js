'use strict';
// Deployment 09: project repository links, per-account AI model and per-project
// build history. Additive only: every existing route keeps working unchanged.
// Until migration 011 is applied these routes answer 404 NOT_AVAILABLE, which
// the plugin treats as "use today's behaviour".

const START_BUFFER_SECONDS = 10;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[^\s~^:?*\[\\]{1,250}$/;
const STACKS = ['react-native', 'react-js'];
const LINK_FIELDS = 'id,project_id,repository,branch,app_root,stack,stack_source,repo_context,is_default,last_checked_at,created_at,updated_at';

function notAvailable(error) {
  const msg = String(error && error.message || '');
  return /\(404\)/.test(msg) || /PGRST205/.test(msg) || /does not exist/i.test(msg)
    || /42703/.test(msg) || /Could not find the (table|column)/i.test(msg);
}
function duplicate(error) {
  const msg = String(error && error.message || '');
  return /\(409\)/.test(msg) || /23505/.test(msg) || /duplicate key/i.test(msg);
}
function fail(res, error, fallback) {
  if (notAvailable(error)) {
    return res.status(404).json({ error: 'This feature is not available yet.', code: 'NOT_AVAILABLE' });
  }
  if (duplicate(error)) {
    return res.status(409).json({ error: 'That repository and branch are already linked.', code: 'ALREADY_LINKED' });
  }
  return res.status(500).json({ error: fallback });
}
const uuidish = (v) => /^[0-9a-f-]{8,64}$/i.test(String(v || ''));
const first = (rows) => (Array.isArray(rows) ? rows[0] : null) || null;

function toLink(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    repository: row.repository,
    branch: row.branch,
    appRoot: row.app_root || '',
    stack: row.stack || null,
    stackSource: row.stack_source || null,
    repoContext: row.repo_context || null,
    isDefault: !!row.is_default,
    lastCheckedAt: row.last_checked_at || null,
    createdAt: row.created_at,
  };
}

function registerRoutes(app, deps) {
  const { requireUser, pgQuery, validateSelection, listConnections, billingHistory } = deps;

  async function ownProject(auth, id) {
    if (!uuidish(id)) return null;
    return first(await pgQuery('projects', {
      token: auth.token,
      query: `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&limit=1`,
    }));
  }
  async function links(auth, projectId) {
    const rows = await pgQuery('project_repos', {
      token: auth.token,
      query: `project_id=eq.${encodeURIComponent(projectId)}&select=${LINK_FIELDS}&order=is_default.desc,created_at.asc`,
    });
    return Array.isArray(rows) ? rows : [];
  }
  async function link(auth, projectId, linkId) {
    if (!uuidish(linkId)) return null;
    return first(await pgQuery('project_repos', {
      token: auth.token,
      query: `id=eq.${encodeURIComponent(linkId)}&project_id=eq.${encodeURIComponent(projectId)}&select=${LINK_FIELDS}&limit=1`,
    }));
  }
  async function patchLink(auth, linkId, body) {
    return first(await pgQuery('project_repos', {
      token: auth.token, method: 'PATCH', query: `id=eq.${encodeURIComponent(linkId)}&select=${LINK_FIELDS}`,
      body, prefer: 'return=representation',
    }));
  }
  // Copy a link onto the project: plan and implement read these fields.
  async function activate(auth, project, row) {
    return first(await pgQuery('projects', {
      token: auth.token, method: 'PATCH', query: `id=eq.${encodeURIComponent(project.id)}&select=*`,
      body: {
        repository: row.repository,
        base_branch: row.branch,
        stack: row.stack || null,
        stack_source: row.stack ? (row.stack_source || 'user') : null,
        repo_context: row.repo_context || null,
      },
      prefer: 'return=representation',
    }));
  }

  // --- repository links ------------------------------------------------------
  app.get('/api/projects/:id/repos', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const rows = await links(auth, project.id);
      const active = rows.find((r) => r.repository === project.repository && r.branch === project.base_branch);
      res.json({ links: rows.map(toLink), activeLinkId: active ? active.id : null });
    } catch (error) { fail(res, error, 'Could not load linked repositories.'); }
  });

  app.post('/api/projects/:id/repos', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    const body = req.body || {};
    const repository = String(body.repository || '').trim();
    const branch = String(body.branch || '').trim();
    const appRoot = String(body.appRoot || '').trim().replace(/^\/+|\/+$/g, '');
    if (!REPO_RE.test(repository)) return res.status(400).json({ error: 'Choose a repository as owner/name.' });
    if (!BRANCH_RE.test(branch)) return res.status(400).json({ error: 'Choose a valid branch.' });
    if (appRoot.length > 200 || appRoot.includes('..')) return res.status(400).json({ error: 'Invalid app folder.' });
    if (body.stack != null && !STACKS.includes(body.stack)) return res.status(400).json({ error: 'Unsupported stack.' });
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const existing = await links(auth, project.id);
      const makeDefault = existing.length === 0 || body.isDefault === true;
      if (makeDefault && existing.some((r) => r.is_default)) {
        await pgQuery('project_repos', {
          token: auth.token, method: 'PATCH',
          query: `project_id=eq.${encodeURIComponent(project.id)}&is_default=is.true`, body: { is_default: false },
        });
      }
      const row = first(await pgQuery('project_repos', {
        token: auth.token, method: 'POST', query: `select=${LINK_FIELDS}`,
        body: {
          project_id: project.id, user_id: auth.user.id, repository, branch, app_root: appRoot,
          stack: body.stack || null, stack_source: body.stack ? 'user' : null, is_default: makeDefault,
        },
        prefer: 'return=representation',
      }));
      if (!row) return res.status(500).json({ error: 'Could not link the repository.' });
      res.status(201).json({ link: toLink(row) });
    } catch (error) { fail(res, error, 'Could not link the repository.'); }
  });

  app.patch('/api/projects/:id/repos/:linkId', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    const body = req.body || {};
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const row = await link(auth, project.id, req.params.linkId);
      if (!row) return res.status(404).json({ error: 'Linked repository not found.', code: 'LINK_NOT_FOUND' });
      const patch = {};
      if (body.branch !== undefined) {
        const branch = String(body.branch || '').trim();
        if (!BRANCH_RE.test(branch)) return res.status(400).json({ error: 'Choose a valid branch.' });
        if (branch !== row.branch) { patch.branch = branch; patch.repo_context = null; }
      }
      if (body.stack !== undefined) {
        if (body.stack !== null && !STACKS.includes(body.stack)) return res.status(400).json({ error: 'Unsupported stack.' });
        patch.stack = body.stack; patch.stack_source = body.stack ? 'user' : null;
      }
      if (body.isDefault === true && !row.is_default) {
        await pgQuery('project_repos', {
          token: auth.token, method: 'PATCH',
          query: `project_id=eq.${encodeURIComponent(project.id)}&is_default=is.true`, body: { is_default: false },
        });
        patch.is_default = true;
      }
      if (!Object.keys(patch).length) return res.json({ link: toLink(row) });
      const updated = await patchLink(auth, row.id, patch);
      // Keep the project pointing at this link if it was the active one.
      const wasActive = project.repository === row.repository && project.base_branch === row.branch;
      if (wasActive && (patch.branch || patch.stack !== undefined)) await activate(auth, project, updated);
      res.json({ link: toLink(updated) });
    } catch (error) { fail(res, error, 'Could not update the linked repository.'); }
  });

  app.delete('/api/projects/:id/repos/:linkId', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const row = await link(auth, project.id, req.params.linkId);
      if (!row) return res.status(404).json({ error: 'Linked repository not found.', code: 'LINK_NOT_FOUND' });
      await pgQuery('project_repos', { token: auth.token, method: 'DELETE', query: `id=eq.${encodeURIComponent(row.id)}` });
      const rest = (await links(auth, project.id)).filter((r) => r.id !== row.id);
      let next = rest.find((r) => r.is_default) || null;
      if (row.is_default && rest.length) next = await patchLink(auth, rest[0].id, { is_default: true });
      const wasActive = project.repository === row.repository && project.base_branch === row.branch;
      if (wasActive) {
        if (next) await activate(auth, project, next);
        else {
          await pgQuery('projects', {
            token: auth.token, method: 'PATCH', query: `id=eq.${encodeURIComponent(project.id)}`,
            body: { repository: null, base_branch: null, repo_context: null },
          });
        }
      }
      res.json({ success: true, defaultLinkId: next ? next.id : null });
    } catch (error) { fail(res, error, 'Could not unlink the repository.'); }
  });

  app.post('/api/projects/:id/repos/:linkId/activate', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const row = await link(auth, project.id, req.params.linkId);
      if (!row) return res.status(404).json({ error: 'Linked repository not found.', code: 'LINK_NOT_FOUND' });
      const updated = await activate(auth, project, row);
      await patchLink(auth, row.id, { last_checked_at: new Date().toISOString() }).catch(() => null);
      res.json({ project: updated, link: toLink(row) });
    } catch (error) { fail(res, error, 'Could not switch the repository.'); }
  });

  // --- builds ------------------------------------------------------------------
  app.get('/api/projects/:id/builds', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const project = await ownProject(auth, req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found.', code: 'PROJECT_NOT_FOUND' });
      const jobs = await pgQuery('implementation_jobs', {
        token: auth.token,
        query: `project_id=eq.${encodeURIComponent(project.id)}&select=id,status,error,result,created_at,started_at,finished_at,repository,base_branch,coding_agent,model_provider,model_id&order=created_at.desc&limit=30`,
      });
      let billed = {};
      try {
        const history = await billingHistory(auth.user.id);
        for (const b of (history && history.builds) || []) billed[b.jobId] = b;
      } catch { billed = {}; }
      const builds = (Array.isArray(jobs) ? jobs : []).map((j) => {
        const b = billed[j.id];
        const result = j.result && typeof j.result === 'object' ? j.result : {};
        return {
          jobId: j.id,
          status: j.status,
          repository: j.repository || null,
          branch: j.base_branch || null,
          agent: j.coding_agent || null,
          provider: j.model_provider || null,
          model: j.model_id || null,
          screenCount: b ? b.screenCount : null,
          billedSeconds: b ? b.billedSeconds : null,
          pullRequestUrl: result.pullRequestUrl || result.prUrl || result.pr_url || null,
          fidelity: result.fidelity && result.fidelity.status === 'measured'
            ? { score: result.fidelity.score, grade: result.fidelity.grade, target: result.fidelity.target }
            : null,
          error: j.error ? String(j.error).slice(0, 160) : null,
          createdAt: j.created_at,
          startedAt: j.started_at || null,
          finishedAt: j.finished_at || null,
        };
      });
      res.json({ builds, startBufferSeconds: START_BUFFER_SECONDS });
    } catch (error) { fail(res, error, 'Could not load builds.'); }
  });

  // --- account model -------------------------------------------------------------
  app.get('/api/account/model', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const row = first(await pgQuery('profiles', {
        token: auth.token, query: `id=eq.${encodeURIComponent(auth.user.id)}&select=ai_agent,ai_provider,ai_model&limit=1`,
      }));
      const chosen = row && row.ai_agent;
      res.json({ model: chosen ? { agent: row.ai_agent, provider: row.ai_provider, model: row.ai_model || null } : null });
    } catch (error) { fail(res, error, 'Could not load the AI model.'); }
  });

  // POST, not PUT: the Cloudflare gateway only allows GET/POST/PATCH/DELETE.
  app.post('/api/account/model', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    const body = req.body || {};
    let selection;
    try {
      selection = validateSelection({ agent: body.agent, provider: body.provider || undefined, model: body.model || null });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const row = first(await pgQuery('profiles', {
        token: auth.token, method: 'PATCH',
        query: `id=eq.${encodeURIComponent(auth.user.id)}&select=ai_agent,ai_provider,ai_model`,
        body: { ai_agent: selection.agent, ai_provider: selection.provider, ai_model: selection.model },
        prefer: 'return=representation',
      }));
      if (!row) {
        await pgQuery('profiles', {
          token: auth.token, method: 'POST', query: 'on_conflict=id',
          body: { id: auth.user.id, email: auth.user.email || null, ai_agent: selection.agent, ai_provider: selection.provider, ai_model: selection.model },
          prefer: 'resolution=merge-duplicates',
        });
      }
      res.json({ model: { agent: selection.agent, provider: selection.provider, model: selection.model } });
    } catch (error) { fail(res, error, 'Could not save the AI model.'); }
  });

  // Which providers have a saved key. Never returns the credential itself.
  app.get('/api/models/connections', async (req, res) => {
    const auth = await requireUser(req, res); if (!auth) return;
    try {
      const rows = await listConnections(auth.user.id);
      res.json({
        connections: (Array.isArray(rows) ? rows : []).map((r) => ({
          provider: r.provider, status: r.status, updatedAt: r.updated_at || null,
        })),
      });
    } catch (error) { res.status(503).json({ error: 'Saved connections are unavailable.', code: 'CONNECTIONS_UNAVAILABLE' }); }
  });
}

module.exports = { registerRoutes, START_BUFFER_SECONDS, notAvailable, toLink };
