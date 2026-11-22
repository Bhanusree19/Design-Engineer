'use strict';
// Figma prototype easings as cubic-bezier curves, and curve evaluation.

const PRESETS = Object.freeze({
  LINEAR: [0, 0, 1, 1],
  EASE_IN: [0.42, 0, 1, 1],
  EASE_OUT: [0, 0, 0.58, 1],
  EASE_IN_AND_OUT: [0.42, 0, 0.58, 1],
  EASE_IN_BACK: [0.3, -0.05, 0.7, -0.5],
  EASE_OUT_BACK: [0.45, 1.45, 0.8, 1],
  EASE_IN_AND_OUT_BACK: [0.7, -0.4, 0.4, 1.4],
});

const SPRINGS = new Set(['GENTLE', 'QUICK', 'BOUNCY', 'SLOW', 'CUSTOM_SPRING']);

/** Normalise a Figma easing object to { type, bezier|null, spring }. */
function normalizeEasing(easing) {
  const type = easing && typeof easing.type === 'string' ? easing.type : 'LINEAR';
  if (type === 'CUSTOM_CUBIC_BEZIER' && easing.easingFunctionCubicBezier) {
    const f = easing.easingFunctionCubicBezier;
    return { type, bezier: [f.x1, f.y1, f.x2, f.y2].map(Number), spring: false };
  }
  if (Array.isArray(easing?.bezier) && easing.bezier.length === 4) {
    return { type, bezier: easing.bezier.map(Number), spring: false };
  }
  if (SPRINGS.has(type)) return { type, bezier: null, spring: true };
  return { type, bezier: PRESETS[type] || PRESETS.LINEAR, spring: false };
}

/** Returns y(x) for a cubic-bezier(x1,y1,x2,y2), x in 0..1 (Newton + bisection, like browsers). */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  function solve(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

function easingFunction(easing) {
  const n = normalizeEasing(easing);
  if (!n.bezier) return null;
  return cubicBezier(...n.bezier);
}

module.exports = { PRESETS, normalizeEasing, cubicBezier, easingFunction };
