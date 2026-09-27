import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('../components/ConversationTimeline', () => () => null);
jest.mock('../components/FloatingActionButton', () => () => null);
jest.mock('../components/SearchOverlay', () => () => null);
jest.mock('../components/UnifiedCard', () => ({ CardGrid: () => null }));
jest.mock('../components/SettingsPanel', () => () => null);
jest.mock('../utils/export/pdfExportManager', () => ({
  pdfExportManager: { exportToPDF: jest.fn() }
}));
jest.mock('../utils/markdownExporter', () => ({
  prepareMarkdownExport: jest.fn(),
  downloadMarkdownExport: jest.fn()
}));
jest.mock('../utils/globalSearchManager', () => ({
  getGlobalSearchManager: () => ({ buildGlobalIndex: jest.fn(() => Promise.resolve()) })
}));
jest.mock('../index.js', () => ({
  useI18n: () => ({ t: key => key }),
  setResolvedLang: jest.fn()
}));

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

  test('a parser failure is exposed instead of becoming an empty successful timeline', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let latest = null;
    const broken = {
      name: 'broken.json',
      type: 'application/json',
      size: 12,
      lastModified: 3,
      text: () => Promise.resolve('{broken json')
    };

    await act(async () => {
      root.render(<Harness onState={state => { latest = state; }} />);
    });

    await act(async () => {
      await latest.actions.loadFiles([broken], { activate: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.processedData).toBeNull();
    expect(latest.error).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });
});
