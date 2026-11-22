'use strict';
// Scoring: compares the spec (what Figma says) with what the browser rendered.
// All layer scores are 0..1; the reported fidelity score is 0..100.
const { deltaE } = require('./color');

const WEIGHTS = Object.freeze({ geometry: 30, visual: 20, style: 15, interaction: 15, motion: 10, responsive: 10 });

function linear(v, full, zero) {
  if (!Number.isFinite(v)) return 0;
  if (v <= full) return 1;
  if (v >= zero) return 0;
  return 1 - (v - full) / (zero - full);
}

function round(v, d = 1) { const f = 10 ** d; return Math.round(v * f) / f; }

/** Which DOM box stands for a Figma text node, given how the text resizes. */
function boxesFor(el, m) {
  if (el.type !== 'text' || !m.textBox) return { x: m, y: m, w: m, h: m };
  const hug = el.textAutoResize === 'WIDTH_AND_HEIGHT';
  const aligned = !el.textAlign || el.textAlign === 'LEFT';
  return {
    x: hug || aligned ? m.textBox : m,
    w: hug ? m.textBox : m,
    y: m.textBox,
    h: m.textBox,
  };
}

function geometryOf(el, m) {
  const b = boxesFor(el, m);
  const dx = b.x.x - el.box.x;
  const dy = b.y.y - el.box.y;
  const dw = b.w.w - el.box.w;
  const dh = b.h.h - el.box.h;
  const posErr = Math.max(Math.abs(dx), Math.abs(dy));
  const relW = Math.abs(dw) / Math.max(el.box.w, 8);
  const relH = Math.abs(dh) / Math.max(el.box.h, 8);
  const sizeErrPx = Math.max(Math.abs(dw), Math.abs(dh));
  const sizeScore = sizeErrPx <= 2 ? 1 : linear(Math.max(relW, relH), 0.03, 0.35);
  const posScore = linear(posErr, 2, 24);
  return { score: 0.6 * posScore + 0.4 * sizeScore, dx, dy, dw, dh, posErr, sizeErrPx };
}

function familyName(cssList) {
  return String(cssList || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function styleOf(el, m, fonts) {
  const s = m.style || {};
  const checks = [];
  const add = (prop, score, expected, actual, message) => checks.push({ prop, score, expected, actual, message });
  const e = el.expect;
  if (e.fill) {
    const actual = s.backgroundColor;
    const d = deltaE(e.fill, actual);
    const painted = actual && !/^rgba\([^)]*,\s*0\)$/.test(actual) && actual !== 'transparent';
    const sc = !painted ? (s.hasBackgroundImage ? 0.5 : 0) : linear(d ?? 99, 2.5, 25);
    add('fill', sc, e.fill, actual, sc < 0.9 ? (painted ? `Fill is ${actual}, Figma has ${e.fill}` : `Missing fill ${e.fill}`) : null);
  }
  if (e.color) {
    const d = deltaE(e.color, s.color);
    const sc = linear(d ?? 99, 2.5, 25);
    add('color', sc, e.color, s.color, sc < 0.9 ? `Text colour is ${s.color}, Figma has ${e.color}` : null);
  }
  if (e.fontSize != null && s.fontSize != null) {
    const sc = linear(Math.abs(s.fontSize - e.fontSize), 0.5, 4);
    add('fontSize', sc, e.fontSize, s.fontSize, sc < 0.9 ? `Font size ${round(s.fontSize)} px, Figma has ${round(e.fontSize)} px` : null);
  }
  if (e.fontWeight != null && s.fontWeight != null) {
    const d = Math.abs(s.fontWeight - e.fontWeight);
    const sc = d === 0 ? 1 : d <= 100 ? 0.5 : 0;
    add('fontWeight', sc, e.fontWeight, s.fontWeight, sc < 1 ? `Font weight ${s.fontWeight}, Figma has ${e.fontWeight}` : null);
  }
  if (e.lineHeight != null) {
    const actual = s.lineHeight ?? (s.fontSize ? s.fontSize * 1.2 : null);
    if (actual != null) {
      const sc = linear(Math.abs(actual - e.lineHeight), 1, 8);
      add('lineHeight', sc, e.lineHeight, actual, sc < 0.9 ? `Line height ${round(actual)} px, Figma has ${round(e.lineHeight)} px` : null);
    }
  }
  if (e.letterSpacing != null) {
    const sc = linear(Math.abs((s.letterSpacing || 0) - e.letterSpacing), 0.3, 2);
    add('letterSpacing', sc, e.letterSpacing, s.letterSpacing, sc < 0.9 ? `Letter spacing ${round(s.letterSpacing || 0, 2)} px, Figma has ${round(e.letterSpacing, 2)} px` : null);
  }
  if (e.fontFamily) {
    const want = e.fontFamily.toLowerCase();
    const named = familyName(s.fontFamily) === want || String(s.fontFamily).toLowerCase().includes(want);
    const loaded = fonts ? fonts[e.fontFamily] !== false : true;
    const sc = named && loaded ? 1 : named ? 0.4 : 0;
    add('fontFamily', sc, e.fontFamily, s.fontFamily,
      sc < 1 ? (named ? `Font "${e.fontFamily}" is set but didn't load, so a fallback font is drawn` : `Font is ${familyName(s.fontFamily) || 'unset'}, Figma uses "${e.fontFamily}"`) : null);
  }
  if (e.radius != null) {
    const sc = linear(Math.abs((s.radius || 0) - e.radius), 1, 8);
    add('radius', sc, e.radius, s.radius, sc < 0.9 ? `Corner radius ${round(s.radius || 0)} px, Figma has ${round(e.radius)} px` : null);
  }
  if (e.strokeColor) {
    const d = s.borderWidth > 0 ? deltaE(e.strokeColor, s.borderColor) : null;
    const colorScore = d == null ? 0 : linear(d, 2.5, 25);
    const widthScore = linear(Math.abs((s.borderWidth || 0) - e.strokeWidth), 0.5, 3);
    const sc = 0.5 * colorScore + 0.5 * widthScore;
    add('stroke', sc, `${e.strokeWidth}px ${e.strokeColor}`, `${s.borderWidth || 0}px ${s.borderColor}`,
      sc < 0.9 ? `Border is ${s.borderWidth || 0} px ${s.borderColor}, Figma has ${e.strokeWidth} px ${e.strokeColor}` : null);
  }
  if (e.opacity != null) {
    const sc = linear(Math.abs((s.opacity ?? 1) - e.opacity), 0.03, 0.4);
    add('opacity', sc, e.opacity, s.opacity, sc < 0.9 ? `Opacity ${round(s.opacity ?? 1, 2)}, Figma has ${round(e.opacity, 2)}` : null);
  }
  const score = checks.length ? checks.reduce((a, c) => a + c.score, 0) / checks.length : null;
  return { score, checks };
}

function textMatches(expected, actual) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const a = norm(expected), b = norm(actual);
  if (!a) return true;
  return b.includes(a) || a.includes(b) && b.length >= a.length * 0.8;
}

/**
 * @param spec      buildSpec() output
 * @param measured  measureTagged() output (positions relative to the page)
 * @param offset    {x,y} of the screen root in the page (0,0 when the screen fills the viewport)
 */
function scoreScreen(spec, measured, { offset = { x: 0, y: 0 } } = {}) {
  const issues = [];
  const elements = [];
  let geoSum = 0, geoWeight = 0, styleSum = 0, styleWeight = 0, matched = 0;
  const all = measured?.elements || {};
  for (const el of spec.elements) {
    const raw = all[el.id];
    geoWeight += el.weight;
    if (!raw || !raw.visible) {
      issues.push({ screen: spec.name, nodeId: el.id, nodeName: el.name, kind: 'missing', impact: el.weight * 1.0,
        message: raw ? `"${el.name}" is tagged but not visible` : `"${el.name}" (${el.id}) isn't in the page, or isn't tagged with its node ID` });
      elements.push({ id: el.id, name: el.name, status: 'missing' });
      continue;
    }
    matched++;
    const m = { ...raw, x: raw.x - offset.x, y: raw.y - offset.y,
      textBox: raw.textBox ? { ...raw.textBox, x: raw.textBox.x - offset.x, y: raw.textBox.y - offset.y } : null };
    const g = geometryOf(el, m);
    geoSum += g.score * el.weight;
    if (g.score < 0.9) {
      const parts = [];
      if (Math.abs(g.dx) > 2) parts.push(`${Math.abs(Math.round(g.dx))} px too far ${g.dx > 0 ? 'right' : 'left'}`);
      if (Math.abs(g.dy) > 2) parts.push(`${Math.abs(Math.round(g.dy))} px too ${g.dy > 0 ? 'low' : 'high'}`);
      if (Math.abs(g.dw) > 2) parts.push(`${Math.abs(Math.round(g.dw))} px too ${g.dw > 0 ? 'wide' : 'narrow'}`);
      if (Math.abs(g.dh) > 2) parts.push(`${Math.abs(Math.round(g.dh))} px too ${g.dh > 0 ? 'tall' : 'short'}`);
      issues.push({ screen: spec.name, nodeId: el.id, nodeName: el.name, kind: 'geometry', impact: (1 - g.score) * el.weight,
        message: `"${el.name}" is ${parts.join(', ')} (Figma x ${Math.round(el.box.x)}, y ${Math.round(el.box.y)}, ${Math.round(el.box.w)}×${Math.round(el.box.h)})` });
    }
    const st = styleOf(el, m, measured.fonts);
    if (st.score != null) {
      styleSum += st.score * el.weight;
      styleWeight += el.weight;
      for (const c of st.checks) {
        if (c.message) issues.push({ screen: spec.name, nodeId: el.id, nodeName: el.name, kind: 'style', prop: c.prop,
          impact: (1 - c.score) * el.weight * 0.6, message: `"${el.name}": ${c.message}` });
      }
    }
    if (el.type === 'text' && el.text && !textMatches(el.text, raw.text)) {
      issues.push({ screen: spec.name, nodeId: el.id, nodeName: el.name, kind: 'content', impact: 0.5,
        message: `"${el.name}" shows "${String(raw.text).slice(0, 60)}", Figma text is "${el.text.slice(0, 60)}"` });
    }
    elements.push({ id: el.id, name: el.name, status: 'matched', geometry: round(g.score, 3), style: st.score == null ? null : round(st.score, 3) });
  }
  const total = spec.elements.length;
  return {
    coverage: total ? matched / total : 1,
    matched,
    total,
    geometry: geoWeight ? geoSum / geoWeight : 1,
    style: styleWeight ? styleSum / styleWeight : null,
    elements,
    issues,
  };
}

/**
 * Content SSIM (blocks that have something on them) 0.92+ → 1, 0.45 → 0.
 * A different rasteriser on the same design measured 0.995; Figma's text
 * rendering differs more than Chrome's own 2× downsample, hence the margin.
 */
function visualScore(ssimValue) { return linear(1 - ssimValue, 0.08, 0.55); }

function grade(score) {
  if (score >= 95) return 'exact';
  if (score >= 85) return 'close';
  if (score >= 70) return 'needs-work';
  return 'off';
}

/** Weighted mean over the layers that were measured. */
function combine(layers) {
  let sum = 0, w = 0;
  for (const [k, weight] of Object.entries(WEIGHTS)) {
    const v = layers[k];
    if (v == null || !Number.isFinite(v)) continue;
    sum += v * weight; w += weight;
  }
  return w ? Math.round((sum / w) * 1000) / 10 : 0;
}

function mean(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

module.exports = { WEIGHTS, scoreScreen, visualScore, combine, grade, mean, geometryOf, styleOf, linear, round };
