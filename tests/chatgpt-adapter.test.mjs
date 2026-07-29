import test from 'node:test';
import assert from 'node:assert/strict';

import { chatgptToArchiveRecord } from '../src/archive/chatgptAdapter.mjs';

test('ChatGPT adapter converts parser output into Archive Model v1', () => {
  const record = chatgptToArchiveRecord({
    meta_info: {
      uuid: 'chatgpt-conv-1',
      title: 'Adapter test',
      created_at: '2026-07-30T00:00:00.000Z'
    },
    chat_history: [
      {
        uuid: 'msg-1',
        parent_uuid: null,
        sender: 'human',
        display_text: 'Hello',
        attachments: [],
        citations: [],
        tools: []
      },
      {
        uuid: 'msg-2',
        parent_uuid: 'msg-1',
        sender: 'assistant',
        display_text: 'World',
        thinking: 'reasoning',
        tools: [{ name: 'search', input: {}, result: {} }]
      }
    ]
  });

  assert.equal(record.conversation.platform, 'chatgpt');
  assert.equal(record.messages[1].thinking, 'reasoning');
  assert.equal(record.messages[1].toolCalls[0].name, 'search');
  assert.equal(record.messages[1].parentId, 'msg-1');
});
