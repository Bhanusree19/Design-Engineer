'use strict';
// Drives Chromium over the built app: measures every screen against its spec,
// diffs it with the Figma export, clicks through prototype interactions while
// sampling their transitions, and resizes to check the layout holds.
const { buildSpec, isClickTrigger } = require('./spec');
const { measureTagged, startSampler, stopSampler, fidSelector } = require('./browser');
const { analyzeSamples, scoreTransition } = require('./motion');
const image = require('./image');
const score = require('./score');

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|\[fc|\[fd|metadata\.google\.internal)/i;

function chromiumPath() {
  return process.env.FIDELITY_CHROMIUM_PATH || undefined;
}

async function launchBrowser() {
  const { chromium } = require('playwright-core');
  const args = ['--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-gpu'];
  // The job container is the sandbox boundary (one build per container);
  // Chromium's own sandbox can't start as root.
  if (process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  return chromium.launch({ executablePath: chromiumPath(), args, headless: true });
}

/** Only the app's own origin and public https resources (fonts, images, APIs). */
async function lockDown(context, origin) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url === origin || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    let u;
    try { u = new URL(url); } catch { return route.abort(); }
    if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname)) return route.abort();
    return route.continue();
  });
}

async function settle(page, { rootId, timeoutMs = 8000 } = {}) {
  await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  if (rootId) await page.waitForSelector(fidSelector(rootId), { state: 'visible', timeout: timeoutMs }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, 2500)),
  ])).catch(() => {});
  await page.waitForTimeout(250);
}

async function openScreen(browser, origin, route, spec, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await lockDown(context, origin);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await settle(page, { rootId: spec.rootId });
  return { context, page, errors };
}

async function rootOffset(page, rootId) {
  if (!rootId) return { x: 0, y: 0, tagged: false };
  const box = await page.locator(fidSelector(rootId)).first().boundingBox().catch(() => null);
  if (!box) return { x: 0, y: 0, tagged: false };
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  return { x: box.x + scroll.x, y: box.y + scroll.y, tagged: true };
}

async function measureScreen(browser, origin, entry, spec, referencePng) {
  const { context, page, errors } = await openScreen(browser, origin, entry.route, spec, { width: spec.width, height: spec.height });
  try {
    const families = [...new Set(spec.elements.map((e) => e.expect.fontFamily).filter(Boolean))];
    const measured = await page.evaluate(measureTagged, { families });
    const offset = await rootOffset(page, spec.rootId);
    const result = score.scoreScreen(spec, measured, { offset });
    if (spec.rootId && !offset.tagged) {
      result.issues.push({ screen: spec.name, nodeId: spec.rootId, nodeName: spec.name, kind: 'missing', impact: 2,
        message: `Screen root isn't tagged: add data-fid / testID "fid:${spec.rootId}" to the screen's outer container` });
    }
    let visual = null;
    if (referencePng) {
      try {
        const shot = await page.screenshot({ clip: { x: offset.x, y: offset.y, width: spec.width, height: spec.height }, animations: 'disabled' });
        const rendered = image.decodePng(shot);
        const ref = image.resample(image.decodePng(referencePng), rendered.width, rendered.height);
        const s = image.ssim(ref, rendered);
        visual = {
          ssim: s.content,
          ssimAll: s.score,
          pixelMatch: image.pixelMatch(ref, rendered),
          score: score.visualScore(s.content),
          heatmapPng: image.heatmapPng(rendered, s),
          worst: image.worstRegions(s, { limit: 3, threshold: 0.7 }),
          badAreas: Array.from(s.map).filter((v) => v < 0.7).length,
        };
        if (visual.score < 0.85) {
          const where = visual.worst.map((r) => `(${r.x}, ${r.y})`).join(', ');
          result.issues.push({ screen: spec.name, nodeId: null, nodeName: spec.name, kind: 'visual', impact: (1 - visual.score) * 3,
            message: `Screen visibly differs from the Figma export in ${visual.badAreas} small area${visual.badAreas === 1 ? '' : 's'} (visual similarity ${Math.round(s.content * 100)}%)${where ? `; worst near ${where}` : ''}` });
        }
      } catch (error) {
        visual = { error: String(error.message || error).slice(0, 160) };
      }
    }
    if (errors.length) {
      result.issues.push({ screen: spec.name, nodeId: null, nodeName: spec.name, kind: 'runtime', impact: 1.5,
        message: `The page threw: ${errors[0]}` });
    }
    return { ...result, visual, rootTagged: offset.tagged, errors };
  } finally {
    await context.close().catch(() => {});
  }
}

async function checkResponsive(browser, origin, entry, spec) {
  const widths = spec.width < 600 ? [360, 430] : spec.width < 1100 ? [768, 1024] : [1280, 1600];
  const checks = [];
  for (const width of widths.filter((w) => Math.abs(w - spec.width) > 8)) {
    const { context, page } = await openScreen(browser, origin, entry.route, spec, { width, height: spec.height });
    try {
      const m = await page.evaluate(measureTagged, { families: [] });
      const overflow = m.scrollWidth > m.innerWidth + 1;
      const texts = spec.elements.filter((e) => e.type === 'text').map((e) => m.elements[e.id]).filter(Boolean);
      const clipped = texts.filter((t) => t.visible && (t.x + t.w > width + 1 || t.x < -1)).length;
      const pass = !overflow && clipped === 0;
      checks.push({ width, pass, overflow, clipped });
    } finally { await context.close().catch(() => {}); }
  }
  const issues = checks.filter((c) => !c.pass).map((c) => ({ screen: spec.name, nodeId: null, nodeName: spec.name, kind: 'responsive', impact: 1,
    message: `At ${c.width} px wide the layout ${c.overflow ? 'scrolls sideways' : ''}${c.overflow && c.clipped ? ' and ' : ''}${c.clipped ? `cuts off ${c.clipped} text layer${c.clipped === 1 ? '' : 's'}` : ''}; use flexible widths instead of fixed positions` }));
  return { score: checks.length ? checks.filter((c) => c.pass).length / checks.length : null, checks, issues };
}

function describeTarget(it, byRoot) {
  if (it.action === 'BACK') return 'back';
  if (it.action === 'URL') return it.url;
  const dest = it.destinationId ? byRoot.get(it.destinationId) : null;
  return dest ? dest.spec.name : it.destinationName || it.destinationId || '?';
}

/** Click (or wait) through one interaction; sample motion when a transition is set. */
async function runInteraction(browser, origin, from, it, byRoot, screens) {
  const base = { source: it.sourceName, sourceId: it.sourceId, screen: from.spec.name, trigger: it.trigger, action: it.action,
    target: describeTarget(it, byRoot), transition: it.transition ? { type: it.transition.type, durationMs: it.transition.durationMs, easing: it.transition.easing?.type || null } : null };
  const clickable = isClickTrigger(it.trigger);
  const timed = it.trigger === 'AFTER_TIMEOUT';
  if (!clickable && !timed) return { ...base, status: 'skipped', reason: `${it.trigger.toLowerCase().replace(/_/g, ' ')} isn't checked yet` };
  if (!['NAVIGATE', 'SWAP', 'OVERLAY', 'BACK', 'URL', 'CLOSE'].includes(it.action)) {
    return { ...base, status: 'skipped', reason: `${it.action.toLowerCase().replace(/_/g, ' ')} isn't checked yet` };
  }

  // BACK needs a way in: another built screen that navigates here.
  let start = from;
  let pre = null;
  if (it.action === 'BACK' || it.action === 'CLOSE') {
    for (const s of screens) {
      const hit = s.spec.interactions.find((x) => x.destinationId && x.destinationId === from.spec.rootId && isClickTrigger(x.trigger) && x.sourceId);
      if (hit && s !== from) { start = s; pre = hit; break; }
    }
    if (!pre) return { ...base, status: 'skipped', reason: 'no built screen leads here, so Back has nowhere to return to' };
  }
  const dest = it.action === 'BACK' || it.action === 'CLOSE' ? start : it.destinationId ? byRoot.get(it.destinationId) : null;
  if (['NAVIGATE', 'SWAP', 'OVERLAY'].includes(it.action) && !dest) {
    return { ...base, status: 'skipped', reason: 'destination screen isn\'t part of this build' };
  }
  if (dest && !dest.spec.rootId) return { ...base, status: 'skipped', reason: 'destination has no root ID (fetch the screens again)' };

  const { context, page } = await openScreen(browser, origin, start.entry.route, start.spec, { width: from.spec.width, height: from.spec.height });
  try {
    if (pre) {
      const reachedFrom = await page.locator(fidSelector(pre.sourceId)).first().click({ timeout: 3000 })
        .then(() => page.waitForSelector(fidSelector(from.spec.rootId), { state: 'visible', timeout: 5000 }))
        .then(() => true).catch(() => false);
      if (!reachedFrom) return { ...base, status: 'skipped', reason: `couldn't reach this screen from "${start.spec.name}" to test going back` };
      await settle(page, {});
    }
    if (it.action === 'URL') {
      const href = await page.locator(fidSelector(it.sourceId)).first().evaluate((el) => (el.closest('a') ? el.closest('a').href : null)).catch(() => null);
      const norm = (u) => String(u || '').replace(/\/+$/, '');
      const pass = !!href && norm(href) === norm(it.url);
      return { ...base, status: pass ? 'pass' : 'fail', reason: pass ? null : href ? `links to ${href}` : 'is not a link' };
    }
    const source = it.sourceId ? page.locator(fidSelector(it.sourceId)).first() : null;
    if (clickable && (!source || !(await source.count()))) {
      return { ...base, status: 'fail', reason: `"${it.sourceName}" isn't tagged with its node ID, so it can't be clicked` };
    }
    const destSel = fidSelector(dest.spec.rootId);
    const sampleIds = [dest.spec.rootId, ...dest.spec.elements.slice().sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, 12).map((e) => e.id)];
    const wantMotion = !!it.transition;
    if (wantMotion) await page.evaluate(startSampler, { selectors: sampleIds.map(fidSelector) });
    const t0 = Date.now();
    if (clickable) await source.click({ timeout: 3000 });
    const waitMs = (timed ? it.timeoutMs || 0 : 0) + (it.transition?.durationMs || 0) + 4000;
    const reached = await page.waitForSelector(destSel, { state: 'visible', timeout: waitMs }).then(() => true).catch(() => false);
    let motion = null;
    if (wantMotion) {
      const expected = it.transition.durationMs || 300;
      const elapsed = Date.now() - t0;
      await page.waitForTimeout(Math.max(0, expected * 2 + 600 - elapsed));
      const frames = await page.evaluate(stopSampler).catch(() => []);
      if (reached) {
        const analysis = analyzeSamples(frames, { viewport: { width: from.spec.width, height: from.spec.height } });
        motion = scoreTransition(it.transition, analysis);
      }
    }
    if (!reached) return { ...base, status: 'fail', reason: `"${dest.spec.name}" didn't appear after ${clickable ? 'clicking' : 'waiting'}`, motion: null };
    return { ...base, status: 'pass', reason: null, motion };
  } catch (error) {
    return { ...base, status: 'fail', reason: String(error.message || error).split('\n')[0].slice(0, 160) };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * @param {object} p
 * @param {string} p.origin                 static server origin
 * @param {Array}  p.screens                [{ name, context, referencePng }]
 * @param {object} p.manifest               readManifest() output
 * @param {number} [p.budgetMs]
 */
async function checkScreens({ origin, screens, manifest, budgetMs = 4 * 60 * 1000, log = () => {} }) {
  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  const routes = new Map((manifest?.screens || []).map((s) => [s.name.toLowerCase(), s]));
  const byRootManifest = new Map((manifest?.screens || []).filter((s) => s.rootId).map((s) => [s.rootId, s]));
  const prepared = [];
  const warnings = [];
  for (const s of screens) {
    const spec = buildSpec(s.context, s.name);
    if (!spec.width || !spec.height) { warnings.push(`${s.name}: no frame size in the design context`); continue; }
    const entry = (spec.rootId && byRootManifest.get(spec.rootId)) || routes.get(spec.name.toLowerCase()) || routes.get(String(s.name).toLowerCase())
      || (screens.length === 1 ? { name: spec.name, route: '/' } : null);
    if (!entry) { warnings.push(`${spec.name}: no route in ${'design-engineer.fidelity.json'}`); }
    if (spec.originEstimated) warnings.push(`${spec.name}: fetched with an older plugin; positions are estimated. Fetch it again for exact checks.`);
    prepared.push({ spec, entry, referencePng: s.referencePng || null });
  }
  const byRoot = new Map(prepared.filter((p) => p.spec.rootId && p.entry).map((p) => [p.spec.rootId, p]));
  const browser = await launchBrowser();
  const results = [];
  const interactions = [];
  try {
    for (const p of prepared) {
      if (!p.entry) {
        results.push({ name: p.spec.name, slug: p.spec.slug, route: null, status: 'no-route', issues: [{ screen: p.spec.name, kind: 'missing', impact: 5,
          message: `"${p.spec.name}" has no route in design-engineer.fidelity.json, so it couldn't be opened` }] });
        continue;
      }
      if (overBudget()) { results.push({ name: p.spec.name, slug: p.spec.slug, route: p.entry.route, status: 'skipped', issues: [] }); continue; }
      log(`[fidelity] Measuring ${p.spec.name} at ${p.entry.route}`);
      const m = await measureScreen(browser, origin, p.entry, p.spec, p.referencePng);
      const responsive = overBudget() ? { score: null, checks: [], issues: [] } : await checkResponsive(browser, origin, p.entry, p.spec);
      results.push({ name: p.spec.name, slug: p.spec.slug, route: p.entry.route, status: 'measured', ...m, responsive,
        issues: [...m.issues, ...responsive.issues] });
    }
    const runnable = prepared.filter((p) => p.entry);
    for (const p of runnable) {
      for (const it of p.spec.interactions) {
        if (overBudget()) { interactions.push({ source: it.sourceName, screen: p.spec.name, trigger: it.trigger, action: it.action, status: 'skipped', reason: 'time budget used up' }); continue; }
        interactions.push(await runInteraction(browser, origin, p, it, byRoot, runnable));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return summarize(results, interactions, warnings, Date.now() - started);
}

function summarize(results, interactions, warnings, durationMs) {
  const measured = results.filter((r) => r.status === 'measured');
  const tested = interactions.filter((i) => i.status !== 'skipped');
  const motions = interactions.filter((i) => i.motion).map((i) => i.motion.score);
  const missingMotion = interactions.filter((i) => i.status === 'fail' && i.transition).length;
  const layers = {
    geometry: score.mean(results.map((r) => (r.status === 'measured' ? r.geometry : r.status === 'no-route' ? 0 : null))),
    visual: score.mean(measured.map((r) => r.visual?.score)),
    style: score.mean(measured.map((r) => r.style)),
    responsive: score.mean(measured.map((r) => r.responsive?.score)),
    interaction: tested.length ? tested.filter((i) => i.status === 'pass').length / tested.length : null,
    motion: motions.length || missingMotion ? (motions.reduce((a, b) => a + b, 0)) / (motions.length + missingMotion) : null,
  };
  const coverage = score.mean(measured.map((r) => r.coverage));
  const screens = results.map((r) => {
    const own = interactions.filter((i) => i.screen === r.name);
    const ownTested = own.filter((i) => i.status !== 'skipped');
    const ownMotion = own.filter((i) => i.motion).map((i) => i.motion.score);
    const l = r.status === 'measured' ? {
      geometry: r.geometry, visual: r.visual?.score ?? null, style: r.style, responsive: r.responsive?.score ?? null,
      interaction: ownTested.length ? ownTested.filter((i) => i.status === 'pass').length / ownTested.length : null,
      motion: ownMotion.length ? score.mean(ownMotion) : null,
    } : null;
    return {
      name: r.name, slug: r.slug, route: r.route, status: r.status,
      score: l ? score.combine(l) : 0,
      layers: l ? Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v == null ? null : score.round(v * 100, 0)])) : null,
      coverage: r.status === 'measured' ? score.round(r.coverage * 100, 0) : null,
      matched: r.matched ?? 0, total: r.total ?? 0,
      ssim: r.visual?.ssim != null ? score.round(r.visual.ssim, 3) : null,
      pixelMatch: r.visual?.pixelMatch != null ? score.round(r.visual.pixelMatch * 100, 0) : null,
      heatmapPng: r.visual?.heatmapPng || null,
      issues: (r.issues || []).slice(),
    };
  });
  for (const i of interactions) {
    if (i.status === 'fail') {
      const s = screens.find((x) => x.name === i.screen);
      s?.issues.push({ screen: i.screen, nodeId: i.sourceId || null, nodeName: i.source, kind: 'interaction', impact: 3,
        message: `${i.trigger === 'AFTER_TIMEOUT' ? 'After the delay' : `Clicking "${i.source}"`} should ${i.action === 'BACK' ? 'go back' : `open "${i.target}"`}, but ${i.reason}` });
    } else if (i.motion && i.motion.score < 0.85 && i.motion.message) {
      const s = screens.find((x) => x.name === i.screen);
      s?.issues.push({ screen: i.screen, nodeId: i.sourceId || null, nodeName: i.source, kind: 'motion', impact: (1 - i.motion.score) * 2,
        message: `"${i.source}" → "${i.target}": ${i.motion.message} Figma: ${i.transition.type.toLowerCase().replace(/_/g, ' ')}, ${i.transition.durationMs} ms, ${String(i.transition.easing || 'ease out').toLowerCase().replace(/_/g, ' ')}.` });
    }
  }
  for (const s of screens) s.issues.sort((a, b) => b.impact - a.impact);
  const overall = score.combine(layers);
  return {
    status: 'measured',
    score: overall,
    grade: score.grade(overall),
    layers: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v == null ? null : score.round(v * 100, 0)])),
    coverage: coverage == null ? null : score.round(coverage * 100, 0),
    screens,
    interactions: interactions.map((i) => ({ ...i, motion: i.motion ? { score: score.round(i.motion.score * 100, 0), measuredMs: i.motion.measuredMs, expectedMs: i.motion.expectedMs } : null })),
    warnings,
    durationMs,
  };
}

module.exports = { checkScreens, summarize, launchBrowser };
