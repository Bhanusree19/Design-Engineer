'use strict';
// Turns a failed build into a short, safe message the plugin can show, plus a
// stable code the plugin can act on (e.g. offer "Reconnect AI model").
// Only these fixed messages ever reach the user: raw agent output, Git errors
// and stack traces stay in the container logs.

const MESSAGES = Object.freeze({
  INVALID_API_KEY:
    'Your AI model rejected the sign-in (expired session or invalid API key). Reconnect your AI model, then try again.',
  MODEL_NOT_CONNECTED:
    'Your AI model is not connected. Connect it, then try again.',
  BILLING_UNAVAILABLE:
    'Your AI provider account has no credits or quota left. Top it up or switch models, then try again.',
  PROVIDER_RATE_LIMIT:
    'Your AI provider is rate-limiting requests. Wait a minute, then try again.',
  MODEL_UNAVAILABLE:
    'The selected model is not available on your AI account. Choose another model, then try again.',
  AGENT_TIMEOUT:
    'The coding agent ran out of time before finishing. Try fewer screens at once.',
  CONTEXT_MISSING:
    'A selected screen has no saved design. Fetch the screens again, then try again.',
  REPOSITORY_ACCESS:
    'Design Engineer could not read or write the repository. Reconnect GitHub, then try again.',
  UNKNOWN:
    'Implementation could not finish. Retry after checking the service logs.',
});

// Codes the plugin answers with a "Reconnect AI model" action.
const MODEL_CODES = new Set(['INVALID_API_KEY', 'MODEL_NOT_CONNECTED', 'BILLING_UNAVAILABLE', 'MODEL_UNAVAILABLE']);

function classify(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (MESSAGES[code] && code !== 'UNKNOWN') return code;
  const message = String(error?.message || '');
  if (/must be connected|connect the (selected|model)|not connected/i.test(message)) return 'MODEL_NOT_CONNECTED';
  if (error?.name === 'TimeoutError' || /coding agent timed out|request timed out/i.test(message)) return 'AGENT_TIMEOUT';
  if (/saved design context not found/i.test(message)) return 'CONTEXT_MISSING';
  if (/repository not found|could not read from remote|authentication failed for|connect github/i.test(message))
    return 'REPOSITORY_ACCESS';
  return 'UNKNOWN';
}

function messageFor(code) {
  return MESSAGES[code] || MESSAGES.UNKNOWN;
}

/** Normalise whatever the implement endpoint returned into {code, message}. */
function fromResponse(body) {
  const code = typeof body?.code === 'string' && MESSAGES[body.code] ? body.code : 'UNKNOWN';
  return { code, message: messageFor(code) };
}

module.exports = { MESSAGES, MODEL_CODES, classify, messageFor, fromResponse };
