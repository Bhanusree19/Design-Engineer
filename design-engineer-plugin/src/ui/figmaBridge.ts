// The Figma plugin UI runs in a sandboxed iframe. The only way to talk to
// the main plugin thread (code.ts, which has the `figma` global) is via
// window.postMessage, wrapped in a `pluginMessage` envelope.

export function sendToPlugin(msg: unknown) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export function onPluginMessage(handler: (msg: any) => void) {
  const listener = (event: MessageEvent) => {
    if (event.data && event.data.pluginMessage) {
      handler(event.data.pluginMessage);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
