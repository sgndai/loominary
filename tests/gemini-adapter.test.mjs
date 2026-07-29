import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiToArchiveBundle, geminiToArchiveRecord } from '../src/archive/geminiAdapter.mjs';

test('Gemini adapter preserves multimodal, canvas, grounding, and stable identity', () => {
  const record = geminiToArchiveRecord({
    format: 'gemini_notebooklm',
    meta_info: { uuid: 'gemini_1234567890123', title: 'Gemini test' },
    chat_history: [
      { uuid: 'm1', sender: 'human', display_text: 'Question' },
      {
        uuid: 'm2', sender: 'assistant', display_text: 'Answer',
        thinking: 'Reason',
        images: [{ format: 'image/png', data: 'abc' }],
        canvas: 'export const answer = true;',
        citations: [{ url: 'https://example.com', title: 'Source' }]
      }
    ]
  });

  assert.equal(record.conversation.platform, 'gemini');
  assert.equal(record.conversation.id.startsWith('gemini-'), true);
  assert.equal(record.messages[1].thinking, 'Reason');
  assert.equal(record.messages[1].attachments[0].mimeType, 'image/png');
  assert.equal(record.messages[1].content[1].language, 'canvas');
  assert.equal(record.messages[1].citations[0].url, 'https://example.com');
});

test('Gemini adapter maps selected multi-version path to main and alternatives to child branches', () => {
  const record = geminiToArchiveRecord({
    format: 'gemini_notebooklm',
    meta_info: { uuid: 'gemini-real-id', title: 'Branches' },
    raw_data: {
      conversation: [
        {
          turnIndex: 0,
          human: { versions: [{ version: 0, text: 'Q' }] },
          assistant: { versions: [
            { version: 0, text: 'A' },
            { version: 1, text: 'A2' }
          ] }
        }
      ]
    },
    chat_history: [
      { uuid: 'human_0_v0', sender: 'human', display_text: 'Q' },
      { uuid: 'assistant_0_v0', sender: 'assistant', display_text: 'A', _version: 0, parent_uuid: 'human_0_v0' },
      { uuid: 'assistant_0_v1', sender: 'assistant', display_text: 'A2', _version: 1, parent_uuid: 'human_0_v0' }
    ]
  });

  assert.equal(record.branches.length, 2);
  assert.equal(record.messages.find(message => message.id === 'assistant_0_v0').branchId, 'main');
  assert.equal(record.messages.find(message => message.id === 'assistant_0_v1').branchId, 'main.1');
});

test('NotebookLM adapter creates context from notebook sources', () => {
  const bundle = geminiToArchiveBundle({
    platform: 'notebooklm',
    meta_info: { title: 'Notebook' },
    raw_data: { notebook: { name: 'Research', sources: [{ name: 'paper.pdf' }] }, conversation: [] },
    chat_history: []
  });

  assert.equal(bundle.context.project.name, 'Research');
  assert.equal(bundle.context.project.knowledgeFiles[0].name, 'paper.pdf');
});

test('Gemini adapter removes dangling provider parents before contract validation', () => {
  const record = geminiToArchiveRecord({
    meta_info: { uuid: 'gemini-test', title: 'Dangling' },
    chat_history: [{ uuid: 'm1', parent_uuid: 'missing', sender: 'assistant', display_text: 'A' }]
  });

  assert.equal(record.messages[0].parentId, null);
});
