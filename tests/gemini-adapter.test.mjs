import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiToArchiveRecord } from '../src/archive/geminiAdapter.mjs';

test('Gemini adapter preserves multimodal message fields', () => {
  const record = geminiToArchiveRecord({
    format: 'gemini_notebooklm',
    meta_info: { uuid: 'gemini-1', title: 'Gemini test' },
    chat_history: [
      { uuid: 'm1', sender: 'human', display_text: 'Question' },
      { uuid: 'm2', sender: 'assistant', display_text: 'Answer', thinking: 'Reason', images: [{ format: 'image/png', data: 'abc' }] }
    ]
  });

  assert.equal(record.conversation.platform, 'gemini');
  assert.equal(record.messages[1].thinking, 'Reason');
  assert.equal(record.messages[1].attachments[0].mimeType, 'image/png');
});
