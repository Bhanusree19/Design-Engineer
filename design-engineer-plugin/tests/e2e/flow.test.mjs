// End-to-end flows for the v3 plugin UI, run in a real Chromium against the
// built ui.html with a fake Figma bridge and a fake backend (fake-backend.js).
// Every main flow runs twice: against the backend from this branch ('new') and
// against today's backend ('legacy'), where the newer routes don't exist.
//
//   npm run build:preview && npm run test:e2e
//
// Needs the `playwright` package and a Chromium for it (npx playwright install chromium,
// or E2E_CHROMIUM_PATH=/path/to/chrome).
// Set E2E_SCREENSHOTS=1 to save a screenshot of each checked screen.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', '..', process.env.E2E_DIST || 'preview/dist');
const fakeScript = fs.readFileSync(path.join(here, 'fake-backend.js'), 'utf8');
const shotsDir = path.join(here, 'artifacts');

let browser;
let httpServer;
let base;

before(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'ui.html')), `Build first: ${dist}/ui.html is missing (npm run build:preview)`);
  const html = fs.readFileSync(path.join(dist, 'ui.html'));
  httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${httpServer.address().port}/ui.html`;
  browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {});
  if (process.env.E2E_SCREENSHOTS) fs.mkdirSync(shotsDir, { recursive: true });
});

after(async () => {
  await browser?.close();
  httpServer?.close();
});

const SESSION = { accessToken: 'tok-1', refreshToken: 'ref-1', userEmail: 'hari@example.com', user: { id: 'u1', email: 'hari@example.com' } };

function seedProject(over = {}) {
  return {
    id: 'proj-1', user_id: 'u1', name: 'Grocery delivery app', description: null, status: 'active',
    repository: null, base_branch: null, stack: null, stack_source: null, repo_context: null,
    coding_agent: 'codex', model_provider: 'openai', model_id: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
  };
}
const linked = (over = {}) => seedProject({ repository: 'acme/grocery-app', base_branch: 'main', stack: 'react-native', stack_source: 'detected', ...over });

/** Opens the plugin. `seed` patches the fake backend; `signedIn` restores a saved session. */
async function openPlugin(mode, seed = {}, { signedIn = true, dark = false, storage } = {}) {
  const context = await browser.newContext({ viewport: { width: 400, height: 680 } });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const s = { mode, ...seed };
  // The 'new' backend has migration 011: existing repos are links already.
  if (mode === 'new' && s.projects && !s.links) {
    s.links = s.projects.filter((p) => p.repository).map((p, i) => ({ id: `link-${i + 1}`, project_id: p.id, repository: p.repository, branch: p.base_branch, app_root: '', stack: p.stack, stack_source: p.stack_source, repo_context: p.repo_context, is_default: true, created_at: '2026-10-01T00:00:00Z' }));
  }
  const clientStorage = storage || (signedIn ? { session: SESSION } : {});
  await context.addInitScript(({ seedJson, storageJson, dark }) => {
    if (!localStorage.getItem('__fakeSeedDone')) {
      localStorage.setItem('__fakeSeed', seedJson);
      localStorage.setItem('__fakeClientStorage', storageJson);
      localStorage.setItem('__fakeSeedDone', '1');
    }
    // Figma adds figma-dark to <html> when the editor is dark (themeColors: true).
    if (dark) document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('figma-dark'));
  }, { seedJson: JSON.stringify(s), storageJson: JSON.stringify(clientStorage), dark });
  await context.addInitScript(fakeScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(base);
  return page;
}

/** Closes and reopens the plugin (same Figma storage, same backend). */
async function reopen(page) {
  await page.reload();
  return page;
}

const btn = (page, name) => page.getByRole('button', { name, exact: true });
const back = (page) => page.locator('header .back');
const row = (page, name) => page.locator('.prow-main', { hasText: name });

async function see(page, text, timeout = 4000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
  } catch (err) {
    const body = await page.locator('#root').innerText().catch(() => '');
    throw new Error(`Expected to see "${text}". The plugin shows:\n${body}`);
  }
}
async function notSee(page, text) {
  assert.equal(await page.getByText(text, { exact: false }).count(), 0, `Did not expect "${text}"`);
}
async function expectRoute(page, name, timeout = 4000) {
  await page.waitForSelector(`.app[data-route="${name}"]`, { timeout }).catch(async () => {
    const actual = await page.locator('.app').getAttribute('data-route');
    throw new Error(`Expected route ${name}, got ${actual}. Shows:\n${await page.locator('#root').innerText()}`);
  });
}
const server = (page) => page.evaluate(() => window.__fake.state());
const setServer = (page, patch) => page.evaluate((p) => window.__fake.set(p), patch);
let shotN = 0;
async function shot(page, name) {
  if (!process.env.E2E_SCREENSHOTS) return;
  await page.screenshot({ path: path.join(shotsDir, `${String(++shotN).padStart(2, '0')}-${name}.png`) });
}

async function linkFirstRepo(page, { repo = 'grocery-app', branch = 'main' } = {}) {
  await expectRoute(page, 'link-repo');
  await see(page, `acme/`);
  assert.ok(await btn(page, 'Select repository').isDisabled(), 'no repo is preselected');
  await page.getByRole('option', { name: new RegExp(repo) }).click();
  await btn(page, 'Use repository').click();
  await expectRoute(page, 'link-branch');
  await see(page, 'Choose a branch');
  await page.getByRole('option', { name: new RegExp(`^${branch}`) }).click();
  await btn(page, `Link ${branch}`).click();
}

for (const mode of ['new', 'legacy']) {
  // ---------------------------------------------------------------- A · sign in
  test(`[${mode}] A1+A2 Google is the only sign-in and lands on an empty Home`, async () => {
    const page = await openPlugin(mode, {}, { signedIn: false });
    await expectRoute(page, 'signin');
    await see(page, 'Turn Figma screens into a pull request');
    await notSee(page, 'Password');
    await shot(page, `${mode}-signin`);
    await btn(page, 'Continue with Google').click();
    await expectRoute(page, 'home', 6000);
    await see(page, 'Start your first project');
    await see(page, 'min left');
    const st = await server(page);
    assert.ok(st.opened.some((u) => u.includes('accounts.google.com')));
    assert.ok(page.errors.length === 0, page.errors.join('\n'));
    await page.context().close();
  });

  test(`[${mode}] A3 Back from waiting for Google returns to Sign in and stops waiting`, async () => {
    const page = await openPlugin(mode, { googleAuto: false }, { signedIn: false });
    await btn(page, 'Continue with Google').click();
    await expectRoute(page, 'google');
    await see(page, 'Waiting for Google');
    await back(page).click();
    await expectRoute(page, 'signin');
    const polls = (await server(page)).googlePolls;
    await page.waitForTimeout(400);
    assert.equal((await server(page)).googlePolls, polls, 'polling stopped');
    await page.context().close();
  });

  test(`[${mode}] A5 a saved session opens straight to the projects`, async () => {
    const page = await openPlugin(mode, { projects: [linked(), seedProject({ id: 'proj-2', name: 'Onboarding revamp' })], github: { connected: true, user: 'harip0919' } });
    await expectRoute(page, 'home');
    await see(page, 'Grocery delivery app');
    await see(page, 'acme/grocery-app · main');
    await see(page, 'No repo linked yet');
    await page.getByRole('img', { name: 'Synced' }).first().waitFor();
    await page.getByRole('img', { name: 'Not linked' }).first().waitFor();
    await shot(page, `${mode}-home`);
    await page.context().close();
  });

  test(`[${mode}] A7 an ended session signs in again and returns to the same project`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' } });
    await row(page, 'Grocery delivery app').click();
    await expectRoute(page, 'project');
    await see(page, 'acme/grocery-app');
    await setServer(page, { tokens: [], refreshFails: true });
    // The next authenticated call (a click or the minutes refresh) finds the session gone.
    await btn(page, 'Switch').click({ timeout: 500 }).catch(() => {});
    await expectRoute(page, 'signin', 6000);
    await see(page, 'Sign in again to continue');
    await see(page, "you'll return to");
    await btn(page, 'Continue with Google').click();
    await expectRoute(page, 'project', 6000);
    await see(page, 'acme/grocery-app');
    assert.equal(await page.locator('header .proj').innerText(), 'Grocery delivery app');
    await page.context().close();
  });

  test(`[${mode}] expired access token is refreshed silently`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, tokens: [] });
    await expectRoute(page, 'home');
    await see(page, 'Grocery delivery app');
    const st = await server(page);
    assert.ok(st.calls.includes('POST /auth/refresh'));
    const saved = await page.evaluate(() => window.__fake.storage().session);
    assert.notEqual(saved.accessToken, 'tok-1', 'the refreshed session is saved');
    await page.context().close();
  });

  // ---------------------------------------------------------------- B · home
  test(`[${mode}] B2+B4 create a project, Back to Home, account sheet and Plans`, async () => {
    const page = await openPlugin(mode, {});
    await expectRoute(page, 'home');
    await btn(page, 'New project').click();
    await expectRoute(page, 'new-project');
    await page.getByLabel('Project name').fill('Field sales app');
    await btn(page, 'Create project').click();
    await expectRoute(page, 'project');
    await see(page, 'No repo linked yet');
    assert.ok(await btn(page, 'Link a repo to build').isDisabled());
    await shot(page, `${mode}-project-new`);
    await back(page).click();
    await expectRoute(page, 'home');
    await see(page, 'Field sales app');
    await btn(page, 'Account').click();
    await see(page, 'Signed in with Google');
    await see(page, 'Use another Google account');
    await shot(page, `${mode}-account`);
    await page.locator('.slink', { hasText: 'Plans and minutes' }).getByRole('button', { name: 'Open' }).click();
    await expectRoute(page, 'billing');
    await see(page, 'Plans and minutes');
    if (mode === 'new') await see(page, 'plus 10 seconds');
    else await see(page, 'charged its run time.');
    await back(page).click();
    await expectRoute(page, 'home');
    await page.context().close();
  });

  test(`[${mode}] B6 rename and delete a project with an inline confirm`, async () => {
    const page = await openPlugin(mode, { projects: [seedProject(), seedProject({ id: 'proj-2', name: 'Marketing site' })] });
    await expectRoute(page, 'home');
    await btn(page, 'More for Marketing site').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Project name').fill('Marketing site v2');
    await btn(page, 'Save').click();
    await see(page, 'Marketing site v2');
    await btn(page, 'More for Marketing site v2').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await see(page, 'Delete Marketing site v2?');
    await btn(page, 'Keep').click();
    await see(page, 'Marketing site v2');
    await btn(page, 'More for Marketing site v2').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await btn(page, 'Delete project').click();
    await page.getByText('Marketing site v2').waitFor({ state: 'detached' });
    assert.equal((await server(page)).projects.length, 1);
    await page.context().close();
  });

  // ---------------------------------------------------------------- D · repos
  test(`[${mode}] D1+D3 link a repo: GitHub on demand, repo, branch, stack detected`, async () => {
    const page = await openPlugin(mode, { projects: [seedProject()] });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Link a repo').click();
    await expectRoute(page, 'link-github');
    await see(page, 'Connect GitHub');
    await btn(page, 'Connect GitHub').click();
    await linkFirstRepo(page);
    await expectRoute(page, 'project', 6000);
    await see(page, 'React Native, detected');
    await see(page, 'acme/grocery-app');
    await page.getByRole('img', { name: 'Synced' }).first().waitFor();
    await shot(page, `${mode}-project-linked`);
    const p = (await server(page)).projects[0];
    assert.deepEqual([p.repository, p.base_branch, p.stack], ['acme/grocery-app', 'main', 'react-native']);
    if (mode === 'new') assert.equal((await server(page)).links.length, 1);
    await page.context().close();
  });

  test(`[${mode}] D4 Back from the branch list returns to repos and saves nothing`, async () => {
    const page = await openPlugin(mode, { projects: [seedProject()], github: { connected: true, user: 'harip0919' } });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Link a repo').click();
    await expectRoute(page, 'link-repo');
    await page.getByRole('option', { name: /grocery-web/ }).click();
    await btn(page, 'Use grocery-web').click();
    await expectRoute(page, 'link-branch');
    await back(page).click();
    await expectRoute(page, 'link-repo');
    await back(page).click();
    await expectRoute(page, 'project');
    await see(page, 'No repo linked yet');
    assert.equal((await server(page)).projects[0].repository, null);
    await page.context().close();
  });

  test(`[${mode}] D6 an empty branch asks for the stack`, async () => {
    const page = await openPlugin(mode, {
      projects: [seedProject()], github: { connected: true, user: 'harip0919' },
      repoContexts: { 'acme/grocery-web@main': { version: 1, status: 'empty', stack: null, summary: 'No files yet' } },
    });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Link a repo').click();
    await linkFirstRepo(page, { repo: 'grocery-web' });
    await expectRoute(page, 'link-stack', 6000);
    await see(page, 'This branch has no app yet');
    await page.getByRole('radio', { name: /React JS/ }).click();
    await shot(page, `${mode}-stack`);
    await btn(page, 'Use React JS').click();
    await expectRoute(page, 'project');
    await see(page, 'React JS');
    await page.context().close();
  });

  test(`[${mode}] D7 a deleted branch shows a warning and is fixed by choosing another`, async () => {
    const page = await openPlugin(mode, { projects: [linked({ base_branch: 'redesign' })], github: { connected: true, user: 'harip0919' } });
    await row(page, 'Grocery delivery app').click();
    await see(page, 'branch "redesign" not found');
    await page.getByRole('img', { name: 'Needs attention' }).first().waitFor();
    await page.getByRole('button', { name: /^Fix / }).click();
    await see(page, 'wasn\'t found');
    await shot(page, `${mode}-link-sheet`);
    await page.locator('.slink', { hasText: 'Change branch' }).getByRole('button', { name: 'Choose' }).click();
    await expectRoute(page, 'link-branch');
    await page.getByRole('option', { name: /^develop/ }).click();
    await btn(page, 'Link develop').click();
    await expectRoute(page, 'project', 6000);
    await see(page, '@ develop');
    await page.getByRole('img', { name: 'Synced' }).first().waitFor();
    await notSee(page, 'not found');
    await page.context().close();
  });

  test(`[${mode}] D8 revoked GitHub access asks to reconnect, then works`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, githubRevoked: true });
    await row(page, 'Grocery delivery app').click();
    await see(page, 'gitHub needs reconnecting');
    await page.getByRole('button', { name: /^Fix / }).click();
    await see(page, 'Reconnect GitHub.');
    await btn(page, 'Reconnect').click();
    await expectRoute(page, 'link-github');
    await btn(page, 'Connect GitHub').click();
    await expectRoute(page, 'link-branch', 6000);
    await page.getByRole('option', { name: /^main/ }).click();
    await btn(page, 'Link main').click();
    await expectRoute(page, 'project', 6000);
    await page.getByRole('img', { name: 'Synced' }).first().waitFor();
    // A GitHub 401 never ends the Design Engineer session.
    await notSee(page, 'Sign in again');
    await page.context().close();
  });

  // ---------------------------------------------------------------- E · model
  test(`[${mode}] E1 switch to Codex CLI with ChatGPT sign-in, back to the project`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, profileModel: mode === 'new' ? { agent: 'claude', provider: 'anthropic', model: null } : null, connections: [{ provider: 'anthropic', status: 'verified' }] });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Switch').click();
    await expectRoute(page, 'model');
    await see(page, 'Applies to all your projects');
    await shot(page, `${mode}-model`);
    await page.getByRole('radio', { name: /Codex CLI/ }).click();
    await btn(page, 'Connect Codex CLI').click();
    await expectRoute(page, 'model-connect');
    await page.getByRole('img', { name: 'Code K7QD-42XMP' }).waitFor();
    await expectRoute(page, 'project', 6000);
    await see(page, 'ChatGPT sign-in');
    const st = await server(page);
    if (mode === 'new') assert.equal(st.profileModel.agent, 'codex');
    else assert.equal((await page.evaluate(() => window.__fake.storage().prefs)).model.agent, 'codex');
    await page.context().close();
  });

  test(`[${mode}] E2 a rejected key stays on the key screen, a good key is used`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' } });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Switch').click();
    await page.getByRole('radio', { name: /Claude Code/ }).click();
    await btn(page, 'Connect Claude Code').click();
    await expectRoute(page, 'model-connect');
    await page.getByLabel(/API key/).fill('bad-key');
    await btn(page, 'Verify and use').click();
    await see(page, 'Anthropic rejected this key');
    await expectRoute(page, 'model-connect');
    await shot(page, `${mode}-key-error`);
    await page.getByLabel(/API key/).fill('sk-ant-good');
    await btn(page, 'Verify and use').click();
    await expectRoute(page, 'project');
    await see(page, 'Claude Code');
    await see(page, 'Anthropic API key');
    await page.context().close();
  });

  test(`[${mode}] removed OpenCode is not selectable`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' } });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Switch').click();
    assert.equal(await page.getByRole('radio', {name: /OpenCode/}).count(), 0);
    assert.equal(await page.getByRole('radio', {name: /Codex CLI/}).count(), 1);
    await page.context().close();
  });

  // ---------------------------------------------------------------- F · build
  test(`[${mode}] page picker only: select four screens, then return and select one`, async () => {
    const frames = ['Login','Home','Cart','Profile'].map((name,i) => ({id:'9:'+i,name,type:'FRAME',width:390,height:844}));
    const page = await openPlugin(mode, {projects:[linked()],github:{connected:true,user:'harip0919'},codex:{connected:true,user:'hari@example.com'},selection:[frames[0]],pageScreens:frames});
    await row(page,'Grocery delivery app').click();
    await btn(page,'Build screens').click();
    assert.equal(await btn(page,'Refresh canvas').count(),0);
    await btn(page,'Browse page screens').click();
    await see(page,'0 of 4 screens selected');
    // Figma canvas click automatically ticks the corresponding screen, and
    // clearing the canvas selection unticks it without stale selections.
    await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'canvas-selection-changed', selectedIds: ['9:1'] } }, '*'));
    await see(page,'1 of 4 screens selected');
    await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'canvas-selection-changed', selectedIds: [] } }, '*'));
    await see(page,'0 of 4 screens selected');
    await btn(page,'Select all').click();
    await btn(page,'Fetch 4 screens').click();
    await expectRoute(page,'plan',6000);
    await see(page,'Plan for 4 screens');
    await back(page).click();
    await expectRoute(page,'screens');
    await btn(page,'Browse page screens').click();
    await see(page,'0 of 4 screens selected');
    await page.getByRole('checkbox',{name:/Login/}).click();
    await btn(page,'Fetch 1 screen').click();
    await expectRoute(page,'plan',6000);
    await see(page,'Plan for 1 screen');
    await page.context().close();
  });

  test(`[${mode}] F2 Plan says Codex isn't connected, Connect returns to the Plan`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, codexAuto: true });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await expectRoute(page, 'screens');
    await see(page, '3 of 3 screens selected');
    await btn(page, 'Fetch 3 screens').click();
    await expectRoute(page, 'plan', 6000);
    await see(page, 'Codex CLI not connected');
    await see(page, 'Fix 1 item to start');
    await shot(page, `${mode}-plan-not-ready`);
    await page.locator('.checklist .c', { hasText: 'not connected' }).getByRole('button', { name: 'Connect' }).click();
    await expectRoute(page, 'plan', 6000);
    await see(page, 'Codex CLI connected');
    await btn(page, 'Start build').waitFor();
    await page.context().close();
  });

  test(`[${mode}] F4 build keeps running after closing, resumes, then shows the PR and charge`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 60 });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await page.getByRole('checkbox', { name: /Cart/ }).click();
    await btn(page, 'Fetch 2 screens').click();
    await expectRoute(page, 'plan', 6000);
    await see(page, 'Repo synced');
    if (mode === 'new') await see(page, 'server start');
    await shot(page, `${mode}-plan-ready`);
    await btn(page, 'Start build').click();
    await expectRoute(page, 'running');
    await see(page, 'Building 2 screens');
    await shot(page, `${mode}-running`);
    // Close and reopen the plugin while the build runs.
    await reopen(page);
    await expectRoute(page, 'running', 6000);
    await see(page, 'Building 2 screens');
    await setServer(page, { jobPollsToFinish: 1 });
    await expectRoute(page, 'result', 8000);
    await see(page, 'Pull request ready to review');
    await see(page, 'Login, Home');
    if (mode === 'new') {
      await see(page, '6 min 3 s');
      await see(page, '6 min 13 s');
      await see(page, 'Server start');
    } else {
      await see(page, '6 min 3 s');
      await notSee(page, 'Server start');
    }
    await shot(page, `${mode}-result`);
    assert.equal(await page.evaluate(() => window.__fake.storage().prefs.job), null, 'the saved job is cleared');
    await btn(page, 'Back to project').click();
    await expectRoute(page, 'project');
    // Today's backend lists builds from the minutes history, without PR links.
    await see(page, mode === 'new' ? 'PR #41' : 'Done');
    // History is interactive: reopen the completed build and its PR details.
    await page.getByRole('button', { name: /View 2 screens build details/ }).click();
    await expectRoute(page, 'result', 6000);
    await see(page, 'Pull request ready to review');
    await btn(page, 'Back to project').click();
    await expectRoute(page, 'project');
    await page.context().close();
  });

  test(`[${mode}] F5+F6 a failed build shows why; Back goes to the Plan; Try again rebuilds`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, nextJobFails: true, nextRunSeconds: 180 });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await btn(page, 'Fetch 3 screens').click();
    await expectRoute(page, 'plan', 6000);
    await btn(page, 'Start build').click();
    await expectRoute(page, 'result', 8000);
    await see(page, "The build didn't finish");
    await see(page, 'npm test exited with code 1');
    await see(page, mode === 'new' ? '3 min 10 s' : '3 min');
    await shot(page, `${mode}-failed`);
    await back(page).click();
    await expectRoute(page, 'plan');
    await see(page, 'Plan for 3 screens');
    await back(page).click();
    await expectRoute(page, 'screens');
    await back(page).click();
    await expectRoute(page, 'project');
    await see(page, 'Failed');
    // Try again from a fresh failure.
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await btn(page, 'Fetch 3 screens').click();
    await expectRoute(page, 'plan', 6000);
    await btn(page, 'Start build').click();
    await expectRoute(page, 'result', 8000);
    await setServer(page, { nextJobFails: false });
    await btn(page, 'Try again').click();
    await expectRoute(page, 'result', 8000);
    await see(page, 'Pull request ready to review', 8000);
    await page.context().close();
  });

  test(`[${mode}] F7 no minutes left: Upgrade opens plans and Back returns to the Plan`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, usage: { plan: 'free', planName: 'Free', allowanceSeconds: 2400, usedSeconds: 2380, availableSeconds: 20, remainingSeconds: 20, reservedSeconds: 0, priceInr: 0, expiresAt: null } });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await btn(page, 'Fetch 3 screens').click();
    await expectRoute(page, 'plan', 6000);
    await see(page, 'Less than 1 build minute left');
    await page.locator('.checklist .c', { hasText: 'build minute' }).getByRole('button', { name: 'Upgrade' }).click();
    await expectRoute(page, 'billing');
    await btn(page, 'Upgrade your plan').click();
    await btn(page, 'Upgrade to Plus').click();
    await see(page, 'Finish paying in your browser');
    assert.ok((await server(page)).opened.some((u) => u.includes('pay.example')));
    await back(page).click();
    await expectRoute(page, 'plan');
    await see(page, 'Plan for 3 screens');
    await page.context().close();
  });

  test(`[${mode}] F8 leaving a running build keeps it running; the model is locked`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 1000 });
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
    await btn(page, 'Fetch 3 screens').click();
    await expectRoute(page, 'plan', 6000);
    await btn(page, 'Start build').click();
    await expectRoute(page, 'running');
    await back(page).click();
    await expectRoute(page, 'project');
    await see(page, 'Building 3 screens');
    await see(page, 'Locked while building');
    await btn(page, 'View running build').click();
    await expectRoute(page, 'running');
    await back(page).click();
    await back(page).click();
    await expectRoute(page, 'home');
    await see(page, 'Building');
    assert.ok(['queued','running'].includes((await server(page)).jobs[0].status), 'Back never cancels the queued or running build');
    await page.context().close();
  });

  test(`[${mode}] N1+N2 Back walks the stack and never signs out`, async () => {
    const page = await openPlugin(mode, { projects: [linked()], github: { connected: true, user: 'harip0919' } });
    await expectRoute(page, 'home');
    await notSee(page, 'Back');
    await row(page, 'Grocery delivery app').click();
    await btn(page, 'Switch').click();
    await expectRoute(page, 'model');
    await page.getByRole('radio', { name: /Claude Code/ }).click();
    await btn(page, 'Connect Claude Code').click();
    await expectRoute(page, 'model-connect');
    await back(page).click();
    await expectRoute(page, 'model');
    await back(page).click();
    await expectRoute(page, 'project');
    await back(page).click();
    await expectRoute(page, 'home');
    assert.ok(await page.evaluate(() => !!window.__fake.storage().session), 'still signed in');
    await page.context().close();
  });
}

// ------------------------------------------------------------- new backend only
test('[new] D11-D13 + F11 link a second repo, make it default, build into it, unlink', async () => {
  const page = await openPlugin('new', { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' } });
  await row(page, 'Grocery delivery app').click();
  await btn(page, '+ Link another').click();
  await linkFirstRepo(page, { repo: 'grocery-web' });
  await expectRoute(page, 'project', 6000);
  await see(page, 'acme/grocery-web');
  await see(page, 'acme/grocery-app');
  let st = await server(page);
  assert.equal(st.links.length, 2);
  assert.equal(st.links.find((l) => l.repository === 'acme/grocery-app').is_default, true);
  // Make grocery-web the default.
  await page.getByRole('button', { name: /Edit acme\/grocery-web/ }).click();
  await page.getByRole('button', { name: /Make default/ }).click();
  await page.waitForFunction(() => window.__fake.state().links.find((l) => l.repository === 'acme/grocery-web').is_default);
  // Build-into picker on the Plan.
  await btn(page, 'Build screens').click();
    await btn(page, 'Browse page screens').click();
    await btn(page, 'Select all').click();
  await btn(page, 'Fetch 3 screens').click();
  await expectRoute(page, 'plan', 6000);
  await see(page, 'acme/grocery-web @ main');
  await page.getByRole('button', { name: /Build into .*change/ }).click();
  await page.locator('.sheet .sel', { hasText: 'acme/grocery-app' }).click();
  await see(page, 'acme/grocery-app @ main');
  await page.waitForFunction(() => window.__fake.state().projects[0].repository === 'acme/grocery-app');
  await shot(page, 'new-plan-target');
  // Unlink the default; the other link becomes default.
  await back(page).click();
  await back(page).click();
  await expectRoute(page, 'project');
  await page.getByRole('button', { name: /Edit acme\/grocery-web/ }).click();
  await page.getByRole('button', { name: /Unlink from project/ }).click();
  await btn(page, 'Unlink').click();
  await page.locator('.set .v', { hasText: 'acme/grocery-web' }).waitFor({ state: 'detached' });
  st = await server(page);
  assert.equal(st.links.length, 1);
  assert.equal(st.links[0].is_default, true);
  await page.context().close();
});

test('[new] D14 linking the same repo and branch again reuses the link', async () => {
  const page = await openPlugin('new', { projects: [linked()], github: { connected: true, user: 'harip0919' } });
  await row(page, 'Grocery delivery app').click();
  await btn(page, '+ Link another').click();
  await linkFirstRepo(page, { repo: 'grocery-app' });
  await expectRoute(page, 'project', 6000);
  assert.equal((await server(page)).links.length, 1);
  await page.context().close();
});

test('[new] the account model carries over from the projects on first use', async () => {
  const page = await openPlugin('new', { projects: [linked({ coding_agent: 'claude', model_provider: 'anthropic' })], github: { connected: true, user: 'harip0919' } });
  await expectRoute(page, 'home');
  await page.waitForFunction(() => window.__fake.state().profileModel?.agent === 'claude');
  await page.context().close();
});

test('[legacy] one repo per project: no "Link another", no repo-link calls succeed', async () => {
  const page = await openPlugin('legacy', { projects: [linked()], github: { connected: true, user: 'harip0919' } });
  await row(page, 'Grocery delivery app').click();
  await see(page, 'acme/grocery-app');
  await notSee(page, '+ Link another');
  await page.getByRole('button', { name: /Edit acme\/grocery-app/ }).click();
  await notSee(page, 'Make default');
  assert.ok(page.errors.length === 0, page.errors.join('\n'));
  await page.context().close();
});

// 1×1 PNG standing in for a heatmap thumbnail.
const HEAT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const FIDELITY = {
  status: 'measured', score: 93.6, grade: 'close', target: 90,
  rounds: [{ score: 71.2, grade: 'needs-work' }, { score: 93.6, grade: 'close' }],
  layers: { geometry: 97, visual: 91, style: 95, interaction: 100, motion: 74, responsive: 100 }, coverage: 96,
  screens: [
    { name: 'Login', route: '/login', status: 'measured', score: 96.1, layers: {}, coverage: 100, matched: 18, total: 18, ssim: 0.97, pixelMatch: 98, heatmapPng: HEAT, previewPng: HEAT, issues: [], issueCount: 0 },
    { name: 'Home', route: '/home', status: 'measured', score: 90.2, layers: {}, coverage: 92, matched: 23, total: 25, ssim: 0.93, pixelMatch: 95, heatmapPng: HEAT, previewPng: HEAT,
      issues: [
        { kind: 'motion', nodeId: '1:5', message: '"Sign in button" → "Home": Transition took 0 ms instead of 300 ms.' },
        { kind: 'geometry', nodeId: '2:3', message: '"Heading" is 4 px too low (Figma x 24, y 96, 342×40)' },
      ], issueCount: 5 },
  ],
  interactions: { total: 3, passed: 3, failed: 0, skipped: 1 },
  warnings: [],
};

test('[new] admin: the build result shows the preview and design fidelity: score, layers, screens, issues', async () => {
  const page = await openPlugin('new', { admin: true, projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 1, nextJobFidelity: FIDELITY });
  await row(page, 'Grocery delivery app').click();
  await btn(page, 'Build screens').click();
  await btn(page, 'Browse page screens').click();
  await btn(page, 'Select all').click();
  await page.getByRole('checkbox', { name: /Cart/ }).click();
  await btn(page, 'Fetch 2 screens').click();
  await expectRoute(page, 'plan', 6000);
  await btn(page, 'Start build').click();
  await expectRoute(page, 'result', 8000);
  await see(page, '2 screens as built');
  await see(page, 'Design fidelity · Close');
  await see(page, 'Admin');
  await see(page, 'First pass 71, fixed to 94');
  await see(page, 'target 90');
  const card = page.locator('section.fid');
  assert.equal(await card.locator('.fid-score b').innerText(), '94');
  for (const label of ['Layout', 'Visual', 'Styles', 'Prototype', 'Motion', 'Responsive']) await see(page, label);
  await see(page, 'Prototype links: 3 worked, 1 not checked.');
  await see(page, '23/25 layers found · 5 issues');
  await notSee(page, 'Heading" is 4 px too low');
  await page.locator('.fid-screen-h', { hasText: 'Home' }).click();
  await see(page, '"Heading" is 4 px too low');
  await see(page, '3 smaller issues listed in the pull request.');
  assert.equal(await page.locator('.fid-screen-h', { hasText: 'Home' }).getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('img.fid-heat').count(), 2);
  await shot(page, 'new-result-fidelity');
  await btn(page, 'Back to project').click();
  await expectRoute(page, 'project');
  await see(page, '94% match');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('[new] admin: a build whose fidelity could not be measured says so and still shows the PR', async () => {
  const page = await openPlugin('new', { admin: true, projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 1,
    nextJobFidelity: { status: 'unavailable', reason: 'no web build found: expected a Vite or Expo app', target: 90, rounds: [] } });
  await row(page, 'Grocery delivery app').click();
  await btn(page, 'Build screens').click();
  await btn(page, 'Browse page screens').click();
  await btn(page, 'Select all').click();
  await page.getByRole('checkbox', { name: /Cart/ }).click();
  await btn(page, 'Fetch 2 screens').click();
  await expectRoute(page, 'plan', 6000);
  await btn(page, 'Start build').click();
  await expectRoute(page, 'result', 8000);
  await see(page, 'Pull request ready to review');
  await see(page, 'Design fidelity not measured');
  await see(page, 'No web build found');
  await see(page, 'The pull request is unaffected.');
  await btn(page, 'Back to project').click();
  await expectRoute(page, 'project');
  await notSee(page, '% match');
  await page.context().close();
});

test('[new] normal account: sees only the preview of the built screens, then opens the PR', async () => {
  const page = await openPlugin('new', { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 1, nextJobFidelity: FIDELITY });
  await row(page, 'Grocery delivery app').click();
  await btn(page, 'Build screens').click();
  await btn(page, 'Browse page screens').click();
  await btn(page, 'Select all').click();
  await page.getByRole('checkbox', { name: /Cart/ }).click();
  await btn(page, 'Fetch 2 screens').click();
  await expectRoute(page, 'plan', 6000);
  await btn(page, 'Start build').click();
  await expectRoute(page, 'result', 8000);
  await see(page, 'Pull request ready to review');
  await see(page, '2 screens as built · tap to enlarge');
  assert.equal(await page.locator('.pv-card').count(), 2);
  // None of the report reaches a normal account.
  await notSee(page, 'Design fidelity');
  await notSee(page, 'Heading');
  assert.equal(await page.locator('section.fid, .fid-off').count(), 0);
  // Enlarge, step through, close.
  await btn(page, 'Open preview of Home').click();
  await see(page, '2 / 2');
  assert.ok(await btn(page, 'Next screen').isDisabled());
  await btn(page, 'Previous screen').click();
  await see(page, '1 / 2');
  await page.keyboard.press('ArrowRight');
  await see(page, '2 / 2');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pv-viewer').count(), 0);
  await shot(page, 'new-result-preview-user');
  assert.equal(await page.getByRole('link', { name: 'Open pull request' }).getAttribute('href'), 'https://github.com/acme/grocery-app/pull/41');
  await btn(page, 'Back to project').click();
  await expectRoute(page, 'project');
  await see(page, 'PR #41');
  await notSee(page, '% match');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('[new] normal account: a build with no preview just offers the pull request', async () => {
  const page = await openPlugin('new', { projects: [linked()], github: { connected: true, user: 'harip0919' }, codex: { connected: true, user: 'hari@example.com' }, jobPollsToFinish: 1,
    nextJobFidelity: { status: 'unavailable', reason: 'no web build found', target: 90, rounds: [] } });
  await row(page, 'Grocery delivery app').click();
  await btn(page, 'Build screens').click();
  await btn(page, 'Browse page screens').click();
  await btn(page, 'Select all').click();
  await page.getByRole('checkbox', { name: /Cart/ }).click();
  await btn(page, 'Fetch 2 screens').click();
  await expectRoute(page, 'plan', 6000);
  await btn(page, 'Start build').click();
  await expectRoute(page, 'result', 8000);
  await see(page, "A preview isn't available for this build.");
  await notSee(page, 'not measured');
  await notSee(page, 'no web build found');
  await page.context().close();
});

test('[new] dark theme uses the Figma dark colours', async () => {
  const page = await openPlugin('new', { projects: [linked()], github: { connected: true, user: 'harip0919' } }, { dark: true });
  await expectRoute(page, 'home');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).backgroundColor);
  assert.equal(bg, 'rgb(26, 27, 38)');
  await shot(page, 'new-dark-home');
  await page.context().close();
});
