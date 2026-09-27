import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-markdown', () => () => null);
jest.mock('remark-gfm', () => () => null);

const { useFileManager } = require('../App');

global.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function conversation(title, suffix) {
  return JSON.stringify({
    title,
    conversation_id: `conv-${suffix}`,
    current_node: `assistant-${suffix}`,
    mapping: {
      root: { id: 'root', parent: null, children: [`user-${suffix}`] },
      [`user-${suffix}`]: {
        id: `user-${suffix}`,
        parent: 'root',
        children: [`assistant-${suffix}`],
        message: {
          id: `user-${suffix}`,
          author: { role: 'user' },
          create_time: 1776160800,
          content: { content_type: 'text', parts: [`question-${suffix}`] },
          metadata: {}
        }
      },
      [`assistant-${suffix}`]: {
        id: `assistant-${suffix}`,
        parent: `user-${suffix}`,
        children: [],
        message: {
          id: `assistant-${suffix}`,
          author: { role: 'assistant' },
          create_time: 1776160810,
          content: { content_type: 'text', parts: [`answer-${suffix}`] },
          metadata: {}
        }
      }
    }
  });
}

function stagedFile(name, firstContent, laterRead) {
  let reads = 0;
  return {
    name,
    type: 'application/json',
    size: firstContent.length,
    lastModified: name === 'a.json' ? 1 : 2,
    text: () => {
      reads += 1;
      return reads === 1 ? Promise.resolve(firstContent) : laterRead.promise;
    }
  };
}

function Harness({ onState }) {
  const state = useFileManager();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

describe('useFileManager active-file parsing', () => {
  test('a stale slow parse cannot overwrite the newly selected file', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let latest = null;
    const slowA = deferred();
    const slowB = deferred();
    const contentA = conversation('Conversation A', 'a');
    const contentB = conversation('Conversation B', 'b');
    const fileA = stagedFile('a.json', contentA, slowA);
    const fileB = stagedFile('b.json', contentB, slowB);

    await act(async () => {
      root.render(<Harness onState={state => { latest = state; }} />);
    });

    await act(async () => {
      await latest.actions.loadFiles([fileA, fileB]);
    });

    expect(latest.currentFileIndex).toBe(0);

    await act(async () => {
      latest.actions.switchFile(1);
    });

    await act(async () => {
      slowB.resolve(contentB);
      await slowB.promise;
    });

    expect(latest.currentFileIndex).toBe(1);
    expect(latest.processedData?.meta_info?.title).toBe('Conversation B');

    await act(async () => {
      slowA.resolve(contentA);
      await slowA.promise;
    });

    expect(latest.currentFileIndex).toBe(1);
    expect(latest.processedData?.meta_info?.title).toBe('Conversation B');

    await act(async () => {
      root.unmount();
    });
  });
});
