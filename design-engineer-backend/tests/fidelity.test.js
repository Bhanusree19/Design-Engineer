'use strict';
// Unit tests for the Fidelity Engine's pure parts: colour, easing, image
// similarity, spec building, scoring, motion analysis, reports and manifest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const { parseColor, deltaE } = require('../services/fidelity/color');
const { cubicBezier, normalizeEasing } = require('../services/fidelity/easing');
const image = require('../services/fidelity/image');
const { buildSpec } = require('../services/fidelity/spec');
const score = require('../services/fidelity/score');
const { analyzeSamples, scoreTransition } = require('../services/fidelity/motion');
const report = require('../services/fidelity/report');
const app = require('../services/fidelity/app');
const fidelity = require('../services/fidelity');
const fx = require('./fixtures/fidelity-app');

test('parses hex and rgb colours and measures perceptual distance', () => {
  assert.deepEqual(parseColor('#3346f0'), { r: 51, g: 70, b: 240, a: 1 });
  assert.deepEqual(parseColor('rgba(51, 70, 240, 0.5)'), { r: 51, g: 70, b: 240, a: 0.5 });
  assert.equal(parseColor('rgb(0 0 0 / 50%)').a, 0.5);
  assert.ok(deltaE('#3346f0', 'rgb(51, 70, 240)') < 0.01);
  assert.ok(deltaE('#15172b', 'rgb(51, 51, 51)') > 5);
  assert.equal(deltaE('nope', '#fff'), null);
});

test('cubic-bezier matches known points and Figma presets resolve', () => {
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-4);
  const easeOut = cubicBezier(...normalizeEasing({ type: 'EASE_OUT' }).bezier);
  assert.ok(easeOut(0.5) > 0.6, 'ease-out is ahead of linear halfway');
  const custom = normalizeEasing({ type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.2, y1: 0, x2: 0, y2: 1 } });
  assert.deepEqual(custom.bezier, [0.2, 0, 0, 1]);
  assert.equal(normalizeEasing({ type: 'GENTLE' }).spring, true);
});

function solid(width, height, rgb, draw) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  const img = { width, height, data };
  if (draw) draw(img);
  return img;
}
function rect(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * img.width + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2];
  }
}

test('SSIM is 1 for identical images and drops where content moved', () => {
  const a = solid(64, 64, [255, 255, 255], (i) => rect(i, 8, 8, 20, 10, [20, 20, 40]));
  const b = solid(64, 64, [255, 255, 255], (i) => rect(i, 8, 16, 20, 10, [20, 20, 40]));
  assert.ok(Math.abs(image.ssim(a, a).score - 1) < 1e-9);
  const moved = image.ssim(a, b);
  assert.ok(moved.content < 0.8, `content SSIM ${moved.content}`);
  assert.ok(moved.score > moved.content, 'empty background dilutes the plain mean');
  const heat = PNG.sync.read(Buffer.from(image.heatmapPng(b, moved, { maxWidth: 32 }), 'base64'));
  assert.equal(heat.width, 32);
  assert.ok(image.worstRegions(moved).length > 0);
});

test('resample keeps solid colours and halves a 2x export', () => {
  const big = solid(20, 10, [10, 200, 30]);
  const small = image.resample(big, 10, 5);
  assert.equal(small.width, 10);
  assert.deepEqual([...small.data.subarray(0, 3)], [10, 200, 30]);
  const png = image.encodePng(small);
  assert.equal(image.decodePng(png).height, 5);
});

test('spec: relative boxes, hidden and icon internals skipped, interactions kept', () => {
  const [login] = fx.contexts();
  const spec = buildSpec(login.context);
  assert.equal(spec.rootId, '1:1');
  assert.equal(spec.originEstimated, false);
  const title = spec.elements.find((e) => e.id === '1:2');
  assert.deepEqual(title.box, { x: 24, y: 96, w: 342, h: 40 });
  assert.equal(title.expect.fontSize, 32);
  assert.equal(title.expect.fontFamily, 'DM Sans');
  assert.ok(spec.elements.find((e) => e.id === '1:6'), 'text inside an instance is checked');
  assert.equal(spec.interactions.length, 1);
  assert.equal(spec.interactions[0].destinationId, '2:1');
  assert.equal(spec.interactions[0].transition.durationMs, 300);

  const withHidden = buildSpec({ screen: { screen: 'X', width: 100, height: 100, rootId: '0:1', origin: { x: 0, y: 0 }, elements: [
    { id: 'a', type: 'frame', name: 'Hidden', x: 0, y: 0, width: 50, height: 50, visible: false, colors: ['#000000'] },
    { id: 'b', parentId: 'a', type: 'text', name: 'Child of hidden', x: 0, y: 0, width: 20, height: 10, text: 'x' },
    { id: 'c', type: 'frame', name: 'Icon', x: 60, y: 60, width: 24, height: 24 },
    { id: 'd', parentId: 'c', type: 'vector', name: 'Path', x: 62, y: 62, width: 20, height: 20, colors: ['#000000'] },
    { id: 'e', type: 'rectangle', name: 'Off frame', x: 200, y: 0, width: 20, height: 20, colors: ['#000000'] },
  ] } });
  assert.deepEqual(withHidden.elements.map((e) => e.id), ['c']);
});

test('spec: v2 contexts estimate the frame origin and say so', () => {
  const spec = buildSpec({ contextVersion: '2.0', screen: { screen: 'Old', width: 100, height: 100, elements: [
    { id: '1', type: 'rectangle', name: 'Bg', x: 500, y: 300, width: 100, height: 100, colors: ['#ffffff'] },
    { id: '2', type: 'text', name: 'T', x: 510, y: 320, width: 50, height: 20, text: 'Hi', fontSize: 14 },
  ] } });
  assert.equal(spec.originEstimated, true);
  assert.deepEqual(spec.elements[1].box, { x: 10, y: 20, w: 50, h: 20 });
});

const measured = (over = {}) => ({
  fonts: { 'DM Sans': true },
  elements: {
    '1:2': { x: 24, y: 96, w: 342, h: 40, visible: true, text: 'Welcome back', textBox: { x: 24, y: 96, w: 232, h: 40 },
      style: { color: 'rgb(21, 23, 43)', fontSize: 32, fontWeight: 700, lineHeight: 40, letterSpacing: 0, fontFamily: '"DM Sans", sans-serif', opacity: 1 } },
    ...over,
  },
});

test('scoring: exact element gets full marks, offsets and style errors are reported', () => {
  const spec = { name: 'S', elements: [buildSpec(fx.contexts()[0].context).elements.find((e) => e.id === '1:2')] };
  const exact = score.scoreScreen(spec, measured());
  assert.equal(exact.geometry, 1);
  assert.equal(exact.style, 1);
  assert.equal(exact.issues.length, 0);

  const off = score.scoreScreen(spec, measured({ '1:2': { ...measured().elements['1:2'], y: 104, textBox: { x: 24, y: 104, w: 232, h: 40 },
    style: { ...measured().elements['1:2'].style, color: 'rgb(51,51,51)', fontSize: 30 } } }));
  assert.ok(off.geometry < 0.9);
  assert.ok(off.style < 0.9, `style ${off.style}`);
  assert.ok(off.issues.some((i) => /8 px too low/.test(i.message)));
  assert.ok(off.issues.some((i) => /Font size 30 px/.test(i.message)));

  const missing = score.scoreScreen(spec, { elements: {} });
  assert.equal(missing.coverage, 0);
  assert.equal(missing.issues[0].kind, 'missing');
});

test('scoring: a font that is named but not loaded is flagged', () => {
  const spec = { name: 'S', elements: [buildSpec(fx.contexts()[0].context).elements.find((e) => e.id === '1:2')] };
  const r = score.scoreScreen(spec, { ...measured(), fonts: { 'DM Sans': false } });
  assert.ok(r.issues.some((i) => /didn't load/.test(i.message)));
});

test('combine renormalises over measured layers and grades', () => {
  assert.equal(score.combine({ geometry: 1, visual: 1, style: 1, interaction: null, motion: null, responsive: null }), 100);
  assert.equal(score.combine({ geometry: 0.5, visual: 0.5 }), 50);
  assert.equal(score.grade(96), 'exact');
  assert.equal(score.grade(88), 'close');
  assert.equal(score.grade(72), 'needs-work');
  assert.equal(score.grade(40), 'off');
});

function framesFor(fn, ms = 300, steps = 20) {
  const frames = [{ t: 0, items: {} }];
  for (let i = 0; i <= steps + 8; i++) {
    const t = 16 + (i * ms) / steps;
    const p = Math.min(1, (i * ms) / steps / ms);
    frames.push({ t, items: { '#d': { x: 390 * (1 - fn(p)), y: 0, w: 390, h: 844, o: 1 } } });
  }
  return frames;
}

test('motion: measures duration and recognises the easing curve', () => {
  const easeOut = cubicBezier(0, 0, 0.58, 1);
  const a = analyzeSamples(framesFor(easeOut, 300));
  assert.equal(a.moved, true);
  assert.equal(a.channel, 'x');
  assert.ok(Math.abs(a.durationMs - 300) < 40, `duration ${a.durationMs}`);
  const good = scoreTransition({ type: 'MOVE_IN', durationMs: 300, easing: { type: 'EASE_OUT' } }, a);
  assert.ok(good.score > 0.9, `score ${good.score}`);

  const slow = scoreTransition({ type: 'MOVE_IN', durationMs: 300, easing: { type: 'EASE_OUT' } }, analyzeSamples(framesFor(easeOut, 800)));
  assert.ok(slow.durationScore < 0.5);
  assert.match(slow.message, /instead of 300 ms/);

  const wrongCurve = scoreTransition({ type: 'MOVE_IN', durationMs: 300, easing: { type: 'EASE_IN' } }, a);
  assert.ok(wrongCurve.curveScore < good.curveScore);

  const instant = scoreTransition({ type: 'DISSOLVE', durationMs: 200, easing: { type: 'LINEAR' } }, { moved: false });
  assert.equal(instant.score, 0);
  assert.match(instant.message, /changed instantly/);
});

test('report: job copy is bounded, markdown and repair prompt name the problems', () => {
  const full = { status: 'measured', score: 72.4, grade: 'needs-work', layers: { geometry: 80, visual: 70, style: 75, interaction: 50, motion: 0, responsive: 100 },
    coverage: 90, warnings: [], durationMs: 1000,
    screens: [{ name: 'Login', route: '/login', status: 'measured', score: 72.4, layers: {}, coverage: 90, matched: 9, total: 10, ssim: 0.9, pixelMatch: 95, heatmapPng: 'xx',
      issues: Array.from({ length: 12 }, (_, i) => ({ screen: 'Login', nodeId: `1:${i}`, kind: 'geometry', impact: 12 - i, message: `"Thing ${i}" is ${i + 3} px too low` })) }],
    interactions: [{ status: 'pass' }, { status: 'fail' }, { status: 'skipped' }] };
  const job = report.forJob(full, { target: 90, rounds: [{ score: 60 }, { score: 72.4 }] });
  assert.equal(job.screens[0].issues.length, 8);
  assert.equal(job.screens[0].issueCount, 12);
  assert.deepEqual(job.interactions, { total: 3, passed: 1, failed: 1, skipped: 1 });
  const md = report.toMarkdown(job);
  assert.match(md, /72.4 \/ 100/);
  assert.match(md, /first pass 60/);
  const prompt = report.repairPrompt(full, { limit: 5 });
  assert.match(prompt, /node 1:0/);
  assert.doesNotMatch(prompt, /Thing 7/);
  assert.match(report.toMarkdown({ status: 'unavailable', reason: 'no build' }), /Not measured: no build/);
});

test('manifest: validated, routes must be paths, appRoot must stay in the repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-man-'));
  assert.equal(app.readManifest(dir), null);
  fs.writeFileSync(path.join(dir, app.MANIFEST), JSON.stringify({ appRoot: '../..', screens: [] }));
  assert.throws(() => app.readManifest(dir), /inside the repository/);
  fs.writeFileSync(path.join(dir, app.MANIFEST), JSON.stringify({ screens: [
    { name: 'Ok', rootId: '1:1', route: '/login' }, { name: 'Bad', route: 'https://evil.example' }, { name: 'Bad2', route: '//evil' },
  ] }));
  const m = app.readManifest(dir);
  assert.deepEqual(m.screens.map((s) => s.name), ['Ok']);
  assert.equal(m.appRoot, '.');
});

test('static server: serves files, falls back to the app shell, refuses to escape root', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-srv-'));
  const root = path.join(dir, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<p>shell</p>');
  fs.writeFileSync(path.join(root, 'app.js'), 'x=1');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'));
  const srv = await app.serveStatic(root);
  try {
    assert.equal(await (await fetch(srv.origin + '/app.js')).text(), 'x=1');
    assert.equal(await (await fetch(srv.origin + '/login')).text(), '<p>shell</p>');
    assert.equal((await fetch(srv.origin + '/link.txt')).status, 404);
    assert.notEqual(await (await fetch(srv.origin + '/%2e%2e/secret.txt')).text(), 'secret');
    assert.equal((await fetch(srv.origin + '/', { method: 'POST' })).status, 405);
  } finally { await srv.close(); }
});

test('framework detection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-fw-'));
  const w = (pkg) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  w({ dependencies: { expo: '1', 'react-native': '1' } });
  assert.equal(app.detectFramework(dir).kind, 'expo');
  w({ devDependencies: { vite: '5' } });
  assert.equal(app.detectFramework(dir).kind, 'vite');
  fs.rmSync(path.join(dir, 'package.json'));
  fs.writeFileSync(path.join(dir, 'index.html'), '');
  assert.equal(app.detectFramework(dir).kind, 'static');
});

test('prompt contract names the tagging convention per stack and the screen roots', () => {
  const screens = fx.contexts();
  const rn = fidelity.promptContract(screens, 'react-native');
  assert.match(rn, /testID="fid:<node id>"/);
  assert.match(rn, /"Login": root node 1:1, 390×844/);
  assert.match(rn, /expo export --platform web/);
  const web = fidelity.promptContract(screens, 'react-js');
  assert.match(web, /data-fid="<node id>"/);
  assert.match(web, /design-engineer.fidelity.json/);
});

test('runFidelity never throws: missing manifest for several screens is "unavailable"', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-none-'));
  const r = await fidelity.runFidelity({ worktree: dir, scratch: dir, screens: fx.contexts(), log: () => {} });
  assert.equal(r.status, 'unavailable');
  assert.match(r.reason, /missing/);
});

test('reference PNG from the plugin is validated before it is stored', () => {
  const png = image.encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 255) }).toString('base64');
  assert.deepEqual(fidelity.validReferencePng({ pngBase64: png, scale: 1 }), { pngBase64: png, scale: 1 });
  assert.equal(fidelity.validReferencePng({ pngBase64: png, scale: 99 }).scale, 1);
  assert.equal(fidelity.validReferencePng({ pngBase64: Buffer.from('GIF89a........').toString('base64') }), null);
  assert.equal(fidelity.validReferencePng({ pngBase64: 'not base64!' }), null);
  assert.equal(fidelity.validReferencePng(null), null);
});

test('admin: decided from ADMIN_EMAILS / ADMIN_USER_IDS, case-insensitive', () => {
  const { isAdmin } = require('../services/admin');
  const saved = { e: process.env.ADMIN_EMAILS, i: process.env.ADMIN_USER_IDS };
  try {
    delete process.env.ADMIN_EMAILS; delete process.env.ADMIN_USER_IDS;
    assert.equal(isAdmin({ id: 'u1', email: 'hari@example.com' }), false, 'nobody is admin by default');
    process.env.ADMIN_EMAILS = ' Hari@Example.com , boss@x.io';
    assert.equal(isAdmin({ id: 'u1', email: 'hari@example.com' }), true);
    assert.equal(isAdmin({ id: 'u2', email: 'someone@example.com' }), false);
    assert.equal(isAdmin(null), false);
    process.env.ADMIN_USER_IDS = 'u9';
    assert.equal(isAdmin({ id: 'u9', email: 'changed@example.com' }), true);
  } finally {
    if (saved.e == null) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = saved.e;
    if (saved.i == null) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = saved.i;
  }
});

test('result for viewer: admins get the report, others only the screen preview', () => {
  const stored = { screens: ['Login'], branch: 'b', pullRequestUrl: 'https://github.com/a/b/pull/1',
    fidelity: { status: 'measured', score: 93.6, grade: 'close', layers: { geometry: 97 },
      screens: [{ name: 'Login', score: 96, previewPng: 'PREVIEW', heatmapPng: 'HEAT', issues: [{ kind: 'geometry', message: 'off' }] },
        { name: 'Home', score: 90, previewPng: null, issues: [] }] } };
  const user = report.resultForViewer(stored, { admin: false });
  assert.equal(user.fidelity, undefined);
  assert.deepEqual(user.preview, { status: 'ready', screens: [{ name: 'Login', imagePng: 'PREVIEW' }] });
  assert.equal(user.pullRequestUrl, stored.pullRequestUrl);
  assert.doesNotMatch(JSON.stringify(user), /HEAT|issues|score/);

  const admin = report.resultForViewer(stored, { admin: true });
  assert.equal(admin.fidelity.score, 93.6);
  assert.equal(admin.fidelity.screens[0].heatmapPng, 'HEAT');
  assert.equal(admin.fidelity.screens[0].previewPng, undefined, 'images are not sent twice');
  assert.equal(admin.preview.screens.length, 1);

  assert.deepEqual(report.resultForViewer({ pullRequestUrl: 'x' }), { pullRequestUrl: 'x' }, 'older builds pass through');
  assert.deepEqual(report.previewOf({ status: 'unavailable' }), { status: 'unavailable', screens: [] });
});

test('preview PNG keeps phone frames at 1x and scales wide frames down', () => {
  const phone = image.decodePng(Buffer.from(image.previewPng(solid(390, 20, [1, 2, 3])), 'base64'));
  assert.equal(phone.width, 390);
  const desktop = image.decodePng(Buffer.from(image.previewPng(solid(1440, 90, [1, 2, 3])), 'base64'));
  assert.equal(desktop.width, 480);
  assert.equal(desktop.height, 30);
});
