// src/code.ts
//
// Plugin main thread: handles what Figma clientStorage is allowed to hold.
//
// We store the Supabase session (access token + refresh token + user email)
// so the plugin can skip signing in on every open. The account data, GitHub
// connections and Codex credentials all live in Supabase, not on disk here.

import {
  extractSelectedScreens,
  isScreenNode,
} from './figma/extractor';

import {
  toDesignContexts,
  DesignContext,
  DesignInteraction,
} from './figma/parser';

import {
  exportReferencePng,
} from './figma/screenshot';

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
  user?: {
    id: string;
    email: string;
  };
}

// -----------------------------------------------------------------------------
// STORAGE KEYS
// -----------------------------------------------------------------------------

/**
 * Only the Supabase session tokens are stored here. GitHub/Codex credentials
 * never touch Figma storage — they stay encrypted in Supabase via the backend.
 */
const SESSION_STORAGE_KEY = 'design-engineer-session';

/**
 * Small UI preferences: the running job to resume, the chosen AI model when the
 * backend can't store it yet. Never secrets: anything that looks like a key or
 * token is refused.
 */
const PREFS_STORAGE_KEY = 'design-engineer-prefs';
const PREFS_MAX_LENGTH = 20000;

// -----------------------------------------------------------------------------
// CURRENT FIGMA SELECTION
// -----------------------------------------------------------------------------

function summarizeSelection(nodes: readonly SceneNode[]): SelectionSummary[] {
  return nodes
    .filter(
      (
        node
      ): node is SceneNode & {
        width: number;
        height: number;
      } =>
        isScreenNode(node) && 'width' in node &&
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

// Include top-level screens and screens inside sections, not every nested UI frame.
function pageScreens(): SelectionSummary[] {
  const nodes: SceneNode[] = [];
  function visit(children: readonly SceneNode[]) {
    for (const node of children) {
      if (node.type === 'SECTION') visit(node.children);
      else if (isScreenNode(node)) nodes.push(node);
    }
  }
  visit(figma.currentPage.children);
  return summarizeSelection(nodes);
}

// -----------------------------------------------------------------------------
// MESSAGE HANDLER
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// FIDELITY DATA: destination screen names + the Figma export of each frame
// -----------------------------------------------------------------------------

async function addFidelityData(contexts: DesignContext[]) {
  const names = new Map<string, string>();
  const all: DesignInteraction[] = [];
  for (const ctx of contexts) {
    for (const el of ctx.elements) if (el.interactions) all.push(...el.interactions);
    if (ctx.rootInteractions) all.push(...ctx.rootInteractions);
  }
  for (const it of all) {
    if (!it.destinationId || names.has(it.destinationId)) continue;
    try {
      const dest = await figma.getNodeByIdAsync(it.destinationId);
      names.set(it.destinationId, dest ? dest.name : '');
    } catch {
      names.set(it.destinationId, '');
    }
  }
  for (const it of all) {
    const name = it.destinationId ? names.get(it.destinationId) : '';
    if (name) it.destinationName = name;
  }
  for (const ctx of contexts) {
    if (!ctx.rootId) continue;
    try {
      const node = await figma.getNodeByIdAsync(ctx.rootId);
      if (node && 'exportAsync' in node) {
        const ref = await exportReferencePng(node as SceneNode);
        if (ref) ctx.fidelityReference = ref;
      }
    } catch (error) {
      console.warn('[Design Engineer] Reference export failed for', ctx.screen, error);
    }
  }
}

figma.ui.onmessage = async (msg: any) => {
  try {
    // =========================================================================
    // GET SELECTION
    // =========================================================================

    if (msg.type === 'get-page-screens') {
      try {
        figma.ui.postMessage({ type: 'page-screens', requestId: msg.requestId, selection: pageScreens() });
      } catch {
        figma.ui.postMessage({ type: 'page-screens-error', requestId: msg.requestId, error: 'Could not read the current Figma page.' });
      }
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
                user:
                  saved.user &&
                  typeof saved.user.id === 'string' &&
                  typeof saved.user.email === 'string'
                    ? { id: saved.user.id, email: saved.user.email }
                    : undefined,
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
        userEmail: session.user?.email || session.userEmail || '',
        user: session.user
          ? { id: session.user.id, email: session.user.email }
          : undefined,
      });

      console.log('[Design Engineer] Session saved to Figma client storage.');

      figma.ui.postMessage({ type: 'session-saved' });
      return;
    }

    // =========================================================================
    // CLEAR SESSION
    // =========================================================================

    if (msg.type === 'get-prefs') {
      let prefs: unknown = null;
      try {
        prefs = await figma.clientStorage.getAsync(PREFS_STORAGE_KEY);
      } catch (error) {
        console.warn('[Design Engineer] Failed to read preferences:', error);
      }
      figma.ui.postMessage({
        type: 'prefs',
        prefs: prefs && typeof prefs === 'object' ? prefs : {},
      });
      return;
    }

    if (msg.type === 'set-prefs') {
      const prefs = msg.prefs;
      const text = prefs && typeof prefs === 'object' ? JSON.stringify(prefs) : '';
      if (!text || text.length > PREFS_MAX_LENGTH || /api[_-]?key|token|secret/i.test(text)) {
        console.warn('[Design Engineer] Preferences refused.');
        return;
      }
      await figma.clientStorage.setAsync(PREFS_STORAGE_KEY, prefs);
      return;
    }

    if (msg.type === 'clear-session') {
      await figma.clientStorage.deleteAsync(PREFS_STORAGE_KEY);
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
        Array.isArray(msg.nodeIds) ? Array.from(new Set<string>(msg.nodeIds.filter((id: unknown) => typeof id === 'string'))) : [];

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
      if (extracted.length !== nodeIds.length) {
        throw new Error('Some selected screens could not be read. Refresh your selection and try again.');
      }
      const contexts = toDesignContexts(extracted);
      await addFidelityData(contexts);

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