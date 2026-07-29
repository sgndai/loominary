import test from 'node:test';
import assert from 'node:assert/strict';

import { loadArchive } from '../server/archive/loadArchive.mjs';

// This fixture documents the minimum rich archive shape required for future adapters.
test('archive model preserves rich message fields', async () => {
  const archive = await loadArchive('tests/fixtures/archive-v1');
  const conversation = archive.getConversation('conv-alpha');

  assert.equal(conversation.conversation.platform, 'claude');
  assert.ok(Array.isArray(conversation.messages));
  assert.ok(Array.isArray(conversation.branches));
});
