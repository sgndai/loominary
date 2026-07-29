import test from 'node:test';
import assert from 'node:assert/strict';

import { chatgptToArchiveRecord } from '../src/archive/chatgptAdapter.mjs';

const ROOT = '00000000-0000-4000-8000-000000000000';

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

test('ChatGPT adapter preserves branch topology', () => {
  const record = chatgptToArchiveRecord({
    meta_info: { uuid: 'branch-test', title: 'Branch test' },
    raw_data: {
      current_node: 'node-main-answer',
      mapping: {
        'node-user': { parent: null },
        'node-question': { parent: 'node-user' },
        'node-main-answer': { parent: 'node-question' },
        'node-alt-answer': { parent: 'node-question' }
      }
    },
    chat_history: [
      { uuid: 'm1', _node_id: 'node-user', parent_uuid: ROOT, sender: 'human', display_text: 'Q' },
      { uuid: 'm2', _node_id: 'node-question', parent_uuid: 'm1', sender: 'human', display_text: 'Follow' },
      { uuid: 'm3', _node_id: 'node-main-answer', parent_uuid: 'm2', sender: 'assistant', display_text: 'Main' },
      { uuid: 'm4', _node_id: 'node-alt-answer', parent_uuid: 'm2', sender: 'assistant', display_text: 'Alternative' }
    ]
  });

  assert.equal(record.messages[2].branchId, 'main');
  assert.equal(record.messages[3].branchId, 'main.1');
  assert.deepEqual(record.branches.map(branch => branch.id), ['main', 'main.1']);
  assert.equal(record.branches[1].parentBranchId, 'main');
});
