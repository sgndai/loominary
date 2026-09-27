import {
  isAllowedViewerSourceOrigin,
  isTrustedViewerBridgeEvent,
  parseViewerBridgeHash
} from '../viewerBridge';

describe('viewer bridge contract', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';

  test('accepts only a known source origin and a UUID session id', () => {
    expect(parseViewerBridgeHash(
      `#bridge=${sessionId}&source=${encodeURIComponent('https://chatgpt.com')}`
    )).toEqual({
      sessionId,
      sourceOrigin: 'https://chatgpt.com'
    });

    expect(parseViewerBridgeHash(
      `#bridge=${sessionId}&source=${encodeURIComponent('https://evil.example')}`
    )).toBeNull();
    expect(parseViewerBridgeHash(
      '#bridge=not-a-session&source=https%3A%2F%2Fchatgpt.com'
    )).toBeNull();
  });

  test('source allowlist is exact-origin based', () => {
    expect(isAllowedViewerSourceOrigin('https://chatgpt.com')).toBe(true);
    expect(isAllowedViewerSourceOrigin('https://sub.chatgpt.com')).toBe(false);
    expect(isAllowedViewerSourceOrigin('http://chatgpt.com')).toBe(false);
  });

  test('requires source window, source origin and session id to match', () => {
    const opener = {};
    const context = { sessionId, sourceOrigin: 'https://chatgpt.com' };

    expect(isTrustedViewerBridgeEvent({
      source: opener,
      origin: 'https://chatgpt.com',
      data: { type: 'LOOMINARY_LOAD_DATA', sessionId }
    }, context, opener)).toBe(true);

    expect(isTrustedViewerBridgeEvent({
      source: {},
      origin: 'https://chatgpt.com',
      data: { sessionId }
    }, context, opener)).toBe(false);

    expect(isTrustedViewerBridgeEvent({
      source: opener,
      origin: 'https://chatgpt.com',
      data: { sessionId: '123e4567-e89b-42d3-a456-426614174001' }
    }, context, opener)).toBe(false);
  });
});
