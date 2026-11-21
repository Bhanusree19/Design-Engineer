'use strict';
// Fidelity Engine: measures how exactly a generated app reproduces the Figma
// screens it was built from. Never throws: a check that can't run returns
// { status: 'unavailable', reason } so the build still opens its pull request.
const path = require('node:path');
const app = require('./app');
const { checkScreens } = require('./check');
const report = require('./report');
const { buildSpec } = require('./spec');

const DEFAULT_TARGET = 90;

function enabled() { return process.env.FIDELITY_CHECK !== '0'; }
function target() {
  const t = Number(process.env.FIDELITY_TARGET);
  return Number.isFinite(t) && t > 0 && t <= 100 ? t : DEFAULT_TARGET;
}

/**
 * @param {object} p
 * @param {string} p.worktree   the generated repository checkout
 * @param {string} p.scratch    an empty folder this check may use
 * @param {Array}  p.screens    [{ name, context, referencePng }]
 * @param {number} [p.budgetMs] total time allowed (build + browser)
 */
async function runFidelity({ worktree, scratch, screens, budgetMs = 7 * 60 * 1000, log = console.log }) {
  const started = Date.now();
  let server = null;
  try {
    if (!enabled()) return { status: 'unavailable', reason: 'fidelity check is turned off on this server' };
    let manifest;
    try { manifest = app.readManifest(worktree); } catch (error) { return { status: 'unavailable', reason: error.message }; }
    if (!manifest && screens.length > 1) {
      return { status: 'unavailable', reason: `${app.MANIFEST} is missing, so the screens' routes are unknown` };
    }
    const built = await app.prepareStaticApp({ worktree, scratch: path.join(scratch, 'fidelity'), manifest, log, budgetMs: budgetMs * 0.6 });
    log(`[fidelity] ${built.framework} web build ready in ${Math.round(built.ms / 1000)} s`);
    server = await app.serveStatic(built.root);
    const remaining = Math.max(30000, budgetMs - (Date.now() - started));
    const result = await checkScreens({ origin: server.origin, screens, manifest, budgetMs: remaining, log });
    log(`[fidelity] Score ${result.score} (${result.grade}) in ${Math.round((Date.now() - started) / 1000)} s`);
    return result;
  } catch (error) {
    log(`[fidelity] Check unavailable: ${error.message}`);
    return { status: 'unavailable', reason: String(error.message || error).split('\n')[0].slice(0, 200) };
  } finally {
    if (server) await server.close().catch(() => {});
  }
}

/**
 * Measure, and while the score is under target and time allows, hand the
 * agent the worst problems and measure again. Returns the job copy
 * (report.forJob) with every round's score.
 *
 * @param {object} p
 * @param {(prompt: string, timeoutMs: number) => Promise<void>} p.runAgent
 * @param {() => number} p.remainingMs   time left in the build
 */
async function checkWithRepair({ worktree, scratchRoot, screens, runAgent, remainingMs,
  checkBudgetMs = 5 * 60 * 1000, reserveMs = 90 * 1000, repairMinMs = 5 * 60 * 1000, repairRounds = 1, log = console.log }) {
  const goal = target();
  const rounds = [];
  const measure = () => runFidelity({ worktree, scratch: path.join(scratchRoot, `fidelity-${rounds.length}`), screens, log,
    budgetMs: Math.max(60000, Math.min(checkBudgetMs, remainingMs() - reserveMs)) });
  let current = remainingMs() > reserveMs + 60000
    ? await measure()
    : { status: 'unavailable', reason: 'not enough build time left to run the check' };
  if (current.status === 'measured') rounds.push({ score: current.score, grade: current.grade });
  while (current.status === 'measured' && current.score < goal && rounds.length <= repairRounds && remainingMs() > repairMinMs) {
    log(`[fidelity] ${current.score} is under ${goal}: repair round ${rounds.length}`);
    try {
      await runAgent(report.repairPrompt(current), Math.max(60000, remainingMs() - reserveMs - 120000));
    } catch (error) {
      log(`[fidelity] Repair round stopped: ${error?.code || error?.message || 'error'}`);
      break;
    }
    const next = await measure();
    if (next.status !== 'measured') break;
    rounds.push({ score: next.score, grade: next.grade });
    current = next;
  }
  return report.forJob(current, { target: goal, rounds });
}

const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
/** The plugin's Figma export: accepted only as a real PNG within size limits. */
function validReferencePng(ref) {
  if (!ref || typeof ref !== 'object' || typeof ref.pngBase64 !== 'string') return null;
  const b64 = ref.pngBase64;
  if (!b64 || b64.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const head = Buffer.from(b64.slice(0, 16), 'base64');
  if (head.length < 8 || head.readUInt32BE(0) !== 0x89504e47 || head.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const scale = typeof ref.scale === 'number' && ref.scale > 0 && ref.scale <= 4 ? ref.scale : 1;
  return { pngBase64: b64, scale };
}

/** Lines added to the coding agent's prompt so its output can be measured. */
function promptContract(screens, stack) {
  const rn = stack !== 'react-js';
  const roots = screens.map((s) => {
    let spec = null;
    try { spec = buildSpec(s.context, s.name); } catch { spec = null; }
    return `  - "${spec?.name || s.name}": root node ${spec?.rootId || '(see rootId in its JSON)'}, ${spec ? `${spec.width}×${spec.height}` : 'frame size in its JSON'}`;
  }).join('\n');
  const tag = rn ? 'testID="fid:<node id>"' : 'data-fid="<node id>"';
  return `
Fidelity contract (your output is rendered in Chromium and measured against Figma, node by node):
A. Tag what you render with the Figma node ID it implements: ${tag} (example: ${rn ? 'testID="fid:12:345"' : 'data-fid="12:345"'}). Tag every visible element from the design context: texts, buttons, inputs, cards, images, containers with a fill, border or radius. Inside component instances tag the instance and its text labels. Keep the tags in the committed code.
B. Tag each screen's outermost container with the screen's root node ID (rootId in its JSON):
${roots}
C. Match the design exactly at the frame's width: positions, sizes, fills, text colour, font family, size, weight, line height, letter spacing, corner radius, borders and opacity. Load the fonts the design uses (Google Fonts or bundled files) so no fallback font is drawn. Build layouts with flex / auto layout (padding, gap, alignment from the "layout" data), not absolute offsets, so they still hold at other widths.
D. Implement every entry in "interactions" and "rootInteractions": ON_CLICK / ON_PRESS on the tagged element, AFTER_TIMEOUT on the screen; NAVIGATE / SWAP / OVERLAY open the destination screen, BACK goes back. Reproduce each transition's type, duration (durationMs) and easing (cubic-bezier values in "easing.bezier" where present) as a real animation of the screen container${rn ? ' (React Navigation animation options, or Animated / Reanimated)' : ' (CSS transitions or Web Animations / Framer Motion)'}.
E. Make the app build for the web: ${rn ? 'Expo with react-native-web (npx expo export --platform web must succeed; add react-dom, react-native-web and @expo/metro-runtime if missing) and React Navigation "linking" with one URL path per screen' : 'Vite (vite build must succeed) with one URL path per screen'}.
F. Write design-engineer.fidelity.json at the repository root, and commit it:
   { "version": 1, "appRoot": "<folder with the app's package.json, '.' when at the root>", "screens": [ { "name": "<screen name exactly as above>", "rootId": "<root node id>", "route": "/<path that opens this screen directly>" } ] }`;
}

module.exports = { runFidelity, checkWithRepair, validReferencePng, promptContract, target, enabled, report, DEFAULT_TARGET };
