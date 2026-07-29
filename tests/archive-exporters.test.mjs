import test from 'node:test';
import assert from 'node:assert/strict';

import { exportConversationJson, exportConversationMarkdown } from '../src/archive/exporters/index.mjs';
import { adaptProviderConversation } from '../src/archive/adapterRegistry.mjs';

const fixture = {
  meta_info: {
    uuid: 'export-test',
    title: 'Export test',
    platform: 'chatgpt'
  },
  chat_history: [
    {
      uuid: 'm1',
      sender: 'human',
      display_text: 'Question'
    },
    {
      uuid: 'm2',
      parent_uuid: 'm1',
      sender: 'assistant',
      display_text: 'Answer',
      thinking: 'hidden',
      citations: [{ url: 'https://example.com', title: 'Example' }],
      tools: [{ name: 'search' }]
    }
  ]
};

test('archive registry converts provider output before export', () => {
  const record = adaptProviderConversation(fixture);

  assert.equal(record.conversation.platform, 'chatgpt');
  assert.equal(record.messages.length, 2);
  assert.equal(record.messages[1].toolCalls[0].name, 'search');
});

test('archive JSON export keeps schema envelope', () => {
  const record = adaptProviderConversation(fixture);
  const json = JSON.parse(exportConversationJson(record));

  assert.equal(json.schemaVersion, 'loominary.export/v1');
  assert.equal(json.conversation.schemaVersion, 'loominary.conversation/v1');
});

test('archive Markdown export stays readable and omits embedded image payloads', () => {
  const record = adaptProviderConversation(fixture);
  const markdown = exportConversationMarkdown(record);

  assert.match(markdown, /# Export test/);
  assert.match(markdown, /Citations/);
  assert.doesNotMatch(markdown, /data:image\/png;base64/);
});
