const ALLOWED_SOURCE_ORIGINS = new Set([
  'https://claude.ai',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://grok.com',
  'https://gemini.google.com',
  'https://aistudio.google.com',
  'https://copilot.microsoft.com'
]);

export function getViewerBridgeContext(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const sessionId = params.get('bridge');
  const sourceOrigin = params.get('source');
  if (!sessionId || !sourceOrigin) return null;
  if (sessionId.length < 8 || sessionId.length > 128) return null;
  if (!ALLOWED_SOURCE_ORIGINS.has(sourceOrigin)) return null;

  return { sessionId, sourceOrigin };
}

export function isViewerBridgeEvent(event, context, opener = window.opener) {
  if (!context || !event) return false;
  return (
    event.origin === context.sourceOrigin &&
    event.source === opener &&
    event.data?.sessionId === context.sessionId
  );
}

export function postViewerReady(context, config = {}) {
  if (!context || !window.opener) return false;
  window.opener.postMessage(
    { type: 'LOOMINARY_READY', sessionId: context.sessionId, config },
    context.sourceOrigin
  );
  return true;
}

export function postViewerSettings(context, config) {
  if (!context || !window.opener) return false;
  window.opener.postMessage(
    { type: 'LOOMINARY_SETTINGS_UPDATE', sessionId: context.sessionId, config },
    context.sourceOrigin
  );
  return true;
}

export { ALLOWED_SOURCE_ORIGINS };
