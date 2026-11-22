'use strict';
// Functions that run INSIDE the rendered page (passed to page.evaluate).
// Each must be self-contained: Playwright serialises the function source.

/* eslint-disable no-undef */

/**
 * Reads every element tagged with a Figma node ID (`data-fid="12:34"` on the
 * web, `testID="fid:12:34"` in React Native, which react-native-web renders as
 * data-testid) and returns its box and computed styles.
 */
function measureTagged({ families = [] } = {}) {
  const idOf = (el) => el.getAttribute('data-fid') || (el.getAttribute('data-testid') || '').replace(/^fid:/, '');
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const px = (v, basis) => {
    if (!v) return 0;
    if (String(v).endsWith('%')) return (parseFloat(v) / 100) * basis;
    return parseFloat(v) || 0;
  };
  const out = {};
  const nodes = document.querySelectorAll('[data-fid],[data-testid^="fid:"]');
  for (const el of nodes) {
    const id = idOf(el);
    if (!id || out[id]) continue; // document order: the outermost tag wins
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity || '1');

    // Text: style comes from the element that owns the first text node.
    let textEl = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.textContent && t.textContent.trim()) { textEl = t.parentElement; break; }
    }
    const ts = getComputedStyle(textEl || el);
    let textBox = null;
    if (textEl) {
      // Figma's text box is (lines × line height) tall; a DOM range is only
      // as tall as the glyphs. Rebuild the line boxes from the line height.
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
      if (tr.width > 0 && tr.height > 0 && rects.length) {
        const fs = parseFloat(ts.fontSize) || 16;
        const lh = ts.lineHeight === 'normal' ? fs * 1.2 : parseFloat(ts.lineHeight) || fs * 1.2;
        const tops = [];
        for (const q of rects) if (!tops.some((t) => Math.abs(t - q.top) < lh / 2)) tops.push(q.top);
        const glyph = rects[0].height;
        textBox = { x: tr.left + scrollX, y: Math.min(...tops) - (lh - glyph) / 2 + scrollY, w: tr.width, h: tops.length * lh };
      }
    }

    // Background: the tagged element, else a same-size descendant painting it.
    let bg = cs.backgroundColor;
    if (transparent(bg)) {
      for (const child of el.querySelectorAll('*')) {
        const cr = child.getBoundingClientRect();
        if (Math.abs(cr.width - r.width) <= 1.5 && Math.abs(cr.height - r.height) <= 1.5) {
          const cbg = getComputedStyle(child).backgroundColor;
          if (!transparent(cbg)) { bg = cbg; break; }
        } else break;
      }
    }
    const minSide = Math.min(r.width, r.height);
    out[id] = {
      x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height,
      visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0 && opacity > 0.01,
      tag: el.tagName.toLowerCase(),
      text: textEl ? (el.innerText || el.textContent || '').trim().slice(0, 400) : '',
      textBox,
      href: el.closest('a') ? el.closest('a').href : null,
      style: {
        backgroundColor: bg,
        hasBackgroundImage: cs.backgroundImage && cs.backgroundImage !== 'none',
        color: ts.color,
        fontSize: parseFloat(ts.fontSize) || null,
        fontWeight: parseInt(ts.fontWeight, 10) || null,
        lineHeight: ts.lineHeight === 'normal' ? null : parseFloat(ts.lineHeight) || null,
        letterSpacing: ts.letterSpacing === 'normal' ? 0 : parseFloat(ts.letterSpacing) || 0,
        fontFamily: ts.fontFamily || '',
        radius: px(cs.borderTopLeftRadius, minSide),
        borderColor: cs.borderTopColor,
        borderWidth: parseFloat(cs.borderTopWidth) || 0,
        opacity,
      },
    };
  }

  // Width probe: a family is available when text in it measures differently
  // from both generic fallbacks.
  const fonts = {};
  const canvas = document.createElement('canvas').getContext('2d');
  const sample = 'mmmmmmmmmmlliWW@#0123';
  for (const fam of families) {
    let available = false;
    for (const generic of ['monospace', 'serif', 'sans-serif']) {
      canvas.font = `40px ${generic}`;
      const base = canvas.measureText(sample).width;
      canvas.font = `40px "${fam}", ${generic}`;
      if (Math.abs(canvas.measureText(sample).width - base) > 0.5) { available = true; break; }
    }
    fonts[fam] = available;
  }
  const se = document.scrollingElement || document.documentElement;
  return { elements: out, fonts, scrollWidth: se.scrollWidth, scrollHeight: se.scrollHeight, innerWidth, innerHeight };
}

/**
 * Starts a requestAnimationFrame sampler recording the box and effective
 * opacity of the given selectors until window.__deStop is set (max 6 s).
 */
function startSampler({ selectors }) {
  window.__deSamples = [];
  window.__deStop = false;
  const t0 = performance.now();
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1'); return o; };
  const tick = () => {
    const now = performance.now();
    const frame = { t: now - t0, items: {} };
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      frame.items[sel] = { x: r.left, y: r.top, w: r.width, h: r.height, o: eff(el) };
    }
    window.__deSamples.push(frame);
    if (!window.__deStop && now - t0 < 6000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}

function stopSampler() {
  window.__deStop = true;
  return window.__deSamples || [];
}

/** Selectors for a node ID under both tagging conventions. */
function fidSelector(id) {
  const v = String(id).replace(/["\\]/g, '\\$&');
  return `[data-fid="${v}"],[data-testid="fid:${v}"]`;
}

module.exports = { measureTagged, startSampler, stopSampler, fidSelector };
