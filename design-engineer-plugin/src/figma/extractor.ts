// // src/figma/extractor.ts
// //
// // Fast Figma screen extractor.
// //
// // Instead of manually walking the Figma node tree and reading hundreds/thousands
// // of individual properties, we ask Figma to serialize the selected node using
// // its native JSON_REST_V1 exporter.
// //
// // JSON_REST_V1 returns an object in the same general shape as the Figma REST
// // API node response.
// //
// // This is intentionally a "raw Figma context" layer.
// // parser.ts converts this into our smaller Design Context format.

// export interface FigmaRestNode {
//   [key: string]: any;
// }

// export interface ExtractedScreen {
//   id: string;
//   name: string;
//   type: string;
//   x: number;
//   y: number;
//   width: number;
//   height: number;

//   page: {
//     id: string;
//     name: string;
//   };

//   document: FigmaRestNode;

//   summary: {
//     nodeCount: number;
//     textNodeCount: number;
//     imageNodeCount: number;
//     componentCount: number;
//     instanceCount: number;
//   };

//   extractionTimeMs: number;

//   extractedAt: string;
// }

// /**
//  * Valid screen types for Phase 1.
//  *
//  * We allow FRAME / COMPONENT / COMPONENT_SET / SECTION.
//  */
// export function isScreenNode(
//   node: BaseNode
// ): node is SceneNode {
//   return (
//     node.type === 'FRAME' ||
//     node.type === 'COMPONENT' ||
//     node.type === 'COMPONENT_SET' ||
//     node.type === 'SECTION'
//   );
// }

// /**
//  * Get currently selected screen-like nodes.
//  */
// export function getSelectedScreens(): SceneNode[] {
//   return figma.currentPage.selection.filter((node) =>
//     isScreenNode(node)
//   );
// }

// /**
//  * Count nodes from the JSON_REST_V1 result.
//  *
//  * This is only for diagnostics and UI progress.
//  *
//  * IMPORTANT:
//  * This does NOT read Figma nodes again.
//  * It walks the already-created plain JSON object.
//  */
// function getSummary(document: FigmaRestNode) {
//   let nodeCount = 0;
//   let textNodeCount = 0;
//   let imageNodeCount = 0;
//   let componentCount = 0;
//   let instanceCount = 0;

//   function visit(node: any) {
//     if (!node || typeof node !== 'object') {
//       return;
//     }

//     nodeCount++;

//     switch (node.type) {
//       case 'TEXT':
//         textNodeCount++;
//         break;

//       case 'IMAGE':
//       case 'IMAGE-SVG':
//         imageNodeCount++;
//         break;

//       case 'COMPONENT':
//       case 'COMPONENT_SET':
//         componentCount++;
//         break;

//       case 'INSTANCE':
//         instanceCount++;
//         break;
//     }

//     if (Array.isArray(node.children)) {
//       for (const child of node.children) {
//         visit(child);
//       }
//     }
//   }

//   // JSON_REST_V1 gives us a response object containing `document`.
//   // We want to count the actual exported node tree, not the response wrapper.
//   visit(document);

//   return {
//     nodeCount,
//     textNodeCount,
//     imageNodeCount,
//     componentCount,
//     instanceCount,
//   };
// }

// /**
//  * Extract ONE screen.
//  *
//  * This is the key performance change.
//  *
//  * OLD:
//  *
//  * SceneNode
//  *   ↓
//  * extractNode()
//  *   ↓
//  * inspect children
//  *   ↓
//  * inspect fills
//  *   ↓
//  * inspect strokes
//  *   ↓
//  * inspect effects
//  *   ↓
//  * inspect children...
//  *
//  * NEW:
//  *
//  * SceneNode
//  *   ↓
//  * Figma JSON_REST_V1 serializer
//  *   ↓
//  * plain JSON object
//  */
// export async function extractScreen(
//   node: SceneNode
// ): Promise<ExtractedScreen> {
//   const started = Date.now();

//   console.log(
//     `[Design Engineer] Starting JSON extraction: ${node.name}`
//   );

//   const document = await node.exportAsync({
//     format: 'JSON_REST_V1',
//   });

//  const extractionTimeMs =
//   Date.now() - started;

//   const restDocument =
//     document as FigmaRestNode;

//   const summary = getSummary(
//     restDocument.document || restDocument
//   );

//   console.log(
//     `[Design Engineer] JSON extraction complete: ${node.name}`
//   );

//   console.log(
//     `[Design Engineer] Nodes: ${summary.nodeCount}`
//   );

//   console.log(
//     `[Design Engineer] Text: ${summary.textNodeCount}`
//   );

//   console.log(
//     `[Design Engineer] Images: ${summary.imageNodeCount}`
//   );

//   console.log(
//     `[Design Engineer] Components: ${summary.componentCount}`
//   );

//   console.log(
//     `[Design Engineer] Instances: ${summary.instanceCount}`
//   );

//   console.log(
//     `[Design Engineer] Extraction time: ${extractionTimeMs.toFixed(
//       2
//     )} ms`
//   );

//   return {
//     id: node.id,

//     name: node.name,

//     type: node.type,

//     x:
//       'x' in node
//         ? Math.round(node.x)
//         : 0,

//     y:
//       'y' in node
//         ? Math.round(node.y)
//         : 0,

//     width:
//       'width' in node
//         ? Math.round(node.width)
//         : 0,

//     height:
//       'height' in node
//         ? Math.round(node.height)
//         : 0,

//     page: {
//       id: figma.currentPage.id,
//       name: figma.currentPage.name,
//     },

//     document: restDocument,

//     summary,

//     extractionTimeMs,

//     extractedAt:
//       new Date().toISOString(),
//   };
// }

// /**
//  * Extract all selected screens.
//  *
//  * We deliberately process screens one-by-one.
//  *
//  * Why?
//  *
//  * A large Figma JSON export can itself be expensive. Starting many exports
//  * simultaneously can put pressure on the same plugin runtime.
//  *
//  * Sequential extraction also gives us accurate progress:
//  *
//  * 1 / 5
//  * 2 / 5
//  * 3 / 5
//  * ...
//  */
// export async function extractSelectedScreens(
//   nodeIds: string[]
// ): Promise<ExtractedScreen[]> {
//   if (!nodeIds.length) {
//     throw new Error(
//       'No screens selected.'
//     );
//   }

//   const started = Date.now();

//   const results: ExtractedScreen[] = [];

//   for (
//     let index = 0;
//     index < nodeIds.length;
//     index++
//   ) {
//     const nodeId = nodeIds[index];

//     const node =
//       await figma.getNodeByIdAsync(
//         nodeId
//       );

//     if (!node) {
//       console.warn(
//         `[Design Engineer] Node no longer exists: ${nodeId}`
//       );

//       continue;
//     }

//     if (!isScreenNode(node)) {
//       console.warn(
//         `[Design Engineer] Skipping unsupported node: ${node.name} (${node.type})`
//       );

//       continue;
//     }

//     figma.ui.postMessage({
//       type: 'extract-progress',

//       screen: node.name,

//       current: index + 1,

//       total: nodeIds.length,

//       step: 'metadata',
//     });

//     const result =
//       await extractScreen(node);

//     results.push(result);

//     figma.ui.postMessage({
//       type: 'extract-progress',

//       screen: node.name,

//       current: index + 1,

//       total: nodeIds.length,

//       step: 'complete',

//       summary: result.summary,

//       extractionTimeMs:
//         result.extractionTimeMs,
//     });
//   }

//   const totalTime =
//   Date.now() - started;

//   console.log(
//     `[Design Engineer] Total extraction time: ${totalTime.toFixed(
//       2
//     )} ms`
//   );

//   return results;
// }

// src/figma/extractor.ts

export interface FigmaRestNode {
  [key: string]: any;
}

export interface ExtractedScreen {
  id: string;
  name: string;
  type: string;

  x: number;
  y: number;

  width: number;
  height: number;

  page: {
    id: string;
    name: string;
  };

  document: FigmaRestNode;

  summary: {
    nodeCount: number;
    textNodeCount: number;
    imageNodeCount: number;
    componentCount: number;
    instanceCount: number;
  };

  extractionTimeMs: number;

  extractedAt: string;
}

/**
 * Nodes that can be treated as screens.
 */
export function isScreenNode(
  node: BaseNode
): node is SceneNode {
  return (
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' ||
    node.type === 'SECTION'
  );
}

/**
 * Get screen-like nodes from current Figma selection.
 */
export function getSelectedScreens(): SceneNode[] {
  return figma.currentPage.selection.filter(
    (node) => isScreenNode(node)
  );
}

/**
 * Count nodes from the JSON object returned by Figma.
 *
 * This does NOT access Figma APIs.
 * It only walks the already-created JSON.
 */
function getSummary(document: any) {
  let nodeCount = 0;
  let textNodeCount = 0;
  let imageNodeCount = 0;
  let componentCount = 0;
  let instanceCount = 0;

  function visit(node: any) {
    if (
      !node ||
      typeof node !== 'object'
    ) {
      return;
    }

    if (
      typeof node.type === 'string'
    ) {
      nodeCount++;

      switch (node.type) {
        case 'TEXT':
          textNodeCount++;
          break;

        case 'IMAGE':
        case 'IMAGE-SVG':
          imageNodeCount++;
          break;

        case 'COMPONENT':
        case 'COMPONENT_SET':
          componentCount++;
          break;

        case 'INSTANCE':
          instanceCount++;
          break;
      }
    }

    if (
      Array.isArray(node.children)
    ) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(document);

  return {
    nodeCount,
    textNodeCount,
    imageNodeCount,
    componentCount,
    instanceCount,
  };
}

/**
 * Extract one screen using Figma's native JSON serializer.
 */
export async function extractScreen(
  node: SceneNode
): Promise<ExtractedScreen> {
  const started = Date.now();

  console.log(
    `[Design Engineer] Starting JSON extraction: ${node.name}`
  );

  let document: any;

  try {
    document = await node.exportAsync({
      format: 'JSON_REST_V1',
    });
  } catch (error) {
    console.error(
      `[Design Engineer] JSON_REST_V1 export failed for "${node.name}"`,
      error
    );

    throw error;
  }

  const extractionTimeMs =
    Date.now() - started;

  const restDocument =
    document as FigmaRestNode;

  const actualDocument =
    restDocument.document ||
    restDocument;

  const summary =
    getSummary(actualDocument);

  console.log(
    `[Design Engineer] JSON extraction complete: ${node.name}`
  );

  console.log(
    `[Design Engineer] Nodes: ${summary.nodeCount}`
  );

  console.log(
    `[Design Engineer] Text: ${summary.textNodeCount}`
  );

  console.log(
    `[Design Engineer] Images: ${summary.imageNodeCount}`
  );

  console.log(
    `[Design Engineer] Components: ${summary.componentCount}`
  );

  console.log(
    `[Design Engineer] Instances: ${summary.instanceCount}`
  );

  console.log(
    `[Design Engineer] Extraction time: ${extractionTimeMs} ms`
  );

  return {
    id: node.id,

    name: node.name,

    type: node.type,

    x:
      'x' in node
        ? Math.round(
            (node as any).x
          )
        : 0,

    y:
      'y' in node
        ? Math.round(
            (node as any).y
          )
        : 0,

    width:
      'width' in node
        ? Math.round(
            (node as any).width
          )
        : 0,

    height:
      'height' in node
        ? Math.round(
            (node as any).height
          )
        : 0,

    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
    },

    document: restDocument,

    summary,

    extractionTimeMs,

    extractedAt:
      new Date().toISOString(),
  };
}

/**
 * Extract multiple selected screens.
 *
 * We process them sequentially to keep the Figma plugin runtime stable
 * and provide predictable progress updates.
 */
export async function extractSelectedScreens(
  nodeIds: string[]
): Promise<ExtractedScreen[]> {
  if (
    !Array.isArray(nodeIds) ||
    nodeIds.length === 0
  ) {
    throw new Error(
      'No screens selected.'
    );
  }

  const started = Date.now();

  const results: ExtractedScreen[] = [];

  console.log(
    `[Design Engineer] Fetch requested for ${nodeIds.length} screen(s)`
  );

  figma.ui.postMessage({
    type: 'extract-started',
    total: nodeIds.length,
  });

  for (
    let index = 0;
    index < nodeIds.length;
    index++
  ) {
    const nodeId =
      nodeIds[index];

    const node =
      await figma.getNodeByIdAsync(
        nodeId
      );

    if (!node) {
      console.warn(
        `[Design Engineer] Node not found: ${nodeId}`
      );

      continue;
    }

    if (!isScreenNode(node)) {
      console.warn(
        `[Design Engineer] Skipping unsupported node "${node.name}" (${node.type})`
      );

      continue;
    }

    figma.ui.postMessage({
      type: 'extract-progress',

      screen: node.name,

      current: index + 1,

      total: nodeIds.length,

      step: 'metadata',
    });

    const result =
      await extractScreen(node);

    results.push(result);

    figma.ui.postMessage({
      type: 'extract-progress',

      screen: node.name,

      current: index + 1,

      total: nodeIds.length,

      step: 'complete',

      summary: result.summary,

      extractionTimeMs:
        result.extractionTimeMs,
    });
  }

  const totalTime =
    Date.now() - started;

  console.log(
    `[Design Engineer] Total extraction time: ${totalTime} ms`
  );

  console.log(
    `[Design Engineer] Successfully extracted ${results.length}/${nodeIds.length} screen(s)`
  );

  return results;
}