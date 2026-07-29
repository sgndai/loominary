import test from 'node:test';
import assert from 'node:assert/strict';

import { exportConversationZipBundle } from '../src/archive/exporters/index.mjs';
import { adaptProviderConversation } from '../src/archive/adapterRegistry.mjs';

const fixture = {
  meta_info: {
    uuid: 'bundle-test',
    title: 'Bundle test',
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
      thinking: 'hidden'
    }
  ]
};

test('bundle export creates zip bytes with deterministic archive payload', () => {
  const record = adaptProviderConversation(fixture);
  const bundle = exportConversationZipBundle(record);

  assert.equal(bundle.mimeType, 'application/zip');
  assert.ok(bundle.bytes instanceof Uint8Array);
  assert.ok(bundle.bytes.length > 0);
});
