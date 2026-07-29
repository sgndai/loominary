import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArchiveBrowserBundle } from '../scripts/archive-browser-bundle.mjs';

test('archive browser bundle contains runtime bridge', () => {
  const output = buildArchiveBrowserBundle();

  assert.match(output, /LoominaryArchiveBundle/);
  assert.match(output, /LoominaryArchiveRuntime/);
  assert.match(output, /__require/);
});
