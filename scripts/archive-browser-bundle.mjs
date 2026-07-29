import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const files = [
  'src/archive/browser-runtime.js',
  'src/archive/browserEntry.mjs'
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const output = [
  '(function(){',
  "'use strict';",
  ...files.map(read),
  '})();'
].join('\n\n');

process.stdout.write(output);
