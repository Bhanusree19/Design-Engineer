'use strict';
// Analyses rAF samples taken during a prototype transition and compares the
// measured duration and easing curve against the Figma transition.
const { normalizeEasing, cubicBezier } = require('./easing');

const CHANNELS = ['x', 'y', 'w', 'o'];

/**
 * Picks the element + channel that moved most, then finds when the motion
 * started and settled. Returns null when nothing moved.
 */
function analyzeSamples(frames, { viewport = { width: 390, height: 844 } } = {}) {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const selectors = new Set();
  for (const f of frames) for (const k of Object.keys(f.items || {})) selectors.add(k);
  let best = null;
  for (const sel of selectors) {
    const series = frames.filter((f) => f.items && f.items[sel]).map((f) => ({ t: f.t, ...f.items[sel] }));
    if (series.length < 2) continue;
    for (const ch of CHANNELS) {
      const vals = series.map((s) => s[ch]);
      const range = Math.max(...vals) - Math.min(...vals);
      const norm = ch === 'o' ? range : ch === 'x' || ch === 'w' ? range / viewport.width : range / viewport.height;
      if (!best || norm > best.norm) best = { sel, ch, series, norm };
    }
  }
  // A target that only appears (no in-between frames) counts as instant.
  if (!best || best.norm < 0.01) return { moved: false, durationMs: 0 };
  const { series, ch } = best;
  const end = series[series.length - 1][ch];
  const start = series[0][ch];
  const range = end - start;
  if (Math.abs(range) < 1e-6) return { moved: false, durationMs: 0 };
  const eps = Math.abs(range) * 0.02;
  let i0 = series.findIndex((s) => Math.abs(s[ch] - start) > eps);
  if (i0 < 0) return { moved: false, durationMs: 0 };
  i0 = Math.max(0, i0 - 1);
  let i1 = series.length - 1;
  for (let i = series.length - 1; i >= i0; i--) {
    if (Math.abs(series[i][ch] - end) > eps) { i1 = Math.min(series.length - 1, i + 1); break; }
  }
  const t0 = series[i0].t;
  const t1 = series[i1].t;
  const durationMs = Math.max(0, t1 - t0);
  const curve = series.slice(i0, i1 + 1).map((s) => ({
    x: durationMs ? (s.t - t0) / durationMs : 1,
    y: (s[ch] - start) / range,
  }));
  return { moved: true, durationMs, channel: ch, selector: best.sel, curve };
}

function linear(v, full, zero) {
  if (v <= full) return 1;
  if (v >= zero) return 0;
  return 1 - (v - full) / (zero - full);
}

/**
 * Scores one measured transition. 60% duration accuracy, 40% curve shape
 * (spring easings are scored on duration only).
 */
function scoreTransition(expected, measured) {
  const durationMs = expected.durationMs || 300;
  if (!measured || !measured.moved) {
    return { score: 0, durationScore: 0, curveScore: 0, measuredMs: 0, expectedMs: durationMs,
      message: `No animation: expected ${expected.type.toLowerCase().replace(/_/g, ' ')} over ${Math.round(durationMs)} ms, the screen changed instantly.` };
  }
  const err = Math.abs(measured.durationMs - durationMs) / durationMs;
  const durationScore = linear(err, 0.2, 1);
  const n = normalizeEasing(expected.easing);
  let curveScore = null, rmse = null;
  if (n.bezier && measured.curve && measured.curve.length >= 3) {
    const f = cubicBezier(...n.bezier);
    const sq = measured.curve.map((p) => (p.y - f(p.x)) ** 2);
    rmse = Math.sqrt(sq.reduce((a, b) => a + b, 0) / sq.length);
    curveScore = linear(rmse, 0.06, 0.35);
  }
  const score = curveScore == null ? durationScore : 0.6 * durationScore + 0.4 * curveScore;
  const parts = [];
  if (durationScore < 0.95) parts.push(`took ${Math.round(measured.durationMs)} ms instead of ${Math.round(durationMs)} ms`);
  if (curveScore != null && curveScore < 0.8) parts.push(`easing doesn't follow ${n.type.toLowerCase().replace(/_/g, ' ')}`);
  return {
    score, durationScore, curveScore, rmse, measuredMs: Math.round(measured.durationMs), expectedMs: Math.round(durationMs),
    message: parts.length ? `Transition ${parts.join(' and ')}.` : null,
  };
}

module.exports = { analyzeSamples, scoreTransition };
