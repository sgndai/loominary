import { GlobalSearchManager } from '../globalSearchManager';

function chatgptFixture(title, conversationId, text) {
  return {
    title,
    conversation_id: conversationId,
    current_node: 'assistant',
    mapping: {
      root: { id: 'root', parent: null, children: ['user'] },
      user: {
        id: 'user',
        parent: 'root',
        children: ['assistant'],
        message: {
          id: 'user',
          author: { role: 'user' },
          create_time: 1776160800,
          content: { content_type: 'text', parts: [text] },
          metadata: {}
        }
      },
      assistant: {
        id: 'assistant',
        parent: 'user',
        children: [],
        message: {
          id: 'assistant',
          author: { role: 'assistant' },
          create_time: 1776160801,
          content: { content_type: 'text', parts: [`${text} answer`] },
          end_turn: true,
          recipient: 'all',
          channel: 'final',
          metadata: {}
        }
      }
    }
  };
}

describe('GlobalSearchManager build lifecycle', () => {
  test('a slower obsolete build cannot overwrite the newest completed index', async () => {
    const manager = new GlobalSearchManager();

    let releaseSlowFile;
    const slowText = new Promise(resolve => {
      releaseSlowFile = resolve;
    });

    const slowFile = {
      name: 'slow.json',
      lastModified: 1,
      text: () => slowText
    };
    const fastFile = {
      name: 'fast.json',
      lastModified: 2,
      text: () => Promise.resolve(JSON.stringify(
        chatgptFixture('Fast', 'fast-conversation', 'fast message')
      ))
    };

    const obsoleteBuild = manager.buildGlobalIndex([slowFile], null, 0, {});
    await manager.buildGlobalIndex([fastFile], null, 0, {});

    releaseSlowFile(JSON.stringify(
      chatgptFixture('Slow', 'slow-conversation', 'slow message')
    ));
    await obsoleteBuild;

    const indexedFiles = new Set(
      Array.from(manager.messageIndex.values()).map(item => item.fileName)
    );

    expect(indexedFiles).toEqual(new Set(['fast.json']));
    expect(manager.search('fast message').stats.total).toBeGreaterThan(0);
    expect(manager.search('slow message').stats.total).toBe(0);
  });

  test('clear is safe before any search has run', () => {
    const manager = new GlobalSearchManager();
    expect(() => manager.clear()).not.toThrow();
    expect(manager.messageIndex.size).toBe(0);
  });
});
