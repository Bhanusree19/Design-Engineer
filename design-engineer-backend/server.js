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
const Razorpay = require('razorpay');

const app = express();

app.use(cors());

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendAuthComplete(res, provider, identity) {
  const escapedProvider = escapeHtml(provider);
  const escapedIdentity = escapeHtml(identity);

  return res.type('html').send(`
    <!doctype html>
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;padding:40px">
        <h2>${escapedProvider} connected</h2>
        <p>Signed in as <strong>${escapedIdentity}</strong>.</p>
        <p id="return-message">Returning to Design Engineer…</p>
        <script>
          window.setTimeout(() => {
            window.close();
            window.setTimeout(() => {
              document.getElementById('return-message').textContent =
                'You can close this tab. Design Engineer will continue automatically.';
            }, 300);
          }, 300);
        </script>
      </body>
    </html>
  `);
}

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

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// 32-byte key for AES-256-GCM. Set ENCRYPTION_KEY consistently for all
// backends sharing Supabase; the fallback only works while these inputs match.
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
// PLANS & USAGE HELPERS
// -----------------------------------------------------------------------------

async function getPlans(token) {
  const rows = await pgQuery('plans', {
    token,
    query: 'order=sort_order.asc&select=*&is_active=eq.true',
  });
  return Array.isArray(rows) ? rows : [];
}

async function getUserSubscription(userId, token) {
  const rows = await pgQuery('user_subscriptions', {
    token,
    query: `user_id=eq.${userId}&select=*&limit=1`,
  });
  if (Array.isArray(rows) && rows[0]) return rows[0];

  // Ensure free subscription exists
  const plans = await pgQuery('plans', {
    token,
    query: "slug=eq.free&select=*&limit=1",
  });
  const freePlan = Array.isArray(plans) ? plans[0] : null;
  try {
    const created = await pgQuery('user_subscriptions', {
      token,
      method: 'POST',
      query: 'on_conflict=user_id',
      body: {
        user_id: userId,
        plan_id: freePlan?.id || null,
        plan_slug: 'free',
        status: 'active',
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return Array.isArray(created) ? created[0] : null;
  } catch (e) {
    return null;
  }
}

async function getUserPlan(userId, token) {
  const sub = await getUserSubscription(userId, token);
  const planSlug = sub?.plan_slug || 'free';
  const planRows = await pgQuery('plans', {
    token,
    query: `slug=eq.${planSlug}&select=*&limit=1`,
  });
  if (Array.isArray(planRows) && planRows[0]) return planRows[0];
  const allPlans = await getPlans(token);
  return allPlans.find((p) => p.slug === planSlug) || allPlans[0] || null;
}

async function getUserUsage(userId, token) {
  const [projects, contexts] = await Promise.all([
    pgQuery('projects', {
      token,
      query: `user_id=eq.${userId}&select=id`,
    }),
    pgQuery('design_contexts', {
      token,
      query: `user_id=eq.${userId}&select=id,project_id`,
    }),
  ]);
  const projectCount = Array.isArray(projects) ? projects.length : 0;
  const screenCountTotal = Array.isArray(contexts) ? contexts.length : 0;
  const screensByProject = {};
  if (Array.isArray(contexts)) {
    for (const ctx of contexts) {
      if (!ctx.project_id) continue;
      screensByProject[ctx.project_id] = (screensByProject[ctx.project_id] || 0) + 1;
    }
  }
  return { projectCount, screenCountTotal, screensByProject };
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
// LOGOUT (revoke the Supabase session server-side)
// -----------------------------------------------------------------------------

app.post('/auth/logout', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  try {
    // Revoke the user's Supabase session so the access + refresh tokens can no
    // longer be used to reach their account. This lets the user sign in with a
    // different Google / email account afterwards.
    const logoutRes = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!logoutRes.ok) {
      const text = await logoutRes.text().catch(() => '');
      console.warn(
        `[Design Engineer] Supabase logout responded ${logoutRes.status}: ${text}`
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Design Engineer] Logout failed:', error);
    // Still report success so the plugin always clears its local session state —
    // that is the important part of logging out from the user's perspective.
    res.json({ success: true });
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

  try {
    return {
      ...row,
      githubToken: decryptText(row.access_token_encrypted),
      tokenDecryptFailed: false,
    };
  } catch {
    console.error(
      '[Design Engineer] Could not decrypt the saved GitHub token. Check that ENCRYPTION_KEY matches the key used when this token was stored; otherwise reconnect GitHub.'
    );
    return {
      ...row,
      githubToken: null,
      tokenDecryptFailed: true,
    };
  }
}

async function requireGithubConnection(auth, res) {
  const conn = await getGithubConnectionWithToken(auth.user.id, auth.token);
  if (!conn || !conn.githubToken) {
    res.status(401).json({
      error:
        conn?.tokenDecryptFailed
          ? 'The saved GitHub token cannot be decrypted. Reconnect GitHub in the plugin. If you need to preserve the old token, restore the original ENCRYPTION_KEY first.'
          : 'GitHub is not connected. Connect GitHub in the plugin first.',
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
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&prompt=select_account`;

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
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&prompt=select_account`;

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

    sendAuthComplete(res, 'GitHub', userData.login);
  } catch (e) {
    console.error('[Design Engineer] GitHub authentication failed:', e);
    res.status(500).send(`GitHub auth failed: ${e.message}`);
  }
});

app.get('/api/github/status', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const connection = await getGithubConnectionWithToken(auth.user.id, auth.token);

  res.json({
    connected: !!connection?.githubToken,
    githubUser: connection?.githubToken ? connection.github_username : null,
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
// GOOGLE OAUTH (create account / sign in with Google)
//
// Pattern mirrors the GitHub flow so it works inside the sandboxed Figma
// plugin: the plugin asks the backend for a URL, opens it in a browser tab,
// then polls /auth/google/status until the callback stores the session.
//
// The Supabase Google provider must be enabled in the project (Dashboard ->
// Authentication -> Providers -> Google). The final session (access token +
// refresh token + user) is returned to the plugin and saved to Figma client
// storage like the email/password session, while the account itself lives in
// Supabase auth.users.
// -----------------------------------------------------------------------------

const googleOauthStates = new Map();
const GOOGLE_OAUTH_TTL_MS = 10 * 60 * 1000;

function pruneGoogleOauthStates() {
  const now = Date.now();
  for (const [state, claim] of googleOauthStates) {
    if (claim.expiresAt < now) googleOauthStates.delete(state);
  }
}

// Each OAuth attempt gets its own supabase client (with its own in-memory PKCE
// code verifier) so concurrent sign-ins never overwrite each other's state.
function createGoogleOAuthClient() {
  return createClient(
    SUPABASE_URL || 'http://localhost',
    SUPABASE_ANON_KEY || 'x',
    {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

app.post('/auth/google/connect', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not configured on the backend.',
    });
  }

  pruneGoogleOauthStates();

  const state = crypto.randomBytes(24).toString('hex');
  // The state goes in the PATH, not the query. GoTrue (Supabase Auth) appends
  // its own query params (code, state, error) to redirect_to when it finishes,
  // and if redirect_to already contains a query string the appended "code" can
  // end up swallowed (nested inside an existing value, or after a second "?"),
  // which the callback then can't see. A path-only redirect_to is immune to
  // that clobbering, and Express reads it via req.params.state.
  const redirectTo = `${BACKEND_URL}/auth/google/callback/${encodeURIComponent(state)}`;

  try {
    const client = createGoogleOAuthClient();

    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });

    if (error || !data?.url) {
      return res.status(400).json({
        error:
          (error && error.message) ||
          'Google sign in could not be started. Make sure the Google provider is enabled in your Supabase project (Authentication → Providers → Google).',
      });
    }

    googleOauthStates.set(state, {
      client,
      status: 'pending',
      session: null,
      error: null,
      expiresAt: Date.now() + GOOGLE_OAUTH_TTL_MS,
    });

    res.json({ url: data.url, state });
  } catch (e) {
    console.error('[Design Engineer] Google OAuth start failed:', e);
    res.status(500).json({ error: e.message || 'Google sign in could not be started.' });
  }
});

// Shared handler for the Google OAuth callback. Registered on both the
// path-param route (current flows: /auth/google/callback/:state) and the old
// query-param route (legacy in-flight flows: ?de_state=...).
async function handleGoogleCallback(code, state, res) {
  console.log(
    `[Design Engineer] Google callback for state ${state ? String(state).slice(0, 8) : '(none)'}`
  );

  const claim = state && googleOauthStates.get(String(state));
  if (!claim || claim.expiresAt < Date.now()) {
    return res
      .status(400)
      .send('Google sign-in expired. Close this tab and click Continue with Google again in the plugin.');
  }

  if (!code) {
    claim.status = 'error';
    claim.error = 'Google did not return an authorization code. Please try again.';
    return res
      .status(400)
      .send('Google sign-in returned no authorization code. Please try again.');
  }

  try {
    const { data, error } = await claim.client.auth.exchangeCodeForSession(
      String(code)
    );

    if (error || !data?.session) {
      const message = (error && error.message) || 'Google sign-in failed.';
      claim.status = 'error';
      claim.error = message;
      console.error('[Design Engineer] Google auth exchange failed:', message);
      return res.status(400).send(`Google sign-in failed: ${message}`);
    }

    const session = data.session;

    // The trigger usually creates the profile, but make sure it exists so the
    // dashboard works immediately after a brand-new Google signup.
    await upsertProfile(session.user, session.access_token).catch((e) =>
      console.error('[Design Engineer] Profile upsert warned:', e.message)
    );

    claim.status = 'done';
    claim.session = {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: session.user.id,
        email: session.user.email,
        created_at: session.user.created_at,
      },
    };

    console.log(`[Design Engineer] Google sign-in complete for ${session.user.email}`);

    sendAuthComplete(res, 'Google sign-in', session.user.email);
  } catch (e) {
    console.error('[Design Engineer] Google auth callback failed:', e);
    claim.status = 'error';
    claim.error = e.message || 'Google sign-in failed.';
    res.status(500).send(`Google sign-in failed: ${e.message}`);
  }
}

// Current flow: the state arrives as a path segment. GoTrue appends its own
// query params (?code=..., ?error=..., ?state=...) to redirect_to, so they land
// in req.query cleanly next to our path-based state.
app.get('/auth/google/callback/:state', async (req, res) => {
  const code =
    typeof req.query.code === 'string'
      ? req.query.code
      : Array.isArray(req.query.code)
        ? req.query.code[0]
        : null;

  if (req.query.error) {
    const oauthError = String(req.query.error);
    const oauthDescription = String(req.query.error_description || '');
    const claim = req.params.state && googleOauthStates.get(req.params.state);
    console.warn(
      `[Design Engineer] Google OAuth reported an error: ${oauthError}${oauthDescription ? ` — ${oauthDescription}` : ''}`,
      { url: req.originalUrl }
    );
    if (claim) {
      claim.status = 'error';
      claim.error = `Google refused the sign in (${oauthError}${oauthDescription ? `: ${oauthDescription}` : ''}). Please try again.`;
    }
    return res
      .status(400)
      .send(
        `Google sign-in was not completed (${oauthError}${oauthDescription ? `: ${oauthDescription}` : ''}). Please close this tab and try again.`
      );
  }

  await handleGoogleCallback(code, req.params.state, res);
});

// Legacy fallback: flows started before the path-based state fix.
app.get('/auth/google/callback', async (req, res) => {
  const state = String(req.query.de_state || req.query.state || '').trim();
  const code =
    typeof req.query.code === 'string'
      ? req.query.code
      : Array.isArray(req.query.code)
        ? req.query.code[0]
        : null;

  if (req.query.error) {
    const oauthError = String(req.query.error);
    const oauthDescription = String(req.query.error_description || '');
    const claim = state && googleOauthStates.get(state);
    console.warn(
      `[Design Engineer] Google OAuth reported an error: ${oauthError}${oauthDescription ? ` — ${oauthDescription}` : ''}`,
      { url: req.originalUrl }
    );
    if (claim) {
      claim.status = 'error';
      claim.error = `Google refused the sign in (${oauthError}${oauthDescription ? `: ${oauthDescription}` : ''}). Please try again.`;
    }
    return res
      .status(400)
      .send(
        `Google sign-in was not completed (${oauthError}${oauthDescription ? `: ${oauthDescription}` : ''}). Please close this tab and try again.`
      );
  }

  await handleGoogleCallback(code, state, res);
});

app.get('/auth/google/status', (req, res) => {
  const state = String(req.query.state || '').trim();

  const claim = state && googleOauthStates.get(state);

  if (!claim || claim.expiresAt < Date.now()) {
    return res.json({ status: 'expired' });
  }

  if (claim.status === 'error') {
    return res.json({ status: 'error', error: claim.error });
  }

  if (claim.status === 'done' && claim.session) {
    return res.json({ status: 'done', session: claim.session });
  }

  res.json({ status: 'pending' });
});


// -----------------------------------------------------------------------------
// PLANS, USAGE & BILLING
// -----------------------------------------------------------------------------

app.get('/api/plans', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    const plans = await getPlans(auth.token);
    res.json({ plans });
  } catch (error) {
    console.error('[Design Engineer] Failed to load plans:', error);
    res.status(500).json({ error: error.message || 'Failed to load plans.' });
  }
});

app.get('/api/billing/usage', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    const [plan, subscription, usage] = await Promise.all([
      getUserPlan(auth.user.id, auth.token),
      getUserSubscription(auth.user.id, auth.token),
      getUserUsage(auth.user.id, auth.token),
    ]);
    res.json({
      plan,
      subscription,
      usage,
    });
  } catch (error) {
    console.error('[Design Engineer] Failed to load usage:', error);
    res.status(500).json({ error: error.message || 'Failed to load usage.' });
  }
});

app.post('/api/billing/create-order', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const { planSlug } = req.body || {};
  if (!planSlug) {
    return res.status(400).json({ error: 'planSlug is required' });
  }

  try {
    const planRows = await pgQuery('plans', {
      token: auth.token,
      query: `slug=eq.${planSlug}&select=*&limit=1`,
    });
    const plan = Array.isArray(planRows) ? planRows[0] : null;
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    if (!plan.price_inr || plan.price_inr <= 0) {
      return res.status(400).json({ error: 'This plan is free or not purchasable' });
    }
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ error: 'Razorpay keys not configured on the backend.' });
    }

    const razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    });

    const receipt = `plan_${plan.slug}_${Date.now()}`;
    const order = await razorpay.orders.create({
      amount: plan.price_inr * 100,
      currency: plan.currency || 'INR',
      receipt,
      notes: {
        user_id: auth.user.id,
        plan_slug: plan.slug,
      },
    });

    await pgQuery('payments', {
      token: auth.token,
      method: 'POST',
      query: 'select=*',
      body: {
        user_id: auth.user.id,
        plan_id: plan.id,
        plan_slug: plan.slug,
        amount: plan.price_inr,
        currency: plan.currency || 'INR',
        razorpay_order_id: order.id,
        status: 'created',
        receipt,
      },
      prefer: 'return=representation',
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID,
      plan: { name: plan.name, slug: plan.slug },
    });
  } catch (error) {
    console.error('[Design Engineer] Failed to create Razorpay order:', error);
    res.status(500).json({ error: error.message || 'Failed to create order.' });
  }
});

app.post('/api/billing/verify', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planSlug } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }

  try {
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');

    if (expectedSign !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Find payment
    const paymentRows = await pgQuery('payments', {
      token: auth.token,
      query: `razorpay_order_id=eq.${razorpay_order_id}&select=*&limit=1`,
    });
    const payment = Array.isArray(paymentRows) ? paymentRows[0] : null;

    if (payment) {
      await pgQuery('payments', {
        token: auth.token,
        method: 'PATCH',
        query: `id=eq.${payment.id}`,
        body: {
          razorpay_payment_id,
          razorpay_signature,
          status: 'paid',
          updated_at: new Date().toISOString(),
        },
      });
    }

    const targetSlug = planSlug || payment?.plan_slug || 'free';
    const planRows = await pgQuery('plans', {
      token: auth.token,
      query: `slug=eq.${targetSlug}&select=*&limit=1`,
    });
    const plan = Array.isArray(planRows) ? planRows[0] : null;

    await pgQuery('user_subscriptions', {
      token: auth.token,
      method: 'POST',
      query: 'on_conflict=user_id',
      body: {
        user_id: auth.user.id,
        plan_id: plan?.id || null,
        plan_slug: targetSlug,
        status: 'active',
        started_at: new Date().toISOString(),
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    });

    res.json({ success: true, plan: plan || { slug: targetSlug } });
  } catch (error) {
    console.error('[Design Engineer] Failed to verify payment:', error);
    res.status(500).json({ error: error.message || 'Payment verification failed.' });
  }
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

  const allowed = ['name', 'description', 'status', 'repository', 'base_branch', 'stack'];
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
      getGithubConnectionWithToken(auth.user.id, auth.token),
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
        connected: !!github?.githubToken,
        githubUser: github?.githubToken ? github.github_username : null,
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
        !/(not logged in|not authenticated|unauthenticated)/i.test(combined) &&
        (/logged in/i.test(combined) ||
          /authenticated/i.test(combined) ||
          /signed in/i.test(combined) ||
          !!readCodexAuthFile());

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
      auth_type: 'codex-cli-browser-auth',
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

function startCodexBrowserAuth(deviceCode, userId, accessToken) {
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
      [CODEX_CLI_BIN, 'login'],
      {
        cwd: __dirname,
        env: { ...process.env, CODEX_HOME, HOME: CODEX_HOME },
        stdio: 'ignore',
      }
    );

    entry.process = child;

    child.on('error', (error) => {
      entry.status = 'expired';
      reject(error);
    });

    child.on('exit', async (code) => {
      if (entry.status === 'approved') return;

      try {
        if (code === 0 && (await getCodexLoginStatus()) === 'connected') {
          entry.status = 'approved';
          entry.codexUser = 'Codex CLI user';
          await persistCodexCredentials(userId, accessToken);
          return;
        }
      } catch (error) {
        console.error('[Design Engineer] Failed to verify Codex browser sign-in:', error);
      }

      if (code !== 0) {
        entry.status = 'expired';
        entry.error = 'Codex browser sign-in did not complete. Please try again.';
      } else {
        entry.processExited = true;
      }
    });

    // The CLI opens the browser for its normal OAuth flow; no one-time code
    // is needed. Resolve once the child process is successfully started.
    child.once('spawn', resolve);
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
      error: null,
      expiresAt: Date.now() + 15 * 60 * 1000,
    };

    deviceSessions.set(deviceCode, entry);

    // Browser OAuth requires this backend process to run in the user's
    // desktop session so Codex can open the browser and receive its callback.
    await startCodexBrowserAuth(deviceCode, auth.user.id, auth.token);

    res.json({
      device_code: deviceCode,
      expires_in: 900,
      interval: 3,
      browserAuth: true,
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

  if (entry.expiresAt < Date.now() && entry.status === 'pending') {
    entry.status = 'expired';
    entry.error = 'Codex browser sign-in expired. Please try again.';
  }

  if (entry.status === 'pending') {
    const loginStatus = await getCodexLoginStatus();
    if (loginStatus === 'connected') {
      try {
        await persistCodexCredentials(entry.userId, entry.accessToken);
        entry.status = 'approved';
        entry.codexUser = 'Codex CLI user';
      } catch (error) {
        console.error('[Design Engineer] Failed to persist Codex credentials:', error);
        entry.status = 'expired';
        entry.error = 'Codex signed in, but its credentials could not be saved. Please try again.';
      }
    }
  }

  res.json({
    status: entry.status,
    codexUser: entry.codexUser,
    error: entry.error,
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

    // Clear the stored credential so the next sign-in can authenticate a
    // different account instead of silently restoring the old one.
    await pgQuery('codex_accounts', {
      token: auth.token,
      method: 'PATCH',
      query: `user_id=eq.${auth.user.id}`,
      body: {
        status: 'inactive',
        credential_reference: null,
        updated_at: new Date().toISOString(),
      },
    });

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
          user_id: auth.user.id,
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

function stackLabel(stack) {
  return stack === 'react-js' ? 'React JS' : 'React Native';
}

function buildImplementationPrompt(
  screens,
  contextDir,
  baseBranch,
  branchName,
  stack
) {
  const screenList = screens
    .map((screen) => `- ${screen.name}: ${path.join(contextDir, screen.fileName)}`)
    .join('\n');

  const projectLabel = stackLabel(stack);
  const isReactNative = stack !== 'react-js';

  const structureHint = isReactNative
    ? 'with an app entry point, src/screens, src/components, src/navigation, and src/theme or src/styles where appropriate'
    : 'with a Vite entry point (index.html + src/main.jsx/tsx), src/pages, src/components, src/routes, and src/theme or src/styles where appropriate';

  const validationHint = isReactNative
    ? '- Start the React Native app using the package manager and command documented in README.md (for example: npm start, npm run android, or npx expo start).'
    : '- Start the React JS (Vite) app using the package manager and command documented in README.md (for example: npm run dev).';

  return `You are implementing multiple Figma screens in an existing ${projectLabel} repository.

Screens and design context files:
${screenList}

Base branch: ${baseBranch}
Working branch: ${branchName}
Requested stack: ${projectLabel}

Instructions:
1. Read README.md first, then inspect the complete repository tree, package.json files, and existing source before changing anything.
2. The base branch may contain only README.md. If the app structure is missing, create a standard ${projectLabel} project structure in this repository using the stack and package manager described by README.md. Keep the structure clear and production-ready, ${structureHint}.
3. Preserve any existing ${projectLabel} stack, package manager, naming conventions, and folder structure when those files already exist. Do not create a second app beside an existing app.
4. Implement every supplied screen in the same branch and make the screens reachable through the app's navigation. Use the design context JSON files as the source of truth for layout, typography, spacing, colors, assets, and interactions.
5. Inspect each extracted JSON for navigation relationships, destination names, tap targets, links, or screen transition metadata. Recreate those routes and transitions in the navigation setup, including the initial route and back behavior where the data indicates them.
6. Share components, styles, theme tokens, and navigation configuration when screens have common structure. Do not duplicate whole screen implementations unnecessarily.
7. Do not modify lockfiles or dependencies unless the implementation genuinely requires it. If navigation requires a dependency and the repository has no package setup, add the minimum documented dependency and its configuration.
8. Do not commit the temporary .design-engineer/context files; they will be removed by the orchestrator.
9. Add or update focused tests when the repository has a test setup.
10. Run the repository's relevant validation commands from README and package scripts before finishing.

Testing (${projectLabel}):
${validationHint}

Leave the working tree containing all screen implementations and working navigation, not just placeholder files.`;
}

async function appendTestInstructions(
  worktree,
  screenNames,
  branchName,
  stack
) {
  const readmePath = path.join(worktree, 'README.md');
  if (!fs.existsSync(readmePath)) return;

  const marker = `<!-- design-engineer:${branchName} -->`;
  const current = await fs.promises.readFile(readmePath, 'utf8');
  if (current.includes(marker)) return;

  const screenList = screenNames.map((screenName) => `- ${screenName}`).join('\n');
  const appLabel = stack === 'react-js' ? 'React JS (web) app' : 'React Native app';
  const section = `\n\n${marker}\n## Test implemented screens\n\nThis implementation was generated from the Figma design context for these screens on branch \`${branchName}\`:\n\n${screenList}\n\n1. Clone this branch and install dependencies using the repository's documented package manager.\n2. Start the ${appLabel} using the existing README command.\n3. Open every implemented screen through the navigation flow and verify the initial route, links, transitions, and back behavior.\n4. Verify each screen's layout, typography, spacing, interactions, and responsive behavior against Figma.\n5. Run the repository's documented test and lint commands before accepting the pull request.\n`;

  await fs.promises.writeFile(readmePath, `${current.trimEnd()}${section}`, 'utf8');
}

async function implementScreensInBranch(conn, repository, baseBranch, screens, stack) {
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
        buildImplementationPrompt(contextScreens, contextDir, baseBranch, branchName, stack),
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

    await appendTestInstructions(worktree, screenNames, branchName, stack);

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

// -----------------------------------------------------------------------------
// IMPLEMENTATION PLAN (preview only — never writes code or raises a PR)
// -----------------------------------------------------------------------------

function describeDesignContext(row) {
  const content = row && row.content;
  const ctx =
    content && content.screen && typeof content.screen === 'object'
      ? content.screen
      : content;

  if (!ctx || typeof ctx !== 'object') return null;

  const summary = ctx.summary || {};
  const page = ctx.page && ctx.page.name ? ctx.page.name : null;
  const size =
    typeof ctx.width === 'number' && typeof ctx.height === 'number'
      ? `${Math.round(ctx.width)}×${Math.round(ctx.height)}`
      : null;

  const parts = [];
  if (typeof summary.textNodeCount === 'number')
    parts.push(`${summary.textNodeCount} text`);
  if (typeof summary.imageNodeCount === 'number')
    parts.push(`${summary.imageNodeCount} image${summary.imageNodeCount === 1 ? '' : 's'}`);
  if (typeof summary.componentCount === 'number')
    parts.push(`${summary.componentCount} component${summary.componentCount === 1 ? '' : 's'}`);

  return {
    name: ctx.screen || row.screen_name,
    size,
    page,
    detail: parts.join(', '),
    nodes:
      typeof summary.nodeCount === 'number'
        ? summary.nodeCount
        : Array.isArray(ctx.elements)
          ? ctx.elements.length
          : 0,
  };
}

function buildImplementationPlan(selectedScreens, repository, baseBranch, stack) {
  const firstScreen = selectedScreens[0]?.name || 'screens';
  const proposedBranch = `implement/${sanitizeFileName(firstScreen).toLowerCase()}-screens-${Date.now()}`;
  const projectLabel = stackLabel(stack);
  const isReactNative = stack !== 'react-js';

  const orderHint = isReactNative
    ? 'an app entry point, src/screens, src/components, src/navigation, and src/theme or src/styles'
    : 'a Vite entry point (index.html + src/main.jsx/tsx), src/pages, src/components, src/routes, and src/theme or src/styles';

  const startHint = isReactNative
    ? 'the React Native app using the documented package manager command (for example: npm start, npm run android, or npx expo start)'
    : 'the React JS (Vite) app using the documented package manager command (for example: npm run dev)';

  const screenLines = selectedScreens
    .map((screen) => {
      const info = describeDesignContext({ content: screen.context });
      const bits = [];
      if (info) {
        if (info.size) bits.push(info.size);
        if (info.page) bits.push(`page "${info.page}"`);
        if (info.nodes) bits.push(`${info.nodes} nodes`);
        if (info.detail) bits.push(info.detail);
      }
      return `- ${screen.name}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
    })
    .join('\n');

  const prompt = buildImplementationPrompt(
    selectedScreens.map((screen, index) => ({
      name: screen.name,
      fileName: `${sanitizeFileName(screen.name).toLowerCase()}-${index + 1}.json`,
    })),
    '.design-engineer/context',
    baseBranch,
    proposedBranch,
    stack
  );

  const plan = `# Implementation plan

**Repository:** \`${repository}\`
**Base branch:** \`${baseBranch}\`
**Stack:** ${projectLabel}
**Screens (${selectedScreens.length}):**

${screenLines}

## How Codex will write the code

1. **Clone** \`${repository}\` at branch \`${baseBranch}\` and create a working branch \`${proposedBranch}\`.
2. **Read README.md, package.json, and the existing source** to learn the stack, package manager, and conventions.
3. **Scaffold only if missing** — build ${orderHint} using the documented package manager. If an app already exists, extend it; never create a second app beside it.
4. **Implement every screen above** from its saved Design Context JSON — layout, typography, colors, spacing, images, and interactions.
5. **Wire navigation** — recreate routes, links, transitions, and back behavior between the screens from the extracted JSON.
6. **Share components, styles, and theme tokens** where screens have common structure; do not duplicate whole screen implementations.
7. **Keep lockfiles and dependencies stable** unless a navigation/feature genuinely requires an addition.
8. **Add or update tests** when the repository has a test setup, then run the documented validation commands (including starting ${startHint}).
9. **Commit, push, and open a pull request** describing the implemented screens and the README test steps.

Generating this plan writes no code and raises no pull request.
Only when you click "Start implement" will Codex build the screens and open the PR.

## Codex prompt (exact text that will be sent)

${prompt}`;

  return { plan, proposedBranch, prompt };
}

app.post('/api/screens/plan', async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;

  const { projectId, screens } = req.body || {};

  if (!projectId || !Array.isArray(screens) || screens.length === 0) {
    return res
      .status(400)
      .json({ error: 'projectId and screens[] (non-empty) are required' });
  }

  try {
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
    const stack = project.stack === 'react-js' ? 'react-js' : 'react-native';

    if (!repository || !baseBranch) {
      return res.status(400).json({
        error: 'This project has no repository/branch selected yet. Fetch screens first.',
      });
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
          `Saved Design Context not found for "${name}". Fetch the screens again before generating a plan.`
        );
      }
      return { name, context: row.content };
    });

    const summary = selectedScreens.map((screen) => {
      const info = describeDesignContext({ content: screen.context });
      return {
        name: screen.name,
        size: info?.size || null,
        page: info?.page || null,
        nodeCount: info?.nodes || 0,
        details: info?.detail || '',
      };
    });

    const { plan, proposedBranch, prompt } = buildImplementationPlan(
      selectedScreens,
      repository,
      baseBranch,
      stack
    );

    console.log(
      `[Design Engineer] Generated implementation plan for ${selectedScreens.length} screen(s) on ${repository}`
    );

    res.json({
      success: true,
      plan,
      prompt,
      proposedBranch,
      stack,
      repository,
      baseBranch,
      screens: summary,
    });
  } catch (error) {
    console.error('[Design Engineer] Failed to generate plan:', error);
    res.status(500).json({ error: error.message || 'Failed to generate the plan.' });
  }
});

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
    const stack = project.stack === 'react-js' ? 'react-js' : 'react-native';

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
      selectedScreens,
      stack
    );

    res.json({ success: true, implementations: [implementation] });
  } catch (error) {
    console.error('[Design Engineer] Failed to implement screens:', error);
    res.status(500).json({ error: error.message || 'Failed to implement screens.' });
  }
});

// -----------------------------------------------------------------------------
// HEALTH CHECK (used by Render's health check / to wake the instance)
// -----------------------------------------------------------------------------

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'design-engineer-backend' });
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