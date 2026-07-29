import test from 'node:test';
import assert from 'node:assert/strict';
import { grokToArchiveRecord } from '../src/archive/grokAdapter.mjs';

test('Grok adapter preserves search, citations, attachments, images, and thread metadata', () => {
  const record = grokToArchiveRecord({
    format: 'grok',
    meta_info: { uuid: 'grok-conv-1', title: 'Grok test', model: 'Grok 4' },
    raw_data: { conversationId: 'grok-conv-1', exportTime: '2026-07-29T12:00:00Z' },
    chat_history: [
      { uuid: 'q1', sender: 'human', display_text: 'Question', branch_id: 'main' },
      {
        uuid: 'a1', parent_uuid: 'q1', sender: 'assistant', display_text: 'Answer', branch_id: 'main',
        threadId: 'thread-1',
        citations: [{ id: 'card-1', url: 'https://example.com', title: 'Example' }],
        web_search_results: [{ url: 'https://example.com', title: 'Example', snippet: 'Evidence' }],
        attachments: [{ file_name: 'notes.pdf', file_type: 'application/pdf', url: 'https://example.com/notes.pdf' }],
        images: [{ file_name: 'generated.png', file_type: 'image/png', source: 'ai_generated', embedded_image: { data: 'data:image/png;base64,abc', size: 3 } }]
      }
    ]
  });

  assert.equal(record.conversation.platform, 'grok');
  assert.equal(record.conversation.provider, 'xai');
  assert.equal(record.messages[1].citations.length, 2);
  assert.equal(record.messages[1].attachments.length, 2);
  assert.equal(record.messages[1].toolCalls[0].name, 'web_search');
  assert.equal(record.messages[1].metadata.threadId, 'thread-1');
});

test('Grok adapter derives conversation tree branches when parser markers are absent', () => {
  const record = grokToArchiveRecord({
    meta_info: { title: 'Branches' },
    raw_data: {
      conversationTree: {
        rootNodeId: 'root',
        nodes: [
          { responseId: 'root', parentResponseId: null, childResponseIds: ['main-answer', 'alt-answer'] },
          { responseId: 'main-answer', parentResponseId: 'root', childResponseIds: [] },
          { responseId: 'alt-answer', parentResponseId: 'root', childResponseIds: [] }
        ]
      }
    },
    chat_history: [
      { uuid: 'root', sender: 'human', display_text: 'Question' },
      { uuid: 'main-answer', parent_uuid: 'root', sender: 'assistant', display_text: 'Main' },
      { uuid: 'alt-answer', parent_uuid: 'root', sender: 'assistant', display_text: 'Alternative' }
    ]
  });

  assert.equal(record.branches.length, 2);
  assert.equal(record.messages.find(message => message.id === 'main-answer').branchId, 'main');
  assert.equal(record.messages.find(message => message.id === 'alt-answer').branchId, 'main.1');
});

test('Grok adapter creates stable fallback ids and removes invalid parents', () => {
  const input = {
    meta_info: { title: 'Stable Grok export' },
    chat_history: [{ sender: 'assistant', parent_uuid: 'missing', display_text: 'Answer' }]
  };
  const first = grokToArchiveRecord(input);
  const second = grokToArchiveRecord(input);

  assert.equal(first.messages[0].parentId, null);
  assert.equal(first.conversation.id, second.conversation.id);
});
