import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const files = [
  'src/archive/browserEntry.mjs',
  'src/archive/browser-runtime.js'
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

export function buildArchiveBrowserBundle() {
  return [
    '// Loominary Archive browser bundle.',
    '(function(){',
    "'use strict';",
    ...files.map(read),
    '})();'
  ].join('\n\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.stdout.write(buildArchiveBrowserBundle());
}
