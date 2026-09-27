import {
  getViewerBridgeContext,
  isViewerBridgeEvent
} from '../utils/viewerBridge';

describe('viewer bridge security', () => {
  test('accepts supported source origins and a bounded session id', () => {
    expect(getViewerBridgeContext('#bridge=12345678&source=https%3A%2F%2Fchatgpt.com')).toEqual({
      sessionId: '12345678',
      sourceOrigin: 'https://chatgpt.com'
    });
  });

  test('rejects unsupported origins and missing session ids', () => {
    expect(getViewerBridgeContext('#bridge=12345678&source=https%3A%2F%2Fevil.example')).toBeNull();
    expect(getViewerBridgeContext('#source=https%3A%2F%2Fchatgpt.com')).toBeNull();
  });

  test('requires matching origin, opener window, and session id', () => {
    const opener = {};
    const context = { sessionId: 'session-123', sourceOrigin: 'https://chatgpt.com' };
    expect(isViewerBridgeEvent({
      origin: 'https://chatgpt.com',
      source: opener,
      data: { sessionId: 'session-123' }
    }, context, opener)).toBe(true);

    expect(isViewerBridgeEvent({
      origin: 'https://chatgpt.com',
      source: {},
      data: { sessionId: 'session-123' }
    }, context, opener)).toBe(false);

    expect(isViewerBridgeEvent({
      origin: 'https://chatgpt.com',
      source: opener,
      data: { sessionId: 'other' }
    }, context, opener)).toBe(false);
  });
});
