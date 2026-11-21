'use strict';
// Real-browser test of the whole Fidelity Engine: builds a faithful and a
// sloppy implementation of the same two Figma screens and checks that the
// score separates them and names the planted mistakes.
//
// Needs Chromium: FIDELITY_CHROMIUM_PATH=/path/to/chrome, or
// `npx playwright-core install chromium`. Skipped when neither is available.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fx = require('./fixtures/fidelity-app');
const fidelity = require('../services/fidelity');
const { serveStatic } = require('../services/fidelity/app');
const { launchBrowser } = require('../services/fidelity/check');

function chromiumAvailable() {
  if (process.env.FIDELITY_CHROMIUM_PATH) return fs.existsSync(process.env.FIDELITY_CHROMIUM_PATH);
  try { return fs.existsSync(require('playwright-core').chromium.executablePath()); } catch { return false; }
}

const skip = chromiumAvailable() ? false : 'Chromium not installed (set FIDELITY_CHROMIUM_PATH)';

test('faithful build scores exact; sloppy build is caught on every layer', { skip, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-e2e-'));
  const good = path.join(root, 'good');
  const bad = path.join(root, 'bad');
  fx.writeApp(good, 'faithful');
  fx.writeApp(bad, 'sloppy');

  // Stand-in for the Figma export: the faithful page at 2x, which the engine
  // downsamples, so the reference is rasterised differently from the check.
  const refs = {};
  const srv = await serveStatic(good);
  const browser = await launchBrowser();
  try {
    for (const [name, route] of [['Login', '/login'], ['Home', '/home']]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      await page.goto(srv.origin + route);
      await page.waitForTimeout(300);
      refs[name] = (await page.screenshot()).toString('base64');
      await page.close();
    }
  } finally { await browser.close(); await srv.close(); }
  const screens = fx.contexts().map((s) => ({ ...s, referencePng: refs[s.name] }));

  const exact = await fidelity.runFidelity({ worktree: good, scratch: path.join(root, 's1'), screens, log: () => {} });
  assert.equal(exact.status, 'measured', exact.reason);
  assert.ok(exact.score >= 95, `faithful scored ${exact.score}`);
  assert.equal(exact.grade, 'exact');
  assert.equal(exact.coverage, 100);
  const nav = exact.interactions.find((i) => i.action === 'NAVIGATE');
  assert.equal(nav.status, 'pass');
  assert.ok(nav.motion && nav.motion.score >= 85, `motion ${JSON.stringify(nav.motion)}`);
  assert.equal(exact.interactions.find((i) => i.action === 'BACK').status, 'pass');

  const sloppy = await fidelity.runFidelity({ worktree: bad, scratch: path.join(root, 's2'), screens, log: () => {} });
  assert.equal(sloppy.status, 'measured');
  assert.ok(sloppy.score < 70, `sloppy scored ${sloppy.score}`);
  const messages = sloppy.screens.flatMap((s) => s.issues.map((i) => i.message)).join('\n');
  assert.match(messages, /"Title" is 8 px too low/);
  assert.match(messages, /Font size 30 px, Figma has 32 px/);
  assert.match(messages, /Corner radius 4 px, Figma has 16 px/);
  assert.match(messages, /"Email field" \(1:4\) isn't in the page/);
  assert.match(messages, /Font is .*, Figma uses "DM Sans"/);
  assert.match(messages, /scrolls sideways/);
  assert.match(messages, /Clicking "Sign in button" should open "Home"/);
  assert.ok(sloppy.layers.visual < exact.layers.visual);

  const job = fidelity.report.forJob(sloppy, { target: 90, rounds: [{ score: sloppy.score }] });
  assert.ok(JSON.stringify(job).length < 200000, 'job result stays small');
  assert.ok(job.screens[0].heatmapPng.length > 100);
});

test('repair loop: a low score sends the problems to the agent and keeps every round', { skip, timeout: 180000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-repair-'));
  const work = path.join(root, 'repo');
  fx.writeApp(work, 'sloppy');
  const prompts = [];
  // Fake agent: reads the repair prompt and "fixes" the app.
  const runAgent = async (prompt) => { prompts.push(prompt); fx.writeApp(work, 'faithful'); };
  let clock = 0;
  const job = await fidelity.checkWithRepair({
    worktree: work, scratchRoot: root, screens: fx.contexts(), runAgent, log: () => {},
    remainingMs: () => 14 * 60 * 1000 - (clock += 1000), repairRounds: 1,
  });
  assert.equal(job.status, 'measured');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /isn't tagged with its node ID/);
  assert.match(prompts[0], /8 px too low/);
  assert.equal(job.rounds.length, 2);
  assert.ok(job.rounds[0].score < 75 && job.rounds[1].score >= 95, JSON.stringify(job.rounds));
  assert.equal(job.score, job.rounds[1].score);
  assert.match(fidelity.report.toMarkdown(job), /first pass/);
});

test('repair loop: no repair when time is short', { skip, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-short-'));
  const work = path.join(root, 'repo');
  fx.writeApp(work, 'sloppy');
  let called = false;
  const job = await fidelity.checkWithRepair({ worktree: work, scratchRoot: root, screens: fx.contexts(), log: () => {},
    runAgent: async () => { called = true; }, remainingMs: () => 3 * 60 * 1000 });
  assert.equal(called, false);
  assert.equal(job.rounds.length, 1);
  const none = await fidelity.checkWithRepair({ worktree: work, scratchRoot: root, screens: fx.contexts(), log: () => {},
    runAgent: async () => {}, remainingMs: () => 30 * 1000 });
  assert.equal(none.status, 'unavailable');
});
