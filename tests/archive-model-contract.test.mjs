import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { validateConversationRecord } from '../server/archive/contract.mjs';

test('archive model preserves rich message fields', async () => {
  const record = JSON.parse(
    await readFile('tests/fixtures/archive-v1/rich-conversation.json', 'utf8')
  );

  const validated = validateConversationRecord(record);
  assert.equal(validated.messages[0].attachments[0].name, 'note.pdf');
  assert.equal(validated.messages[1].citations[0].url, 'https://example.com');
  assert.equal(validated.messages[1].thinking, 'hidden reasoning block');
  assert.equal(validated.messages[1].toolCalls[0].name, 'web_search');
});

test('archive model rejects broken references', async () => {
  const record = JSON.parse(
    await readFile('tests/fixtures/archive-v1/rich-conversation.json', 'utf8')
  );

  const brokenParent = structuredClone(record);
  brokenParent.messages[1].parentId = 'missing-message';
  assert.throws(() => validateConversationRecord(brokenParent));

  const brokenBranch = structuredClone(record);
  brokenBranch.messages[1].branchId = 'missing-branch';
  assert.throws(() => validateConversationRecord(brokenBranch));
});
