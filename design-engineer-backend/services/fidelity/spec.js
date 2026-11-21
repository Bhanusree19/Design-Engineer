'use strict';
// Turns a saved Design Context (v2 or v3) into a scoring spec: which Figma
// nodes must appear in the rendered page, where, with which styles, and which
// prototype interactions / transitions must work.

const VECTOR_TYPES = new Set(['vector', 'boolean_operation', 'star', 'line', 'regular_polygon', 'ellipse_vector']);
const CLICK_TRIGGERS = new Set(['ON_CLICK', 'ON_PRESS', 'ON_TAP', 'MOUSE_UP', 'MOUSE_DOWN']);

function screenOf(content) {
  if (content && typeof content === 'object' && content.screen && typeof content.screen === 'object') return content.screen;
  return content && typeof content === 'object' ? content : null;
}

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

function slug(value) {
  return String(value || 'screen').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'screen';
}

function normalizeTransition(t) {
  if (!t || typeof t !== 'object' || !t.type || t.type === 'INSTANT') return null;
  const durationMs = num(t.durationMs) ?? (num(t.duration) != null ? t.duration * 1000 : undefined);
  return { type: t.type, durationMs: durationMs ?? 300, easing: t.easing || { type: 'EASE_OUT' }, direction: t.direction || null };
}

function normalizeInteraction(raw, sourceId) {
  if (!raw || typeof raw !== 'object') return null;
  const trigger = typeof raw.trigger === 'string' ? raw.trigger : raw.trigger?.type;
  const action = typeof raw.action === 'string' ? raw.action : null;
  if (!trigger || !action) return null;
  return {
    sourceId,
    trigger,
    timeoutMs: num(raw.timeoutMs) ?? null,
    action,
    destinationId: typeof raw.destinationId === 'string' ? raw.destinationId : null,
    destinationName: typeof raw.destinationName === 'string' ? raw.destinationName : null,
    url: typeof raw.url === 'string' ? raw.url : null,
    transition: normalizeTransition(raw.transition),
  };
}

/**
 * @param {object} content saved design_contexts.content (or the bare screen)
 * @param {string} fallbackName
 */
function buildSpec(content, fallbackName = 'screen') {
  const ctx = screenOf(content);
  if (!ctx) throw new Error('Design context is empty');
  const elementsIn = Array.isArray(ctx.elements) ? ctx.elements : [];
  const width = Math.round(num(ctx.width) || 0);
  const height = Math.round(num(ctx.height) || 0);
  let origin = ctx.origin && num(ctx.origin.x) != null ? { x: ctx.origin.x, y: ctx.origin.y } : null;
  const originEstimated = !origin;
  if (!origin) {
    // v2 contexts carry absolute canvas positions without the frame origin.
    // The frame's background layers start at its corner, so the minimum is a
    // good estimate. Flagged so the report can recommend fetching again.
    const xs = elementsIn.map((e) => e.x).filter((v) => typeof v === 'number');
    const ys = elementsIn.map((e) => e.y).filter((v) => typeof v === 'number');
    origin = { x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.min(...ys) : 0 };
  }

  const byId = new Map(elementsIn.map((e) => [e.id, e]));
  const hidden = new Set();
  for (const e of elementsIn) {
    if (e.visible === false || e.opacity === 0) hidden.add(e.id);
  }
  const ancestors = (e) => {
    const out = [];
    let p = e.parentId ? byId.get(e.parentId) : null;
    let guard = 0;
    while (p && guard++ < 200) { out.push(p); p = p.parentId ? byId.get(p.parentId) : null; }
    return out;
  };

  const elements = [];
  const interactions = [];
  for (const e of elementsIn) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    const type = String(e.type || '').toLowerCase();
    for (const raw of Array.isArray(e.interactions) ? e.interactions : []) {
      const it = normalizeInteraction(raw, e.id);
      if (it) interactions.push({ ...it, sourceName: e.name || e.id });
    }
    const anc = ancestors(e);
    if (hidden.has(e.id) || anc.some((a) => hidden.has(a.id))) continue;
    const box = { x: (e.x || 0) - origin.x, y: (e.y || 0) - origin.y, w: e.width || 0, h: e.height || 0 };
    if (box.w < 1 || box.h < 1) continue;
    // Off-frame or clipped-away nodes can't be seen, so they aren't scored.
    if (width && height && (box.x >= width || box.y >= height || box.x + box.w <= 0 || box.y + box.h <= 0)) continue;
    const inInstance = anc.some((a) => String(a.type).toLowerCase() === 'instance');
    const isText = type === 'text';
    // Inside a component instance only its text labels are checked; the
    // instance itself is checked as one box. Icon internals are skipped.
    if (inInstance && !isText) continue;
    if (VECTOR_TYPES.has(type) && anc.some((a) => (a.width || 0) <= 64 && (a.height || 0) <= 64)) continue;
    if (type === 'group' && !(e.colors?.length) && !e.interactions?.length) continue;

    const expect = {};
    const first = Array.isArray(e.colors) && e.colors.length ? e.colors[0] : null;
    if (isText) {
      if (first) expect.color = first;
      if (num(e.fontSize) != null) expect.fontSize = e.fontSize;
      const weight = num(e.fontWeight) ?? (e.fontStyle && /^\d+$/.test(String(e.fontStyle)) ? Number(e.fontStyle) : undefined);
      if (weight != null) expect.fontWeight = weight;
      if (num(e.lineHeightPx) != null) expect.lineHeight = e.lineHeightPx;
      if (num(e.letterSpacing) != null) expect.letterSpacing = e.letterSpacing;
      if (typeof e.fontFamily === 'string' && e.fontFamily) expect.fontFamily = e.fontFamily;
    } else {
      if (first && !e.isImage) expect.fill = first;
      if (num(e.radius) != null && e.radius > 0) expect.radius = e.radius;
      if (Array.isArray(e.strokeColors) && e.strokeColors.length && num(e.strokeWeight) > 0) {
        expect.strokeColor = e.strokeColors[0];
        expect.strokeWidth = e.strokeWeight;
      }
    }
    if (num(e.opacity) != null && e.opacity < 1) expect.opacity = e.opacity;

    elements.push({
      id: e.id,
      name: e.name || e.id,
      type,
      box,
      text: isText ? (typeof e.text === 'string' ? e.text : '') : undefined,
      textAlign: e.textAlign || null,
      textAutoResize: e.textAutoResize || null,
      isImage: !!e.isImage,
      expect,
      weight: isText ? 1.2 : type === 'instance' ? 1.2 : 1,
    });
  }
  for (const raw of Array.isArray(ctx.rootInteractions) ? ctx.rootInteractions : []) {
    const it = normalizeInteraction(raw, ctx.rootId || null);
    if (it) interactions.push({ ...it, sourceName: ctx.screen || fallbackName });
  }

  return {
    name: ctx.screen || fallbackName,
    slug: slug(ctx.screen || fallbackName),
    rootId: typeof ctx.rootId === 'string' ? ctx.rootId : null,
    width,
    height,
    background: Array.isArray(ctx.rootColors) && ctx.rootColors[0] ? ctx.rootColors[0] : null,
    version: String(ctx.version || content?.contextVersion || '2.0'),
    originEstimated,
    elements,
    interactions,
  };
}

function isClickTrigger(trigger) { return CLICK_TRIGGERS.has(trigger); }

module.exports = { buildSpec, slug, isClickTrigger, screenOf, normalizeTransition };
