// server.js
//
// Design Engineer backend — Supabase-backed rewrite.
//
// Everything that used to live in an in-memory Map / sessions.json / Docker
// volume now lives in Supabase:
//
//   auth.users             -> Supabase auth (built-in)
//   public.profiles        -> user profile
//   public.projects        -> user projects (with repository + base_branch)
//   public.github_connections -> encrypted GitHub tokens
//   public.codex_accounts  -> encrypted Codex CLI credentials (universal per user)
//   public.design_contexts -> saved Figma design contexts
//
// The plugin authenticates with a Supabase access token (Bearer). The backend
// validates it against Supabase auth and uses PostgREST with that same token,
// so RLS keeps every user on their own rows.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: '25mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 4000;

const BACKEND_URL =
  process.env.BACKEND_URL || `http://localhost:${PORT}`;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// 32-byte key for AES-256-GCM. Prefer a real ENCRYPTION_KEY in .env (64 hex
// chars). Falls back to a stable derivation so the flow works out of the box.
function resolveEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    return crypto
      .createHash('sha256')
      .update(`${SUPABASE_URL}|${GITHUB_CLIENT_SECRET}|${PORT}`)
      .digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

const ENCRYPTION_KEY = resolveEncryptionKey();

// Persistent Codex CLI home. This is the one local-on-disk dependency that the
// Codex CLI itself requires. The credentials are ALSO stored encrypted in
// Supabase (codex_accounts.credential_reference) so a login survives rebuilds
// and can be restored per user.
const CODEX_HOME =
  process.env.CODEX_HOME ||
  path.join(__dirname, '.codex');

const CODEX_CLI_BIN =
  path.join(
    __dirname,
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js'
  );

fs.mkdirSync(CODEX_HOME, { recursive: true });

// -----------------------------------------------------------------------------
// CRYPTO HELPERS (AES-256-GCM)
// -----------------------------------------------------------------------------

function encryptText(plainText) {
  if (plainText === null || plainText === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function decryptText(payload) {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// -----------------------------------------------------------------------------
// SUPABASE CLIENT (used for auth endpoints)
// -----------------------------------------------------------------------------

// @supabase/supabase-js v2.116+ requires a native WebSocket (Node >= 22).
// Fail fast with a clear message instead of the cryptic WebSocketFactory crash.
if (typeof globalThis.WebSocket === 'undefined') {
  console.error(
    '[Design Engineer] Node.js 22 or newer is required (native WebSocket missing).\n' +
      '  - Running locally: upgrade your Node installation to 22+.\n' +
      '  - Running in Docker: rebuild the image (Dockerfile now uses node:22-alpine).\n' +
      '    docker build -t design-engineer-backend .'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'x');

// -----------------------------------------------------------------------------
// POSTGREST HELPER (data tables, authenticated with the user's JWT so RLS applies)
// -----------------------------------------------------------------------------

async function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function pgQuery(table, { token, method = 'GET', query = '', body, prefer }) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const json = safeJson(text);

  if (!res.ok) {
    const detail = json && json.message ? json.message : text || res.statusText;
    throw new Error(`Database error on ${table} (${res.status}): ${detail}`);
  }

  return json;
}

// -----------------------------------------------------------------------------
// AUTH MIDDLEWARE
// -----------------------------------------------------------------------------

async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    res.status(401).json({ error: 'Missing access token' });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data || !data.user) {
    res.status(401).json({
      error: 'Invalid or expired access token',
      code: 'AUTH_EXPIRED',
    });
    return null;
  }

  return { token, user: data.user };
}

function mapAuthError(error) {
  const code = error?.code || error?.status || '';
  const msg = error?.message || 'Authentication failed.';

  if (code === 'user_already_exists' || /already registered/i.test(msg)) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (/invalid login credentials/i.test(msg)) {
    return 'Incorrect email or password.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Please confirm your email address before signing in.';
  }
  if (/password should be at least/i.test(msg) || /at least 6 characters/i.test(msg)) {
    return 'Password must be at least 8 characters.';
  }
  return msg;
}

// -----------------------------------------------------------------------------
// PROFILE HELPERS
// -----------------------------------------------------------------------------

async function getProfile(userId, token) {
  const rows = await pgQuery('profiles', {
    token,
    query: `id=eq.${userId}&select=*&limit=1`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertProfile(user, token) {
  const now = new Date().toISOString();
  await pgQuery('profiles', {
    token,
    method: 'POST',
    query: 'on_conflict=id',
    body: { id: user.id, email: user.email, updated_at: now },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

// -----------------------------------------------------------------------------
// AUTH ENDPOINTS
// -----------------------------------------------------------------------------

app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (cleanPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error) {
      return res.status(400).json({ error: mapAuthError(error) });
    }

    const user = data?.user;
    const session = data?.session;

    if (session && session.access_token && user) {
      // Session issued immediately: create the profile now.
      await upsertProfile(user, session.access_token).catch((e) =>
        console.error('[Design Engineer] Profile upsert warned:', e.message)
      );

      return res.json({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        user: { id: user.id, email: user.email, created_at: user.created_at },
      });
    }

    if (user) {
      // Email confirmation is required. A trigger creates the profile row.
      return res.json({
        confirmationRequired: true,
        email: user.email,
      });
    }

    return res.status(500).json({ error: 'Account creation failed. Please try again.' });
  } catch (error) {
    console.error('[Design Engineer] Sign up failed:', error);
    return res.status(500).json({ error: error.message || 'Sign up failed.' });
  }
});

app.post('/auth/signin', async (req, res) => {
  const { email, password } = req.body || {};

  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: String(password),
    });

    if (error || !data?.session) {
      return res.status(401).json({
        error: mapAuthError(error || { message: 'Invalid login credentials.' }),
      });
    }

    const session = data.session;
    const user = data.user;

    await upsertProfile(user, session.access_token).catch(() => {});

    return res.json({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      user: { id: user.id, email: user.email, created_at: user.created_at },
    });
  } catch (error) {
    console.error('[Design Engineer] Sign in failed:', error);
    return res.status(500).json({ error: error.message || 'Sign in failed.' });
  }
});

app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required.' });
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data?.session) {
      return res.status(401).json({
        error: 'Your session expired. Please sign in again.',
        code: 'AUTH_EXPIRED',
      });
    }

    const session = data.session;
    const user = data.user;

    return res.json({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      user: { id: user.id, email: user.email, created_at: user.created_at },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Refresh failed.' });
  }
});

// -----------------------------------------------------------------------------
// GITHUB CONNECTION HELPERS
// -----------------------------------------------------------------------------

async function getGithubConnectionRow(userId, token) {
  const rows = await pgQuery('github_connections', {
    token,
    query: `user_id=eq.${userId}&select=*&limit=1`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getGithubConnectionWithToken(userId, token) {
  const row = await getGithubConnectionRow(userId, token);
  if (!row || !row.access_token_encrypted) return null;
  return {
    ...row,
    githubToken: decryptText(row.access_token_encrypted),
  };
}

async function requireGithubConnection(auth, res) {
  const conn = await getGithubConnectionWithToken(auth.user.id, auth.token);
  if (!conn || !conn.githubToken) {
    res.status(401).json({
      error:
        'GitHub is not connected. Connect GitHub in the plugin first.',
      code: 'GITHUB_REAUTH_REQUIRED',
    });
    return null;
  }
  return conn;
}

// -----------------------------------------------------------------------------
// GITHUB OAUTH STATE  (short-lived, in-memory, standard OAuth transient state)
// -----------------------------------------------------------------------------

const oauthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function pruneOauthStates() {
  const now = Date.now();
  for (const [state, claim] of oauthStates) {
    if (claim.expiresAt < now) oauthStates.delete(state);
  }
}

app.post('/api/github/connect', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).json({
      error: 'GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not configured on the backend.',
    });
  }

  pruneOauthStates();

  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    userId: auth.user.id,
    accessToken: auth.token,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });

  const redirectUri = `${BACKEND_URL}/auth/github/callback`;
  const url =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}` +
    `&scope=${encodeURIComponent('repo read:user')}` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.json({ url });
});

app.get('/auth/github', (req, res) => {
  const { state } = req.query;

  const claim = oauthStates.get(state);
  if (!claim || claim.expiresAt < Date.now()) {
    return res
      .status(400)
      .send('GitHub authorization link expired. Close this tab and click Connect GitHub again in the plugin.');
  }

  const redirectUri = `${BACKEND_URL}/auth/github/callback`;
  const url =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}` +
    `&scope=${encodeURIComponent('repo read:user')}` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(url);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;

  const claim = oauthStates.get(state);
  if (!claim || claim.expiresAt < Date.now()) {
    return res
      .status(400)
      .send('Session expired. Close this tab and try connecting GitHub again from the plugin.');
  }

  oauthStates.delete(state);

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${BACKEND_URL}/auth/github/callback`,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      throw new Error(
        tokenData.error_description || 'No access token returned by GitHub'
      );
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'design-engineer-plugin',
      },
    });

    const userData = await userRes.json();

    const now = new Date().toISOString();

    const row = {
      user_id: claim.userId,
      github_user_id: userData.id,
      github_username: userData.login,
      access_token_encrypted: encryptText(tokenData.access_token),
      refresh_token_encrypted: tokenData.refresh_token
        ? encryptText(tokenData.refresh_token)
        : null,
      token_expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      scopes: tokenData.scope || 'repo read:user',
      connected_at: now,
      updated_at: now,
    };

    await pgQuery('github_connections', {
      token: claim.accessToken,
      method: 'POST',
      query: 'on_conflict=user_id',
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
    });

    console.log(`[Design Engineer] GitHub connected for user ${claim.userId} as @${userData.login}`);

    res.send(`
      <html>
        <body style="font-family:sans-serif;padding:40px">
          <h2>GitHub connected ✅</h2>
          <p>
            Signed in as <strong>${userData.login}</strong>.
            You can close this tab and return to Figma.
          </p>
        </body>
      </html>
    `);
  } catch (e) {
    console.error('[Design Engineer] GitHub authentication failed:', e);
    res.status(500).send(`GitHub auth failed: ${e.message}`);
  }
});

app.get('/api/github/status', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const row = await getGithubConnectionRow(auth.user.id, auth.token);

  res.json({
    connected: !!(row && row.access_token_encrypted),
    githubUser: row?.github_username || null,
  });
});

app.post('/api/github/disconnect', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  await pgQuery('github_connections', {
    token: auth.token,
    method: 'DELETE',
    query: `user_id=eq.${auth.user.id}`,
  });

  res.json({ success: true });
});

// -----------------------------------------------------------------------------
// PROJECTS
// -----------------------------------------------------------------------------

app.get('/api/projects', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    const rows = await pgQuery('projects', {
      token: auth.token,
      query: `user_id=eq.${auth.user.id}&order=created_at.desc&select=*`,
    });

    res.json({ projects: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error('[Design Engineer] Failed to list projects:', error);
    res.status(500).json({ error: error.message || 'Failed to list projects.' });
  }
});

app.post('/api/projects', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const { name, description } = req.body || {};

  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return res.status(400).json({ error: 'Project name is required.' });
  }

  try {
    const rows = await pgQuery('projects', {
      token: auth.token,
      method: 'POST',
      query: 'select=*',
      body: {
        user_id: auth.user.id,
        name: cleanName,
        description: String(description || '').trim() || null,
        status: 'active',
      },
      prefer: 'return=representation',
    });

    const project = Array.isArray(rows) ? rows[0] : null;
    if (!project) {
      return res.status(500).json({ error: 'Could not create the project.' });
    }

    res.json({ project });
  } catch (error) {
    console.error('[Design Engineer] Failed to create project:', error);
    res.status(500).json({
      error: error.message || 'Failed to create project.',
    });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    const rows = await pgQuery('projects', {
      token: auth.token,
      query: `id=eq.${req.params.id}&select=*&limit=1`,
    });

    const project = Array.isArray(rows) ? rows[0] : null;
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const contexts = await pgQuery('design_contexts', {
      token: auth.token,
      query: `project_id=eq.${req.params.id}&select=screen_name,updated_at`,
    });

    res.json({
      project,
      fetchedScreens: Array.isArray(contexts) ? contexts : [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load project.' });
  }
});

app.patch('/api/projects/:id', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const allowed = ['name', 'description', 'status', 'repository', 'base_branch'];
  const body = req.body || {};
  const patch = {};

  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  try {
    const rows = await pgQuery('projects', {
      token: auth.token,
      method: 'PATCH',
      query: `id=eq.${req.params.id}`,
      body: patch,
      prefer: 'return=representation',
    });

    const project = Array.isArray(rows) ? rows[0] : null;
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update project.' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    await pgQuery('projects', {
      token: auth.token,
      method: 'DELETE',
      query: `id=eq.${req.params.id}`,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete project.' });
  }
});

// -----------------------------------------------------------------------------
// ME
// -----------------------------------------------------------------------------

app.get('/auth/me', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    const [profile, github, projects, codexRow] = await Promise.all([
      getProfile(auth.user.id, auth.token),
      getGithubConnectionRow(auth.user.id, auth.token),
      pgQuery('projects', {
        token: auth.token,
        query: `user_id=eq.${auth.user.id}&order=created_at.desc&select=*`,
      }),
      pgQuery('codex_accounts', {
        token: auth.token,
        query: `user_id=eq.${auth.user.id}&select=*&limit=1`,
      }),
    ]);

    const codexSaved = !!(
      Array.isArray(codexRow)
        ? codexRow[0]?.credential_reference
        : null
    );

    let codexConnected = codexSaved;
    if (codexSaved) {
      codexConnected = await ensureCodexCredential(auth.user.id, auth.token);
    } else {
      codexConnected = (await getCodexLoginStatus()) === 'connected';
    }

    res.json({
      user: {
        id: auth.user.id,
        email: auth.user.email,
        created_at: auth.user.created_at,
      },
      profile: profile || null,
      github: {
        connected: !!(github && github.access_token_encrypted),
        githubUser: github?.github_username || null,
      },
      projects: Array.isArray(projects) ? projects : [],
      codex: codexConnected
        ? {
            connected: true,
            codexUser: 'Codex CLI user',
          }
        : {
            connected: false,
            codexUser: null,
            credentialsSaved: codexSaved,
          },
    });
  } catch (error) {
    console.error('[Design Engineer] /auth/me failed:', error);
    res.status(500).json({ error: error.message || 'Failed to load account.' });
  }
});

// -----------------------------------------------------------------------------
// CODEX AUTH
// -----------------------------------------------------------------------------

const deviceSessions = new Map();

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function getCodexLoginStatus() {
  return new Promise((resolve) => {
    if (!fs.existsSync(CODEX_CLI_BIN)) {
      console.error('[Design Engineer] Codex CLI not found:', CODEX_CLI_BIN);
      resolve('pending');
      return;
    }

    const statusChild = spawn(
      process.execPath,
      [CODEX_CLI_BIN, 'login', 'status'],
      {
        cwd: __dirname,
        env: { ...process.env, CODEX_HOME, HOME: CODEX_HOME },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    statusChild.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    statusChild.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    statusChild.on('close', (code) => {
      const combined = `${stdout}\n${stderr}`;
      const loggedIn =
        code === 0 &&
        (/logged in/i.test(combined) ||
          /authenticated/i.test(combined) ||
          /signed in/i.test(combined)) &&
        !/not logged in/i.test(combined);

      resolve(loggedIn ? 'connected' : 'pending');
    });

    statusChild.on('error', () => resolve('pending'));
  });
}

function readCodexAuthFile() {
  const authPath = path.join(CODEX_HOME, 'auth.json');
  if (!fs.existsSync(authPath)) return null;
  try {
    return fs.readFileSync(authPath, 'utf8');
  } catch {
    return null;
  }
}

function parseCodexUser(authJson) {
  try {
    const parsed = JSON.parse(authJson);
    const candidate =
      parsed.email ||
      parsed.user?.email ||
      parsed.userinfo?.email ||
      parsed.account?.email;
    const userId =
      parsed.user_id ||
      parsed.user?.id ||
      parsed.userinfo?.sub ||
      parsed.tokens?.id_token;
    return {
      email: typeof candidate === 'string' ? candidate : null,
      userId: userId
        ? String(userId).slice(0, 128)
        : (() => {
            const token =
              parsed.tokens?.access_token ||
              parsed.OPENAI_API_KEY ||
              authJson;
            return crypto
              .createHash('sha256')
              .update(token)
              .digest('hex')
              .slice(0, 32);
          })(),
    };
  } catch {
    return { email: null, userId: 'codex-cli-user' };
  }
}

async function persistCodexCredentials(userId, token) {
  const authJson = readCodexAuthFile();
  if (!authJson) return;

  const configTomlPath = path.join(CODEX_HOME, 'config.toml');
  let configToml = null;
  if (fs.existsSync(configTomlPath)) {
    try {
      configToml = fs.readFileSync(configTomlPath, 'utf8');
    } catch {
      configToml = null;
    }
  }

  const info = parseCodexUser(authJson);
  const encrypted = encryptText(
    JSON.stringify({ authJson, configToml })
  );

  const now = new Date().toISOString();

  await pgQuery('codex_accounts', {
    token,
    method: 'POST',
    query: 'on_conflict=user_id',
    body: {
      user_id: userId,
      codex_user_id: info.userId,
      codex_email: info.email,
      auth_type: 'codex-cli-device-auth',
      credential_reference: encrypted,
      status: 'active',
      last_verified_at: now,
      updated_at: now,
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

async function findCodexAccount(userId, token) {
  const rows = await pgQuery('codex_accounts', {
    token,
    query: `user_id=eq.${userId}&select=*&limit=1`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

// Restores the user's Codex CLI credentials from the DB when CODEX_HOME does
// not already hold them. Returns true when the CLI is authenticated for this
// user afterwards.
async function ensureCodexCredential(userId, token) {
  const acc = await findCodexAccount(userId, token);

  if (!acc || !acc.credential_reference) {
    return (await getCodexLoginStatus()) === 'connected';
  }

  let stored;
  try {
    stored = JSON.parse(decryptText(acc.credential_reference));
  } catch (error) {
    console.error('[Design Engineer] Failed to decrypt Codex credentials:', error);
    return false;
  }

  const currentAuthJson = readCodexAuthFile();

  if (
    currentAuthJson &&
    stored.authJson &&
    currentAuthJson.trim() === stored.authJson.trim()
  ) {
    // CODEX_HOME already holds this user's credentials.
    if ((await getCodexLoginStatus()) === 'connected') {
      return true;
    }
  }

  // Restore this user's credentials into CODEX_HOME.
  try {
    fs.mkdirSync(CODEX_HOME, { recursive: true });
    if (stored.authJson) {
      fs.writeFileSync(path.join(CODEX_HOME, 'auth.json'), stored.authJson, 'utf8');
    }
    if (stored.configToml) {
      fs.writeFileSync(path.join(CODEX_HOME, 'config.toml'), stored.configToml, 'utf8');
    }
  } catch (error) {
    console.error('[Design Engineer] Failed to restore Codex credentials:', error);
    return false;
  }

  return (await getCodexLoginStatus()) === 'connected';
}

function markCodexConnected() {
  // No-op in the DB world: we persist credentials on approval. Kept as a
  // single place to update last_verified_at if needed later.
}

app.get('/auth/codex/status', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    const connected = await ensureCodexCredential(auth.user.id, auth.token);

    if (connected) {
      await persistCodexCredentials(auth.user.id, auth.token).catch(() => {});
      return res.json({ connected: true, codexUser: 'Codex CLI user' });
    }

    const acc = await findCodexAccount(auth.user.id, auth.token);

    return res.json({
      connected: false,
      codexUser: acc?.codex_email || null,
      credentialsSaved: !!acc,
    });
  } catch (error) {
    console.error('[Design Engineer] Codex status check failed:', error);
    return res.json({ connected: false, codexUser: null });
  }
});

function waitForCodexDeviceAuth(deviceCode, userId, accessToken) {
  return new Promise((resolve, reject) => {
    const entry = deviceSessions.get(deviceCode);

    if (!entry) {
      reject(new Error('Session expired before Codex CLI auth started.'));
      return;
    }

    if (!fs.existsSync(CODEX_CLI_BIN)) {
      reject(
        new Error(
          'Codex CLI is not installed in this backend. Install @openai/codex or rebuild the Docker image.'
        )
      );
      return;
    }

    const child = spawn(
      process.execPath,
      [CODEX_CLI_BIN, 'login', '--device-auth'],
      {
        cwd: __dirname,
        env: { ...process.env, CODEX_HOME, HOME: CODEX_HOME },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    entry.process = child;

    let buffer = '';
    let promptAccepted = false;

    const parseOutput = (chunk) => {
      buffer += chunk.toString();

      const cleanBuffer = buffer.replace(/\u001b\[[0-9;]*m/g, '');

      const urlMatch = cleanBuffer.match(/https?:\/\/[^\s]+/g);
      const codeMatch =
        cleanBuffer.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/) ||
        cleanBuffer.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);

      const authUrl =
        urlMatch &&
        urlMatch.find((value) => value.includes('auth.openai.com'));

      if (authUrl && codeMatch) {
        entry.verificationUri = authUrl.trim();
        entry.verificationUriComplete = authUrl.trim();
        entry.userCode = codeMatch[0].trim();
        entry.status = 'pending';
        resolve();
      }

      if (
        !promptAccepted &&
        cleanBuffer.includes('Continue only if you started this login in Codex')
      ) {
        child.stdin.write('\n');
        promptAccepted = true;
      }
    };

    child.stdout.on('data', parseOutput);
    child.stderr.on('data', parseOutput);

    child.on('error', (error) => {
      entry.status = 'expired';
      reject(error);
    });

    child.on('exit', async (code) => {
      if (entry.status !== 'approved') {
        entry.status = code === 0 ? 'approved' : 'expired';
      }

      if (
        entry.status === 'approved' &&
        (await getCodexLoginStatus()) === 'connected'
      ) {
        entry.codexUser = 'Codex CLI user';

        // IMPORTANT: persist the credentials into Supabase so the login
        // survives container rebuilds and other account switches.
        await persistCodexCredentials(userId, accessToken).catch((error) =>
          console.error('[Design Engineer] Failed to persist Codex credentials:', error)
        );
      }
    });
  });
}

app.post('/auth/codex/device', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    const alreadyConnected = await ensureCodexCredential(auth.user.id, auth.token);

    if (alreadyConnected) {
      await persistCodexCredentials(auth.user.id, auth.token).catch(() => {});
      console.log(`[Design Engineer] Codex already authenticated for user ${auth.user.id}`);

      return res.json({
        device_code: '',
        user_code: '',
        verification_uri: '',
        verification_uri_complete: '',
        expires_in: 0,
        interval: 3,
        alreadyAuthenticated: true,
        codexUser: 'Codex CLI user',
      });
    }

    const deviceCode = newId();

    const entry = {
      deviceCode,
      userId: auth.user.id,
      accessToken: auth.token,
      status: 'pending',
      codexUser: null,
      process: null,
      verificationUri: 'https://auth.openai.com/codex/device',
      verificationUriComplete: 'https://auth.openai.com/codex/device',
      userCode: null,
    };

    deviceSessions.set(deviceCode, entry);

    await waitForCodexDeviceAuth(deviceCode, auth.user.id, auth.token);

    res.json({
      device_code: deviceCode,
      user_code: entry.userCode,
      verification_uri: entry.verificationUri,
      verification_uri_complete: entry.verificationUriComplete,
      expires_in: 900,
      interval: 3,
    });
  } catch (error) {
    console.error('[Design Engineer] Codex device auth failed:', error);
    res.status(500).json({ error: error.message || 'Codex CLI authentication failed.' });
  }
});

app.get('/auth/codex/device/:deviceCode/status', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const entry = deviceSessions.get(req.params.deviceCode);

  if (!entry || entry.userId !== auth.user.id) {
    return res.status(404).json({ status: 'expired', codexUser: null });
  }

  if (entry.status === 'pending') {
    const loginStatus = await getCodexLoginStatus();
    if (loginStatus === 'connected') {
      entry.status = 'approved';
      entry.codexUser = 'Codex CLI user';
      await persistCodexCredentials(entry.userId, entry.accessToken).catch(
        (error) =>
          console.error('[Design Engineer] Failed to persist Codex credentials:', error)
      );
    }
  }

  res.json({
    status: entry.status,
    codexUser: entry.codexUser,
  });
});

app.post('/auth/codex/logout', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    if (fs.existsSync(CODEX_CLI_BIN)) {
      await runProcess(
        process.execPath,
        [CODEX_CLI_BIN, 'logout'],
        {
          cwd: __dirname,
          env: { ...process.env, CODEX_HOME, HOME: CODEX_HOME },
        }
      );
    }

    // Keep the row (so their login can be restored later) but mark it inactive.
    await pgQuery('codex_accounts', {
      token: auth.token,
      method: 'PATCH',
      query: `user_id=eq.${auth.user.id}`,
      body: { status: 'inactive', updated_at: new Date().toISOString() },
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error('[Design Engineer] Codex logout failed:', error);
    res.status(500).json({ error: error.message || 'Codex logout failed.' });
  }
});

// -----------------------------------------------------------------------------
// REPOSITORIES & BRANCHES
// -----------------------------------------------------------------------------

async function githubFetch(conn, endpoint, options = {}) {
  return fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${conn.githubToken}`,
      'User-Agent': 'design-engineer-plugin',
      ...(options.headers || {}),
    },
  });
}

app.get('/api/repos', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const conn = await requireGithubConnection(auth, res);
  if (!conn) return;

  try {
    const r = await githubFetch(
      conn,
      '/user/repos?per_page=100&sort=updated',
      { headers: { Accept: 'application/json' } }
    );

    const data = await safeJson(await r.text());

    if (r.status === 401) {
      return res.status(401).json({
        error: 'GitHub authorization expired or was revoked. Reconnect GitHub in the plugin.',
        code: 'GITHUB_REAUTH_REQUIRED',
      });
    }

    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'Unexpected GitHub response', detail: data });
    }

    res.json({
      repos: data.map((repo) => ({
        fullName: repo.full_name,
        private: repo.private,
      })),
    });
  } catch (error) {
    console.error('[Design Engineer] Failed to load repositories:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repos/:owner/:repo/branches', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const conn = await requireGithubConnection(auth, res);
  if (!conn) return;

  try {
    const { owner, repo } = req.params;

    const r = await githubFetch(
      conn,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
      { headers: { Accept: 'application/json' } }
    );

    const data = await safeJson(await r.text());

    if (r.status === 401) {
      return res.status(401).json({
        error: 'GitHub authorization expired or was revoked. Reconnect GitHub in the plugin.',
        code: 'GITHUB_REAUTH_REQUIRED',
      });
    }

    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'Unexpected GitHub response', detail: data });
    }

    res.json({
      branches: data.map((branch) => ({ name: branch.name })),
    });
  } catch (error) {
    console.error('[Design Engineer] Failed to load branches:', error);
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// SAVE DESIGN CONTEXT (Figma -> Supabase)
// -----------------------------------------------------------------------------

function sanitizeFileName(value) {
  return String(value || 'screen')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 150) || 'screen';
}

app.post('/api/screens/fetch', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const conn = await requireGithubConnection(auth, res);
  if (!conn) return;

  const { projectId, repo, branch, screens } = req.body || {};

  if (!projectId || !repo || !branch || !Array.isArray(screens) || screens.length === 0) {
    return res
      .status(400)
      .json({ error: 'projectId, repo, branch and screens[] (non-empty) are required' });
  }

  try {
    const saved = [];

    for (let index = 0; index < screens.length; index++) {
      const screen = screens[index];
      if (!screen || typeof screen !== 'object') continue;

      const screenName =
        screen.screen || screen.name || `frame-${index + 1}`;

      const { screenshotBase64: _screenshotBase64, ...designContext } = screen;

      const payload = {
        contextVersion: '2.0',
        savedAt: new Date().toISOString(),
        githubUser: conn.github_username || conn.githubUser,
        repository: repo,
        branch,
        screen: designContext,
      };

      const safeName = sanitizeFileName(screenName);

      await pgQuery('design_contexts', {
        token: auth.token,
        method: 'POST',
        query: 'on_conflict=project_id,screen_name',
        body: {
          project_id: projectId,
          screen_name: safeName,
          content: payload,
          updated_at: new Date().toISOString(),
        },
        prefer: 'resolution=merge-duplicates,return=representation',
      });

      saved.push(`${safeName}.json`);
      console.log(`[Design Engineer] Saved design context for ${screenName}`);
    }

    // Remember the working repo + branch on the project itself.
    await pgQuery('projects', {
      token: auth.token,
      method: 'PATCH',
      query: `id=eq.${projectId}`,
      body: { repository: repo, base_branch: branch },
    }).catch(() => {});

    res.json({ success: true, saved, screenCount: saved.length });
  } catch (error) {
    console.error('[Design Engineer] Failed to save Design Context:', error);
    res.status(500).json({ error: error.message || 'Failed to save Design Context' });
  }
});

// -----------------------------------------------------------------------------
// IMPLEMENT SCREENS WITH CODEX + PR
// -----------------------------------------------------------------------------

function runProcess(command, args, options = {}) {
  const logPrefix = options.logPrefix;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (logPrefix) {
        text
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => console.log(`${logPrefix} ${line}`));
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (logPrefix) {
        text
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => console.log(`${logPrefix} ${line}`));
      }
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args[0] || ''} failed (${code}): ${stderr || stdout}`
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function githubRequest(conn, endpoint, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${conn.githubToken}`,
      'User-Agent': 'design-engineer-plugin',
      ...(options.headers || {}),
    },
  });

  const body = await safeJson(await response.text());

  if (!response.ok) {
    throw new Error(
      (body && body.message) || `GitHub request failed (${response.status})`
    );
  }

  return body;
}

function getRepositoryParts(repository) {
  const parts = String(repository).split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error('repo must use the owner/name format.');
  }
  return parts;
}

function buildImplementationPrompt(screens, contextDir, baseBranch, branchName) {
  const screenList = screens
    .map((screen) => `- ${screen.name}: ${path.join(contextDir, screen.fileName)}`)
    .join('\n');

  return `You are implementing multiple Figma screens in an existing React Native repository.

Screens and design context files:
${screenList}

Base branch: ${baseBranch}
Working branch: ${branchName}

Instructions:
1. Read README.md first, then inspect the complete repository tree, package.json files, and existing source before changing anything.
2. The base branch may contain only README.md. If the app structure is missing, create a standard React Native project structure in this repository using the stack and package manager described by README.md. Keep the structure clear and production-ready, with an app entry point, src/screens, src/components, src/navigation, and src/theme or src/styles where appropriate.
3. Preserve any existing React Native stack, package manager, naming conventions, and folder structure when those files already exist. Do not create a second app beside an existing app.
4. Implement every supplied screen in the same branch and make the screens reachable through the app's navigation. Use the design context JSON files as the source of truth for layout, typography, spacing, colors, assets, and interactions.
5. Inspect each extracted JSON for navigation relationships, destination names, tap targets, links, or screen transition metadata. Recreate those routes and transitions in the navigation setup, including the initial route and back behavior where the data indicates them.
6. Share components, styles, theme tokens, and navigation configuration when screens have common structure. Do not duplicate whole screen implementations unnecessarily.
7. Do not modify lockfiles or dependencies unless the implementation genuinely requires it. If navigation requires a dependency and the repository has no package setup, add the minimum documented dependency and its configuration.
8. Do not commit the temporary .design-engineer/context files; they will be removed by the orchestrator.
9. Add or update focused tests when the repository has a test setup.
10. Run the repository's relevant validation commands from README and package scripts before finishing.

Leave the working tree containing all screen implementations and working navigation, not just placeholder files.`;
}

async function appendTestInstructions(worktree, screenNames, branchName) {
  const readmePath = path.join(worktree, 'README.md');
  if (!fs.existsSync(readmePath)) return;

  const marker = `<!-- design-engineer:${branchName} -->`;
  const current = await fs.promises.readFile(readmePath, 'utf8');
  if (current.includes(marker)) return;

  const screenList = screenNames.map((screenName) => `- ${screenName}`).join('\n');
  const section = `\n\n${marker}\n## Test implemented screens\n\nThis implementation was generated from the Figma design context for these screens on branch \`${branchName}\`:\n\n${screenList}\n\n1. Clone this branch and install dependencies using the repository's documented package manager.\n2. Start the React Native app using the existing README command.\n3. Open every implemented screen through the navigation flow and verify the initial route, links, transitions, and back behavior.\n4. Verify each screen's layout, typography, spacing, interactions, and responsive behavior against Figma.\n5. Run the repository's documented test and lint commands before accepting the pull request.\n`;

  await fs.promises.writeFile(readmePath, `${current.trimEnd()}${section}`, 'utf8');
}

async function implementScreensInBranch(conn, repository, baseBranch, screens) {
  const screenNames = screens.map((screen) => screen.name);
  const firstScreenName = screenNames[0] || 'screens';
  const safeScreenName = sanitizeFileName(firstScreenName).toLowerCase();

  const branchName = `implement/${safeScreenName}-screens-${Date.now()}`;

  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'design-engineer-'));
  const worktree = path.join(tempRoot, 'repository');
  const contextDir = path.join(worktree, '.design-engineer', 'context');

  const encodedToken = encodeURIComponent(conn.githubToken);
  const cloneUrl = `https://x-access-token:${encodedToken}@github.com/${repository}.git`;

  try {
    await runProcess('git', ['clone', '--depth=1', '--branch', baseBranch, cloneUrl, worktree]);

    await runProcess('git', ['checkout', '-b', branchName], { cwd: worktree });

    console.log(`[Design Engineer] Created implementation branch ${branchName}`);

    await fs.promises.mkdir(contextDir, { recursive: true });

    const contextScreens = [];

    for (let index = 0; index < screens.length; index++) {
      const screen = screens[index];
      const screenFileName = `${sanitizeFileName(screen.name).toLowerCase()}-${index + 1}.json`;

      await fs.promises.writeFile(
        path.join(contextDir, screenFileName),
        JSON.stringify(screen.context, null, 2),
        'utf8'
      );

      contextScreens.push({ name: screen.name, fileName: screenFileName });
    }

    await runProcess(
      process.execPath,
      [
        CODEX_CLI_BIN,
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        '--cd',
        worktree,
        buildImplementationPrompt(contextScreens, contextDir, baseBranch, branchName),
      ],
      {
        cwd: worktree,
        logPrefix: '[Codex]',
        env: { ...process.env, CODEX_HOME, HOME: CODEX_HOME },
      }
    );

    console.log(`[Design Engineer] Codex finished for ${screenNames.join(', ')}`);

    await fs.promises.rm(path.join(worktree, '.design-engineer'), {
      recursive: true,
      force: true,
    });

    await appendTestInstructions(worktree, screenNames, branchName);

    await runProcess('git', ['config', 'user.name', 'Design Engineer'], { cwd: worktree });
    await runProcess('git', ['config', 'user.email', 'design-engineer[bot]@users.noreply.github.com'], { cwd: worktree });
    await runProcess('git', ['add', '-A'], { cwd: worktree });
    await runProcess('git', ['commit', '-m', `Implement ${screenNames.join(', ')}`], { cwd: worktree });
    await runProcess('git', ['push', 'origin', branchName], { cwd: worktree });

    const [owner, repo] = getRepositoryParts(repository);

    const pullRequest = await githubRequest(
      conn,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Implement ${screenNames.join(', ')}`,
          head: branchName,
          base: baseBranch,
          body: `## Design Engineer implementation\n\nScreens:\n${screenNames
            .map((screenName) => `- ${screenName}`)
            .join('\n')}\n\nCodex implemented all selected screens together from the saved Figma design contexts, including navigation. See the README test steps in this branch before merging.`,
        }),
      }
    );

    console.log(`[Design Engineer] Pull request created: ${pullRequest.html_url}`);

    return {
      screens: screenNames,
      branch: branchName,
      pullRequestUrl: pullRequest.html_url,
    };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

app.post('/api/screens/implement', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const conn = await requireGithubConnection(auth, res);
  if (!conn) return;

  const { projectId, screens } = req.body || {};

  if (!projectId || !Array.isArray(screens) || screens.length === 0) {
    return res
      .status(400)
      .json({ error: 'projectId, repository and screens[] are required' });
  }

  try {
    // Make sure the CLI is authenticated for THIS user before running Codex.
    const codexReady = await ensureCodexCredential(auth.user.id, auth.token);
    if (!codexReady) {
      return res.status(401).json({ error: 'Codex is not authenticated. Connect Codex in the plugin first.' });
    }

    const projectRows = await pgQuery('projects', {
      token: auth.token,
      query: `id=eq.${projectId}&select=*&limit=1`,
    });
    const project = Array.isArray(projectRows) ? projectRows[0] : null;

    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const repository = project.repository;
    const baseBranch = project.base_branch;

    if (!repository || !baseBranch) {
      return res
        .status(400)
        .json({ error: 'This project has no repository/branch selected yet. Fetch screens first.' });
    }

    const screenNames = screens
      .filter((screen) => screen && typeof screen === 'object')
      .map((screen, index) => screen.screen || screen.name || `screen-${index + 1}`)
      .map(sanitizeFileName);

    if (screenNames.length === 0) {
      return res.status(400).json({ error: 'No valid screens were supplied.' });
    }

    const contextRows = await pgQuery('design_contexts', {
      token: auth.token,
      query: `project_id=eq.${projectId}&select=screen_name,content`,
    });

    const byName = new Map(
      (Array.isArray(contextRows) ? contextRows : []).map((row) => [
        row.screen_name,
        row,
      ])
    );

    const selectedScreens = screenNames.map((name) => {
      const row = byName.get(name);
      if (!row?.content) {
        throw new Error(
          `Saved Design Context not found for "${name}". Fetch the screens again before starting implementation.`
        );
      }
      return { name, context: row.content };
    });

    console.log(
      `[Design Engineer] Starting one implementation branch for ${selectedScreens.length} screen(s).`
    );

    const implementation = await implementScreensInBranch(
      conn,
      repository,
      baseBranch,
      selectedScreens
    );

    res.json({ success: true, implementations: [implementation] });
  } catch (error) {
    console.error('[Design Engineer] Failed to implement screens:', error);
    res.status(500).json({ error: error.message || 'Failed to implement screens.' });
  }
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Design Engineer backend listening on ${BACKEND_URL}`);
  console.log(`[Design Engineer] Codex home: ${CODEX_HOME}`);
  console.log(`[Design Engineer] Codex CLI: ${CODEX_CLI_BIN}`);
  console.log(`[Design Engineer] Supabase: ${SUPABASE_URL || '(not configured)'}`);
  console.log('[Design Engineer] Session storage: Supabase (profiles / projects / connections)');
});