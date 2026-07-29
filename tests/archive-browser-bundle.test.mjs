import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildArchiveBrowserBundle } from '../scripts/archive-browser-bundle.mjs';
import { injectArchiveBundle } from '../scripts/run-build.mjs';

const ARCHIVE_MARKER = '// Loominary Archive browser bundle. Generated from source modules.';

test('archive browser bundle compiles without ESM syntax', () => {
  const output = buildArchiveBrowserBundle();

  assert.match(output, /LoominaryArchiveBundle/);
  assert.match(output, /LoominaryArchiveRuntime/);
  assert.match(output, /__require/);
  assert.doesNotMatch(output, /^\s*import\s/m);
  assert.doesNotMatch(output, /^\s*export\s/m);
  assert.doesNotThrow(() => new Function(output));
});

test('build injection places archive runtime before init and is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loominary-archive-build-'));
  const artifact = path.join(directory, 'content.js');
  const bundle = `${ARCHIVE_MARKER}\nwindow.__archiveTest = true;`;

  try {
    fs.writeFileSync(artifact, "(function() {\n    'use strict';\n    init();\n})();\n", 'utf8');

    assert.equal(injectArchiveBundle(artifact, bundle), true);
    const first = fs.readFileSync(artifact, 'utf8');
    assert.ok(first.indexOf(ARCHIVE_MARKER) < first.lastIndexOf('    init();'));
    assert.equal((first.match(/Loominary Archive browser bundle/g) || []).length, 1);

    assert.equal(injectArchiveBundle(artifact, bundle), false);
    const second = fs.readFileSync(artifact, 'utf8');
    assert.equal(second, first);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
