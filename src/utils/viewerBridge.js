const ALLOWED_SOURCE_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://claude.ai',
  'https://grok.com',
  'https://gemini.google.com',
  'https://aistudio.google.com',
  'https://copilot.microsoft.com'
]);

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const VIEWER_ORIGIN = 'https://sgndai.github.io';

export function isAllowedViewerSourceOrigin(origin) {
  return ALLOWED_SOURCE_ORIGINS.has(origin);
}

export function parseViewerBridgeHash(hash = '') {
  const value = String(hash || '').replace(/^#/, '');
  if (!value) return null;

  const params = new URLSearchParams(value);
  const sessionId = params.get('bridge') || '';
  const sourceOrigin = params.get('source') || '';

  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  if (!isAllowedViewerSourceOrigin(sourceOrigin)) return null;

  return { sessionId, sourceOrigin };
}

export function isTrustedViewerBridgeEvent(event, context, openerWindow) {
  if (!context || !event || !openerWindow) return false;
  if (event.source !== openerWindow) return false;
  if (event.origin !== context.sourceOrigin) return false;
  if (!event.data || typeof event.data !== 'object') return false;
  return event.data.sessionId === context.sessionId;
}

export function postViewerBridgeMessage(message, context = parseViewerBridgeHash(window.location.hash)) {
  if (!context || !window.opener) return false;
  window.opener.postMessage(
    { ...message, sessionId: context.sessionId },
    context.sourceOrigin
  );
  return true;
}
