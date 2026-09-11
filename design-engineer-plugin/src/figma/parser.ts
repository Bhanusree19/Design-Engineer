// src/figma/parser.ts

import {
  ExtractedScreen,
  FigmaRestNode,
} from './extractor';

export interface DesignElement {
  id: string;

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
}

export interface DesignContext {
  version: string;

  screen: string;

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

/**
 * Convert one raw Figma JSON node to our normalized element.
 */
function convertNode(
  node: FigmaRestNode
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
  output: DesignElement[]
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
      convertNode(node)
    );
  }

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
        output
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
        elements
      );
    }
  } else if (root) {
    flattenDocument(
      root,
      elements
    );
  }

  return {
    version: '2.0',

    screen: screen.name,

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