'use strict';
// Gets a generated app into a static folder the browser can load: reads the
// fidelity manifest, installs dependencies and runs the production web build
// as an unprivileged, isolated user, then serves the output read-only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const osIsolation = require('../../adapters/os-isolation');

const MANIFEST = 'design-engineer.fidelity.json';
const NETWORK_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'npm_config_registry', 'npm_config_cafile',
  'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_noproxy'];
const OUT_DIR = '.de-fidelity-dist';

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Reads and validates design-engineer.fidelity.json written by the coding agent. */
function readManifest(worktree) {
  const file = path.join(worktree, MANIFEST);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error(`${MANIFEST} is not a regular file under 256 KB`);
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${MANIFEST} is not valid JSON`); }
  const appRoot = typeof json.appRoot === 'string' && json.appRoot.trim() ? json.appRoot.trim() : '.';
  const resolved = path.resolve(worktree, appRoot);
  if (!inside(worktree, resolved)) throw new Error(`${MANIFEST}: appRoot must stay inside the repository`);
  const screens = (Array.isArray(json.screens) ? json.screens : []).slice(0, 50).map((s) => ({
    name: typeof s?.name === 'string' ? s.name.slice(0, 180) : '',
    rootId: typeof s?.rootId === 'string' ? s.rootId.slice(0, 80) : null,
    route: typeof s?.route === 'string' ? s.route.trim() : '',
  })).filter((s) => s.name && /^\/(?!\/)[^\s]{0,300}$/.test(s.route));
  return { appRoot: path.relative(worktree, resolved) || '.', screens };
}

function detectFramework(appDir) {
  const pkgFile = path.join(appDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return fs.existsSync(path.join(appDir, 'index.html')) ? { kind: 'static' } : { kind: 'unknown' };
  }
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); } catch { return { kind: 'unknown' }; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.expo) return { kind: 'expo', pkg };
  if (deps.vite) return { kind: 'vite', pkg };
  if (pkg.scripts && pkg.scripts.build) return { kind: 'script', pkg };
  return { kind: 'unknown', pkg };
}

function installCommand(appDir, worktree) {
  const has = (f) => fs.existsSync(path.join(appDir, f)) || fs.existsSync(path.join(worktree, f));
  if (has('pnpm-lock.yaml')) return ['corepack', ['pnpm', 'install', '--frozen-lockfile']];
  if (has('yarn.lock')) return ['corepack', ['yarn', 'install', '--frozen-lockfile']];
  if (has('package-lock.json')) return ['npm', ['ci', '--no-audit', '--no-fund']];
  return ['npm', ['install', '--no-audit', '--no-fund']];
}

function buildCommand(kind, appDir) {
  const bin = (name) => path.join(appDir, 'node_modules', '.bin', name);
  if (kind === 'vite') return [bin('vite'), ['build', '--outDir', OUT_DIR, '--emptyOutDir', '--base', '/']];
  if (kind === 'expo') return [bin('expo'), ['export', '--platform', 'web', '--output-dir', OUT_DIR]];
  if (kind === 'script') return ['npm', ['run', 'build']];
  return null;
}

/** Runs a command as the isolated user with no server secrets in its environment. */
function runIsolated(command, args, { cwd, home, identity, timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: home, CI: '1',
      BROWSER: 'none', EXPO_NO_TELEMETRY: '1', npm_config_cache: path.join(home, '.npm'),
      COREPACK_HOME: path.join(home, '.corepack'), XDG_CACHE_HOME: path.join(home, '.cache'),
    };
    // Network settings only (proxy, CA bundle, registry mirror) so installs
    // work behind a proxy. No server secrets are passed.
    for (const k of NETWORK_ENV) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(command, args, { cwd, env, ...identity, detached: process.platform === 'linux', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { kill(); reject(new Error(`${path.basename(command)} ${args[0] || ''} timed out`)); }, timeoutMs);
    function kill() { try { if (process.platform === 'linux' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* gone */ } }
    for (const s of [child.stdout, child.stderr]) s.on('data', (c) => { out = (out + c.toString()).slice(-8000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      kill();
      if (code === 0) return resolve(out);
      if (log) log(`[fidelity] ${path.basename(command)} ${args[0] || ''} failed:\n${out.slice(-1500)}`);
      reject(new Error(`${path.basename(command)} ${args.join(' ').slice(0, 60)} failed (exit ${code})`));
    });
  });
}

/**
 * Copies the worktree (minus .git) into a scratch folder, installs and builds
 * it there, and returns the static output folder. The real worktree is never
 * touched, so nothing from the check can end up in the pull request.
 */
async function prepareStaticApp({ worktree, scratch, manifest, log = () => {}, budgetMs = 6 * 60 * 1000 }) {
  const started = Date.now();
  const left = () => Math.max(5000, budgetMs - (Date.now() - started));
  const work = path.join(scratch, 'app');
  const home = path.join(scratch, 'home');
  await fs.promises.rm(scratch, { recursive: true, force: true });
  await fs.promises.mkdir(home, { recursive: true, mode: 0o700 });
  await fs.promises.cp(worktree, work, {
    recursive: true, verbatimSymlinks: true,
    filter: (src) => path.basename(src) !== '.git' && path.basename(src) !== OUT_DIR,
  });
  const appDir = path.resolve(work, manifest?.appRoot || '.');
  if (!inside(work, appDir) || !fs.existsSync(appDir)) throw new Error('App folder not found');
  const fw = detectFramework(appDir);
  if (fw.kind === 'static') return { root: appDir, framework: 'static', ms: Date.now() - started };
  if (fw.kind === 'unknown') throw new Error('No web build found: expected a Vite or Expo app, or a "build" script');
  const identity = await osIsolation.prepare({ workspace: work, home });
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    const [cmd, args] = installCommand(appDir, work);
    log(`[fidelity] Installing dependencies (${cmd} ${args[0]})`);
    try {
      await runIsolated(cmd, args, { cwd: appDir, home, identity, timeoutMs: Math.min(left(), 4 * 60 * 1000), log });
    } catch (error) {
      if (cmd !== 'npm' || args[0] !== 'ci') throw error;
      await runIsolated('npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir, home, identity, timeoutMs: Math.min(left(), 4 * 60 * 1000), log });
    }
  }
  const [bcmd, bargs] = buildCommand(fw.kind, appDir);
  log(`[fidelity] Building the ${fw.kind} app for the web`);
  await runIsolated(bcmd, bargs, { cwd: appDir, home, identity, timeoutMs: Math.min(left(), 4 * 60 * 1000), log });
  let root = path.join(appDir, OUT_DIR);
  if (fw.kind === 'script') {
    root = ['dist', 'build', 'web-build', 'out'].map((d) => path.join(appDir, d)).find((d) => fs.existsSync(path.join(d, 'index.html')));
  }
  if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw new Error('The web build produced no index.html');
  return { root, framework: fw.kind, ms: Date.now() - started };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.map': 'application/json', '.txt': 'text/plain' };

/** Read-only static server on 127.0.0.1 with SPA fallback. Never follows links out of root. */
async function serveStatic(root) {
  const realRoot = await fs.promises.realpath(root);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      const url = new URL(req.url, 'http://local');
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes('\0')) { res.writeHead(400); return res.end(); }
      let file = path.resolve(realRoot, '.' + rel);
      let stat = null;
      try { file = await fs.promises.realpath(file); stat = await fs.promises.stat(file); } catch { stat = null; }
      if (stat && stat.isDirectory()) {
        const idx = path.join(file, 'index.html');
        try { file = await fs.promises.realpath(idx); stat = await fs.promises.stat(file); } catch { stat = null; }
      }
      if (!stat || !stat.isFile() || !inside(realRoot, file)) {
        // Client-side routes: /login, /home ... serve the app shell. Expo
        // exports one HTML per route as /login.html, so try that first.
        const asHtml = path.resolve(realRoot, '.' + rel.replace(/\/$/, '') + '.html');
        try {
          const real = await fs.promises.realpath(asHtml);
          if (inside(realRoot, real) && (await fs.promises.stat(real)).isFile()) file = real;
          else throw new Error('outside');
        } catch {
          if (path.extname(rel)) { res.writeHead(404); return res.end(); }
          file = path.join(realRoot, 'index.html');
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500); res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

module.exports = { MANIFEST, OUT_DIR, readManifest, detectFramework, prepareStaticApp, serveStatic, inside };
