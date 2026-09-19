// src/code.ts
//
// Plugin main thread: handles what Figma clientStorage is allowed to hold.
//
// We store the Supabase session (access token + refresh token + user email)
// so the plugin can skip signing in on every open. The account data, GitHub
// connections and Codex credentials all live in Supabase, not on disk here.

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
    width: 400,
    height: 680,
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

export interface SavedSession {
  accessToken: string;
  refreshToken: string;
  userEmail: string;
}

// -----------------------------------------------------------------------------
// STORAGE KEYS
// -----------------------------------------------------------------------------

/**
 * Only the Supabase session tokens are stored here. GitHub/Codex credentials
 * never touch Figma storage — they stay encrypted in Supabase via the backend.
 */
const SESSION_STORAGE_KEY = 'design-engineer-session';

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
        id: node.id,
        name: node.name,
        type: node.type,
        width: Math.round(node.width),
        height: Math.round(node.height),
      })
    );
}

function postSelection() {
  figma.ui.postMessage({
    type: 'selection-changed',
    selection: currentSelection(),
  });
}

figma.on('selectionchange', postSelection);
postSelection();

// -----------------------------------------------------------------------------
// MESSAGE HANDLER
// -----------------------------------------------------------------------------

figma.ui.onmessage = async (msg: any) => {
  try {
    // =========================================================================
    // GET SELECTION
    // =========================================================================

    if (msg.type === 'get-selection') {
      postSelection();
      return;
    }

    // =========================================================================
    // GET SAVED SESSION
    // =========================================================================

    if (msg.type === 'get-saved-session') {
      try {
        const saved = await figma.clientStorage.getAsync(SESSION_STORAGE_KEY);

        const session: SavedSession | null =
          saved &&
          typeof saved === 'object' &&
          typeof saved.accessToken === 'string' &&
          saved.accessToken &&
          typeof saved.refreshToken === 'string'
            ? {
                accessToken: saved.accessToken,
                refreshToken: saved.refreshToken,
                userEmail:
                  typeof saved.userEmail === 'string'
                    ? saved.userEmail
                    : '',
              }
            : null;

        figma.ui.postMessage({
          type: 'saved-session',
          session,
        });
      } catch (error) {
        console.error('[Design Engineer] Failed to read saved session:', error);
        figma.ui.postMessage({ type: 'saved-session', session: null });
      }

      return;
    }

    // =========================================================================
    // SAVE SESSION
    // =========================================================================

    if (msg.type === 'save-session') {
      const session = msg.session;

      if (
        !session ||
        typeof session.accessToken !== 'string' ||
        !session.accessToken ||
        typeof session.refreshToken !== 'string' ||
        !session.refreshToken
      ) {
        console.warn('[Design Engineer] Invalid session payload.');
        return;
      }

      await figma.clientStorage.setAsync(SESSION_STORAGE_KEY, {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        userEmail: session.userEmail || '',
      });

      console.log('[Design Engineer] Session saved to Figma client storage.');

      figma.ui.postMessage({ type: 'session-saved' });
      return;
    }

    // =========================================================================
    // CLEAR SESSION
    // =========================================================================

    if (msg.type === 'clear-session') {
      await figma.clientStorage.deleteAsync(SESSION_STORAGE_KEY);
      console.log('[Design Engineer] Session cleared.');
      figma.ui.postMessage({ type: 'session-cleared' });
      return;
    }

    // =========================================================================
    // EXTRACT SCREENS
    // =========================================================================

    if (msg.type === 'extract-screens') {
      const nodeIds: string[] =
        Array.isArray(msg.nodeIds) ? msg.nodeIds : [];

      if (nodeIds.length === 0) {
        figma.ui.postMessage({
          type: 'extraction-error',
          error: 'Please select at least one screen.',
        });
        return;
      }

      console.log(
        `[Design Engineer] Fetch requested for ${nodeIds.length} screen(s)`
      );

      figma.ui.postMessage({
        type: 'extract-started',
        total: nodeIds.length,
      });

      const extracted = await extractSelectedScreens(nodeIds);
      const contexts = toDesignContexts(extracted);

      figma.ui.postMessage({
        type: 'screens-extracted',
        results: contexts,
      });

      console.log(
        `[Design Engineer] Successfully extracted ${contexts.length} screen(s)`
      );

      return;
    }

    // =========================================================================
    // RESIZE
    // =========================================================================

    if (msg.type === 'resize') {
      if (
        typeof msg.width === 'number' &&
        typeof msg.height === 'number'
      ) {
        figma.ui.resize(msg.width, msg.height);
      }
      return;
    }

    // =========================================================================
    // UNKNOWN
    // =========================================================================

    console.warn(`[Design Engineer] Unknown message type: ${msg.type}`);
  } catch (error) {
    console.error('[Design Engineer] Plugin error:', error);

    figma.ui.postMessage({
      type: 'extraction-error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};