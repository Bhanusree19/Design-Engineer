// src/figma/parser.ts

import {
  ExtractedScreen,
  FigmaRestNode,
} from './extractor';

export interface DesignTransition {
  type: string;

  durationMs: number;

  easing: {
    type: string;
    bezier?: [number, number, number, number];
  };

  direction?: string;
}

export interface DesignInteraction {
  trigger: string;

  timeoutMs?: number;

  action: string;

  destinationId?: string;

  destinationName?: string;

  url?: string;

  transition: DesignTransition | null;
}

export interface DesignElement {
  id: string;

  parentId?: string;

  visible?: boolean;

  type: string;

  name: string;

  x: number;

  y: number;

  width: number;

  height: number;

  text?: string;

  fontSize?: number;

  fontFamily?: string;

  fontStyle?: string;

  fontWeight?: number;

  lineHeightPx?: number;

  letterSpacing?: number;

  textAlign?: string;

  textAutoResize?: string;

  textCase?: string;

  radius?: number;

  colors?: string[];

  strokeColors?: string[];

  strokeWeight?: number;

  opacity?: number;

  effects?: unknown[];

  isImage?: boolean;

  componentId?: string;

  layout?: {
    mode?: string;

    itemSpacing?: number;

    paddingLeft?: number;

    paddingRight?: number;

    paddingTop?: number;

    paddingBottom?: number;

    primaryAxisAlign?: string;

    counterAxisAlign?: string;
  };

  interactions?: DesignInteraction[];
}

export interface DesignContext {
  version: string;

  screen: string;

  /** Figma node ID of the screen frame; generated code tags its root with it. */
  rootId?: string;

  /** Canvas position of the frame, so element positions can be made relative. */
  origin?: { x: number; y: number };

  rootColors?: string[];

  rootInteractions?: DesignInteraction[];

  /** Figma export of the frame, used by the fidelity check. Never shown to the coding agent. */
  fidelityReference?: { pngBase64: string; scale: number };

  width: number;

  height: number;

  page: {
    id: string;

    name: string;
  };

  summary: ExtractedScreen['summary'];

  extractionTimeMs: number;

  elements: DesignElement[];
}

/**
 * Convert Figma color object to hex.
 */
function colorToHex(
  color: any
): string | undefined {
  if (!color) {
    return undefined;
  }

  if (
    typeof color.r !== 'number' ||
    typeof color.g !== 'number' ||
    typeof color.b !== 'number'
  ) {
    return undefined;
  }

  const toHex = (value: number) =>
    Math.round(
      Math.max(
        0,
        Math.min(1, value)
      ) * 255
    )
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(color.r)}${toHex(
    color.g
  )}${toHex(color.b)}`;
}

/**
 * Extract colors from paints.
 */
function extractColors(
  paints: any
): {
  colors: string[];
  isImage: boolean;
} {
  const colors: string[] = [];

  let isImage = false;

  if (!Array.isArray(paints)) {
    return {
      colors,
      isImage,
    };
  }

  for (const paint of paints) {
    if (
      !paint ||
      paint.visible === false
    ) {
      continue;
    }

    if (
      paint.type === 'SOLID'
    ) {
      const color =
        colorToHex(paint.color);

      if (color) {
        colors.push(color);
      }

      continue;
    }

    if (
      paint.type === 'IMAGE'
    ) {
      isImage = true;
      continue;
    }

    if (
      paint.type ===
        'GRADIENT_LINEAR' ||
      paint.type ===
        'GRADIENT_RADIAL' ||
      paint.type ===
        'GRADIENT_ANGULAR' ||
      paint.type ===
        'GRADIENT_DIAMOND'
    ) {
      if (
        Array.isArray(
          paint.gradientStops
        )
      ) {
        for (
          const stop of paint.gradientStops
        ) {
          const color =
            colorToHex(
              stop.color
            );

          if (color) {
            colors.push(color);
          }
        }
      }
    }
  }

  return {
    colors,
    isImage,
  };
}

const EASING_PRESETS: Record<string, [number, number, number, number]> = {
  LINEAR: [0, 0, 1, 1],
  EASE_IN: [0.42, 0, 1, 1],
  EASE_OUT: [0, 0, 0.58, 1],
  EASE_IN_AND_OUT: [0.42, 0, 0.58, 1],
  EASE_IN_BACK: [0.3, -0.05, 0.7, -0.5],
  EASE_OUT_BACK: [0.45, 1.45, 0.8, 1],
  EASE_IN_AND_OUT_BACK: [0.7, -0.4, 0.4, 1.4],
};

/** Figma gives transition durations in seconds (legacy fields in ms). */
function toMs(value: unknown, legacyMs = false): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (legacyMs || value > 20) return Math.round(value);
  return Math.round(value * 1000);
}

function convertEasing(easing: any): DesignTransition['easing'] {
  const type = typeof easing?.type === 'string' ? easing.type : 'EASE_OUT';
  const f = easing?.easingFunctionCubicBezier;
  if (f && [f.x1, f.y1, f.x2, f.y2].every((v: unknown) => typeof v === 'number')) {
    return { type, bezier: [f.x1, f.y1, f.x2, f.y2] };
  }
  return EASING_PRESETS[type] ? { type, bezier: EASING_PRESETS[type] } : { type };
}

function convertTransition(t: any, legacyMs = false): DesignTransition | null {
  if (!t || typeof t !== 'object' || typeof t.type !== 'string' || t.type === 'INSTANT') return null;
  return {
    type: t.type,
    durationMs: toMs(t.duration, legacyMs) ?? 300,
    easing: convertEasing(t.easing),
    ...(typeof t.direction === 'string' ? { direction: t.direction } : {}),
  };
}

/**
 * Prototype interactions from the REST JSON: trigger, what happens, and the
 * transition. Falls back to the legacy transitionNodeID fields.
 */
export function extractInteractions(node: FigmaRestNode): DesignInteraction[] {
  const out: DesignInteraction[] = [];
  if (Array.isArray(node.interactions)) {
    for (const interaction of node.interactions) {
      const trigger = interaction?.trigger?.type;
      if (typeof trigger !== 'string') continue;
      const timeoutMs = trigger === 'AFTER_TIMEOUT' ? toMs(interaction.trigger.timeout) : undefined;
      const actions = Array.isArray(interaction.actions) ? interaction.actions : interaction.action ? [interaction.action] : [];
      for (const a of actions) {
        if (!a || typeof a.type !== 'string') continue;
        const base = { trigger, ...(timeoutMs != null ? { timeoutMs } : {}) };
        if (a.type === 'NODE' && typeof a.destinationId === 'string') {
          out.push({ ...base, action: typeof a.navigation === 'string' ? a.navigation : 'NAVIGATE',
            destinationId: a.destinationId, transition: convertTransition(a.transition) });
        } else if (a.type === 'BACK' || a.type === 'CLOSE') {
          out.push({ ...base, action: a.type, transition: null });
        } else if (a.type === 'URL' && typeof a.url === 'string') {
          out.push({ ...base, action: 'URL', url: a.url, transition: null });
        }
      }
    }
  }
  if (!out.length && typeof node.transitionNodeID === 'string' && node.transitionNodeID) {
    out.push({
      trigger: 'ON_CLICK',
      action: 'NAVIGATE',
      destinationId: node.transitionNodeID,
      transition: typeof node.transitionDuration === 'number'
        ? { type: 'DISSOLVE', durationMs: toMs(node.transitionDuration, true) ?? 300, easing: convertEasing({ type: node.transitionEasing }) }
        : null,
    });
  }
  return out;
}

/**
 * Convert one raw Figma JSON node to our normalized element.
 */
function convertNode(
  node: FigmaRestNode,
  parentId?: string
): DesignElement {
  const fills =
    extractColors(node.fills);

  const strokes =
    extractColors(node.strokes);

  const box =
    node.absoluteBoundingBox;

  const element: DesignElement = {
    id:
      typeof node.id === 'string'
        ? node.id
        : '',

    type:
      typeof node.type === 'string'
        ? node.type.toLowerCase()
        : 'unknown',

    name:
      typeof node.name === 'string'
        ? node.name
        : '',

    x:
      typeof box?.x === 'number'
        ? Math.round(box.x)
        : 0,

    y:
      typeof box?.y === 'number'
        ? Math.round(box.y)
        : 0,

    width:
      typeof box?.width === 'number'
        ? Math.round(box.width)
        : 0,

    height:
      typeof box?.height === 'number'
        ? Math.round(box.height)
        : 0,
  };

  if (parentId) {
    element.parentId = parentId;
  }

  if (node.visible === false) {
    element.visible = false;
  }

  const interactions = extractInteractions(node);
  if (interactions.length > 0) {
    element.interactions = interactions;
  }

  /**
   * Text.
   */
  if (
    node.type === 'TEXT'
  ) {
    if (
      typeof node.characters ===
      'string'
    ) {
      element.text =
        node.characters;
    }

    const style =
      node.style;

    if (style) {
      if (
        typeof style.fontSize ===
        'number'
      ) {
        element.fontSize =
          style.fontSize;
      }

      if (
        typeof style.fontFamily ===
        'string'
      ) {
        element.fontFamily =
          style.fontFamily;
      }

      if (
        typeof style.fontWeight ===
        'number'
      ) {
        element.fontStyle =
          String(
            style.fontWeight
          );

        element.fontWeight =
          style.fontWeight;
      }

      if (typeof style.lineHeightPx === 'number') {
        element.lineHeightPx = Math.round(style.lineHeightPx * 100) / 100;
      }

      if (typeof style.letterSpacing === 'number') {
        element.letterSpacing = Math.round(style.letterSpacing * 100) / 100;
      }

      if (typeof style.textAlignHorizontal === 'string') {
        element.textAlign = style.textAlignHorizontal;
      }

      if (typeof style.textAutoResize === 'string') {
        element.textAutoResize = style.textAutoResize;
      } else if (typeof node.textAutoResize === 'string') {
        element.textAutoResize = node.textAutoResize;
      }

      if (typeof style.textCase === 'string' && style.textCase !== 'ORIGINAL') {
        element.textCase = style.textCase;
      }
    }
  }

  /**
   * Fills.
   */
  if (
    fills.colors.length > 0
  ) {
    element.colors =
      fills.colors;
  }

  if (fills.isImage) {
    element.isImage = true;
  }

  /**
   * Strokes.
   */
  if (
    strokes.colors.length > 0
  ) {
    element.strokeColors =
      strokes.colors;
  }

  if (
    typeof node.strokeWeight ===
    'number'
  ) {
    element.strokeWeight =
      node.strokeWeight;
  }

  /**
   * Opacity.
   */
  if (
    typeof node.opacity ===
    'number'
  ) {
    element.opacity =
      node.opacity;
  }

  /**
   * Radius.
   */
  if (
    typeof node.cornerRadius ===
    'number'
  ) {
    element.radius =
      node.cornerRadius;
  }

  /**
   * Effects.
   */
  if (
    Array.isArray(
      node.effects
    ) &&
    node.effects.length > 0
  ) {
    element.effects =
      node.effects;
  }

  /**
   * Component.
   */
  if (
    node.type ===
      'COMPONENT' ||
    node.type ===
      'COMPONENT_SET'
  ) {
    element.componentId =
      node.id;
  }

  /**
   * Instance.
   */
  if (
    node.type === 'INSTANCE'
  ) {
    if (
      typeof node.mainComponent
        ?.id === 'string'
    ) {
      element.componentId =
        node.mainComponent.id;
    }
  }

  /**
   * Auto-layout.
   */
  if (
    typeof node.layoutMode ===
      'string' &&
    node.layoutMode !== 'NONE'
  ) {
    element.layout = {
      mode:
        node.layoutMode,

      itemSpacing:
        typeof node.itemSpacing ===
        'number'
          ? node.itemSpacing
          : undefined,

      paddingLeft:
        typeof node.paddingLeft ===
        'number'
          ? node.paddingLeft
          : undefined,

      paddingRight:
        typeof node.paddingRight ===
        'number'
          ? node.paddingRight
          : undefined,

      paddingTop:
        typeof node.paddingTop ===
        'number'
          ? node.paddingTop
          : undefined,

      paddingBottom:
        typeof node.paddingBottom ===
        'number'
          ? node.paddingBottom
          : undefined,

      primaryAxisAlign:
        node.primaryAxisAlignItems,

      counterAxisAlign:
        node.counterAxisAlignItems,
    };
  }

  return element;
}

/**
 * Flatten raw JSON tree.
 *
 * This does not access the Figma API.
 */
function flattenDocument(
  node: FigmaRestNode,
  output: DesignElement[],
  parentId?: string
) {
  if (
    !node ||
    typeof node !== 'object'
  ) {
    return;
  }

  if (
    node.type !== 'DOCUMENT' &&
    node.type !== 'CANVAS'
  ) {
    output.push(
      convertNode(node, parentId)
    );
  }

  const childParent =
    node.type !== 'DOCUMENT' && node.type !== 'CANVAS' && typeof node.id === 'string'
      ? node.id
      : parentId;

  if (
    Array.isArray(
      node.children
    )
  ) {
    for (
      const child of node.children
    ) {
      flattenDocument(
        child,
        output,
        childParent
      );
    }
  }
}

/**
 * Convert extracted screen to Design Context.
 */
export function toDesignContext(
  screen: ExtractedScreen
): DesignContext {
  const elements: DesignElement[] =
    [];

  const root =
    screen.document.document ||
    screen.document;

  /**
   * The exported object should normally contain
   * the selected screen as the root.
   */
  if (
    root &&
    Array.isArray(
      root.children
    )
  ) {
    for (
      const child of root.children
    ) {
      flattenDocument(
        child,
        elements,
        typeof root.id === 'string' ? root.id : undefined
      );
    }
  } else if (root) {
    flattenDocument(
      root,
      elements
    );
  }

  const rootBox = root?.absoluteBoundingBox;
  const rootFills = root ? extractColors(root.fills).colors : [];
  const rootInteractions = root ? extractInteractions(root) : [];

  return {
    version: '3.0',

    screen: screen.name,

    rootId: screen.id,

    origin: {
      x: typeof rootBox?.x === 'number' ? Math.round(rootBox.x) : screen.x,
      y: typeof rootBox?.y === 'number' ? Math.round(rootBox.y) : screen.y,
    },

    ...(rootFills.length ? { rootColors: rootFills } : {}),

    ...(rootInteractions.length ? { rootInteractions } : {}),

    width: screen.width,

    height: screen.height,

    page: screen.page,

    summary: screen.summary,

    extractionTimeMs:
      screen.extractionTimeMs,

    elements,
  };
}

/**
 * Convert all extracted screens.
 */
export function toDesignContexts(
  screens: ExtractedScreen[]
): DesignContext[] {
  return screens.map(
    (screen) =>
      toDesignContext(screen)
  );
}