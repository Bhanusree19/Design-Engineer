// // src/code.ts

// import {
//   extractSelectedScreens,
//   getSelectedScreens,
// } from './figma/extractor';

// import {
//   toDesignContexts,
// } from './figma/parser';

// figma.showUI(__html__, {
//   width: 380,
//   height: 640,
//   themeColors: true,
// });

// interface SelectionSummary {
//   id: string;
//   name: string;
//   type: string;
//   width: number;
//   height: number;
// }

// // -----------------------------------------------------------------------------
// // SESSION STORAGE
// // -----------------------------------------------------------------------------
// //
// // We store ONLY the backend session ID in Figma clientStorage.
// //
// // We do NOT store:
// // - GitHub access token
// // - Codex credentials
// // - GitHub password
// // - Codex password
// //
// // The actual credentials remain on the backend.
// // -----------------------------------------------------------------------------

// const SESSION_STORAGE_KEY =
//   'design-engineer-session-id';

// // -----------------------------------------------------------------------------
// // CURRENT SELECTION
// // -----------------------------------------------------------------------------

// function currentSelection(): SelectionSummary[] {
//   return getSelectedScreens().map(
//     (node) => ({
//       id: node.id,

//       name: node.name,

//       type: node.type,

//       width: Math.round(
//         node.width
//       ),

//       height: Math.round(
//         node.height
//       ),
//     })
//   );
// }

// // -----------------------------------------------------------------------------
// // SEND SELECTION TO UI
// // -----------------------------------------------------------------------------

// function postSelection() {
//   figma.ui.postMessage({
//     type: 'selection-changed',

//     selection:
//       currentSelection(),
//   });
// }

// // -----------------------------------------------------------------------------
// // FIGMA SELECTION LISTENER
// // -----------------------------------------------------------------------------

// figma.on(
//   'selectionchange',
//   postSelection
// );

// // Send initial selection.
// postSelection();

// // -----------------------------------------------------------------------------
// // MESSAGE HANDLER
// // -----------------------------------------------------------------------------

// figma.ui.onmessage =
//   async (msg: any) => {
//     try {
//       switch (msg.type) {
//         // -------------------------------------------------------------------
//         // GET CURRENT SELECTION
//         // -------------------------------------------------------------------

//         case 'get-selection': {
//           postSelection();

//           break;
//         }

//         // -------------------------------------------------------------------
//         // GET SAVED SESSION
//         // -------------------------------------------------------------------
//         //
//         // Called by App.tsx when the plugin opens.
//         // -------------------------------------------------------------------

//         case 'get-saved-session': {
//           try {
//             const savedSession =
//               await figma.clientStorage.getAsync(
//                 SESSION_STORAGE_KEY
//               );

//             figma.ui.postMessage({
//               type: 'saved-session',

//               sessionId:
//                 typeof savedSession ===
//                 'string'
//                   ? savedSession
//                   : null,
//             });
//           } catch (error) {
//             console.error(
//               '[Design Engineer] Failed to read saved session:',
//               error
//             );

//             figma.ui.postMessage({
//               type: 'saved-session',

//               sessionId: null,
//             });
//           }

//           break;
//         }

//         // -------------------------------------------------------------------
//         // SAVE SESSION
//         // -------------------------------------------------------------------
//         //
//         // Called after backend creates a session.
//         // -------------------------------------------------------------------

//         case 'save-session': {
//           const sessionId =
//             msg.sessionId;

//           if (
//             typeof sessionId !==
//               'string' ||
//             !sessionId
//           ) {
//             console.warn(
//               '[Design Engineer] Cannot save empty session ID.'
//             );

//             break;
//           }

//           await figma.clientStorage.setAsync(
//             SESSION_STORAGE_KEY,
//             sessionId
//           );

//           console.log(
//             '[Design Engineer] Session saved to Figma client storage.'
//           );

//           figma.ui.postMessage({
//             type: 'session-saved',
//           });

//           break;
//         }

//         // -------------------------------------------------------------------
//         // CLEAR SESSION
//         // -------------------------------------------------------------------
//         //
//         // Used when the backend says the session no longer exists.
//         // -------------------------------------------------------------------

//         case 'clear-session': {
//           await figma.clientStorage.deleteAsync(
//             SESSION_STORAGE_KEY
//           );

//           console.log(
//             '[Design Engineer] Saved session cleared.'
//           );

//           figma.ui.postMessage({
//             type: 'session-cleared',
//           });

//           break;
//         }

//         // -------------------------------------------------------------------
//         // EXTRACT SCREENS
//         // -------------------------------------------------------------------

//         case 'extract-screens': {
//           const nodeIds =
//             Array.isArray(
//               msg.nodeIds
//             )
//               ? msg.nodeIds
//               : [];

//           if (
//             nodeIds.length === 0
//           ) {
//             figma.ui.postMessage({
//               type: 'extraction-error',

//               error:
//                 'Please select at least one screen.',
//             });

//             return;
//           }

//           console.log(
//             `[Design Engineer] Fetch requested for ${nodeIds.length} screen(s)`
//           );

//           // -----------------------------------------------------------------
//           // FAST JSON EXTRACTION
//           // -----------------------------------------------------------------

//           const extracted =
//             await extractSelectedScreens(
//               nodeIds
//             );

//           // -----------------------------------------------------------------
//           // CONVERT TO DESIGN CONTEXT
//           // -----------------------------------------------------------------

//           const contexts =
//             toDesignContexts(
//               extracted
//             );

//           console.log(
//             `[Design Engineer] Successfully converted ${contexts.length} screen(s) to Design Context`
//           );

//           // -----------------------------------------------------------------
//           // SEND JSON TO REACT UI
//           // -----------------------------------------------------------------

//           figma.ui.postMessage({
//             type: 'screens-extracted',

//             results:
//               contexts,
//           });

//           break;
//         }

//         // -------------------------------------------------------------------
//         // RESIZE
//         // -------------------------------------------------------------------

//         case 'resize': {
//           if (
//             typeof msg.width ===
//               'number' &&
//             typeof msg.height ===
//               'number'
//           ) {
//             figma.ui.resize(
//               msg.width,
//               msg.height
//             );
//           }

//           break;
//         }

//         // -------------------------------------------------------------------
//         // UNKNOWN MESSAGE
//         // -------------------------------------------------------------------

//         default: {
//           console.warn(
//             `[Design Engineer] Unknown message type: ${msg.type}`
//           );
//         }
//       }
//     } catch (error) {
//       console.error(
//         '[Design Engineer] Plugin error:',
//         error
//       );

//       figma.ui.postMessage({
//         type: 'extraction-error',

//         error:
//           error instanceof Error
//             ? error.message
//             : String(error),
//       });
//     }
//   };



// src/code.ts

import {
  extractSelectedScreens,
} from './figma/extractor';

import {
  toDesignContexts,
} from './figma/parser';

// -----------------------------------------------------------------------------
// SHOW PLUGIN UI
// -----------------------------------------------------------------------------

figma.showUI(
  __html__,
  {
    width: 380,
    height: 640,
    themeColors: true,
  }
);

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

interface SelectionSummary {
  id: string;

  name: string;

  type: string;

  width: number;

  height: number;
}

// -----------------------------------------------------------------------------
// STORAGE KEY
// -----------------------------------------------------------------------------

/**
 * We only store the Design Engineer session ID here.
 *
 * We DO NOT store:
 *
 * - Codex password
 * - Codex access token
 * - GitHub access token
 * - Device code
 */
const SESSION_STORAGE_KEY =
  'design-engineer-session-id';

const CODEX_AUTH_STORAGE_KEY =
  'design-engineer-codex-authenticated';

// -----------------------------------------------------------------------------
// CURRENT FIGMA SELECTION
// -----------------------------------------------------------------------------

function currentSelection(): SelectionSummary[] {
  return figma.currentPage.selection
    .filter(
      (
        node
      ): node is SceneNode & {
        width: number;
        height: number;
      } =>
        'width' in node &&
        'height' in node
    )
    .map(
      (node) => ({
        id:
          node.id,

        name:
          node.name,

        type:
          node.type,

        width:
          Math.round(
            node.width
          ),

        height:
          Math.round(
            node.height
          ),
      })
    );
}

// -----------------------------------------------------------------------------
// SEND SELECTION TO UI
// -----------------------------------------------------------------------------

function postSelection() {
  figma.ui.postMessage({
    type:
      'selection-changed',

    selection:
      currentSelection(),
  });
}

// -----------------------------------------------------------------------------
// FIGMA SELECTION LISTENER
// -----------------------------------------------------------------------------

figma.on(
  'selectionchange',
  postSelection
);

// Send initial selection.
postSelection();

// -----------------------------------------------------------------------------
// MESSAGE HANDLER
// -----------------------------------------------------------------------------

figma.ui.onmessage =
  async (msg: any) => {
    try {
      // =======================================================================
      // GET SELECTION
      // =======================================================================

      if (
        msg.type ===
        'get-selection'
      ) {
        postSelection();

        return;
      }

      // =======================================================================
      // GET SAVED SESSION
      // =======================================================================

      if (
        msg.type ===
        'get-saved-session'
      ) {
        try {
          const [
            savedSession,
            codexAuthenticated,
          ] =
            await Promise.all([
              figma.clientStorage.getAsync(
                SESSION_STORAGE_KEY
              ),
              figma.clientStorage.getAsync(
                CODEX_AUTH_STORAGE_KEY
              ),
            ]);

          figma.ui.postMessage({
            type:
              'saved-session',

            sessionId:
              typeof savedSession ===
              'string'
                ? savedSession
                : null,

            codexAuthenticated:
              !!codexAuthenticated,
          });
        } catch (error) {
          console.error(
            '[Design Engineer] Failed to read saved session:',
            error
          );

          figma.ui.postMessage({
            type:
              'saved-session',

            sessionId:
              null,
          });
        }

        return;
      }

      // =======================================================================
      // SAVE SESSION
      // =======================================================================

      if (
        msg.type ===
        'save-session'
      ) {
        const sessionId =
          msg.sessionId;

        if (
          typeof sessionId !==
            'string' ||
          !sessionId
        ) {
          console.warn(
            '[Design Engineer] Invalid session ID.'
          );

          return;
        }

        await figma.clientStorage.setAsync(
          SESSION_STORAGE_KEY,
          sessionId
        );

        console.log(
          '[Design Engineer] Design Engineer session saved.'
        );

        figma.ui.postMessage({
          type:
            'session-saved',
        });

        return;
      }

      // =======================================================================
      // SAVE CODEX AUTH STATE
      // =======================================================================

      if (
        msg.type ===
        'save-codex-auth'
      ) {
        await figma.clientStorage.setAsync(
          CODEX_AUTH_STORAGE_KEY,
          true
        );

        console.log(
          '[Design Engineer] Codex auth marker saved.'
        );

        return;
      }

      // =======================================================================
      // CLEAR CODEX AUTH MARKER
      // =======================================================================

      if (
        msg.type ===
        'clear-codex-auth'
      ) {
        await figma.clientStorage.deleteAsync(
          CODEX_AUTH_STORAGE_KEY
        );

        console.log(
          '[Design Engineer] Codex auth marker cleared.'
        );

        return;
      }

      // =======================================================================
      // CLEAR SESSION
      // =======================================================================

      if (
        msg.type ===
        'clear-session'
      ) {
        await figma.clientStorage.deleteAsync(
          SESSION_STORAGE_KEY
        );

        console.log(
          '[Design Engineer] Design Engineer session cleared.'
        );

        figma.ui.postMessage({
          type:
            'session-cleared',
        });

        return;
      }

      // =======================================================================
      // EXTRACT SCREENS
      // =======================================================================

      if (
        msg.type ===
        'extract-screens'
      ) {
        const nodeIds:
          string[] =
          Array.isArray(
            msg.nodeIds
          )
            ? msg.nodeIds
            : [];

        if (
          nodeIds.length ===
          0
        ) {
          figma.ui.postMessage({
            type:
              'extraction-error',

            error:
              'Please select at least one screen.',
          });

          return;
        }

        console.log(
          `[Design Engineer] Fetch requested for ${nodeIds.length} screen(s)`
        );

        figma.ui.postMessage({
          type:
            'extract-started',

          total:
            nodeIds.length,
        });

        // -------------------------------------------------------------------
        // FAST EXTRACTION
        // -------------------------------------------------------------------

        const extracted =
          await extractSelectedScreens(
            nodeIds
          );

        // -------------------------------------------------------------------
        // DESIGN CONTEXT
        // -------------------------------------------------------------------

        const contexts =
          toDesignContexts(
            extracted
          );

        // -------------------------------------------------------------------
        // SEND TO UI
        // -------------------------------------------------------------------

        figma.ui.postMessage({
          type:
            'screens-extracted',

          results:
            contexts,
        });

        console.log(
          `[Design Engineer] Successfully extracted ${contexts.length} screen(s)`
        );

        return;
      }

      // =======================================================================
      // RESIZE
      // =======================================================================

      if (
        msg.type ===
        'resize'
      ) {
        if (
          typeof msg.width ===
            'number' &&
          typeof msg.height ===
            'number'
        ) {
          figma.ui.resize(
            msg.width,
            msg.height
          );
        }

        return;
      }

      // =======================================================================
      // UNKNOWN
      // =======================================================================

      console.warn(
        `[Design Engineer] Unknown message type: ${msg.type}`
      );
    } catch (error) {
      console.error(
        '[Design Engineer] Plugin error:',
        error
      );

      figma.ui.postMessage({
        type:
          'extraction-error',

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  };