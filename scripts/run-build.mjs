import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildArchiveBrowserBundle } from './archive-browser-bundle.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const ARCHIVE_MARKER = '// Loominary Archive browser bundle. Generated from source modules.';
const INIT_MARKER = '\n    init();';

export function injectArchiveBundle(filePath, bundle = buildArchiveBrowserBundle()) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Build artifact not found: ${path.relative(root, absolutePath)}`);
  }

  const source = fs.readFileSync(absolutePath, 'utf8');
  if (source.includes(ARCHIVE_MARKER)) return false;

  const insertAt = source.lastIndexOf(INIT_MARKER);
  if (insertAt < 0) {
    throw new Error(`Cannot locate init() in build artifact: ${path.relative(root, absolutePath)}`);
  }

  const output = [
    source.slice(0, insertAt),
    '',
    bundle.trimEnd(),
    source.slice(insertAt)
  ].join('\n');
  fs.writeFileSync(absolutePath, output, 'utf8');
  return true;
}

export function buildArtifactPaths(args) {
  const [command, platform] = args;
  if (command === 'userscript') {
    const name = platform ? `loominary-${platform}.user.js` : 'loominary.user.js';
    return [path.join(root, 'dist', name)];
  }
  if (command === 'extension') return [path.join(root, 'chrome', 'content.js')];
  if (command === 'firefox') return [path.join(root, 'firefox', 'content.js')];
  if (command === 'all' || !command) {
    return [
      path.join(root, 'chrome', 'content.js'),
      path.join(root, 'dist', 'loominary.user.js')
    ];
  }
  return [];
}

function findPython() {
  const candidates = process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) {
      return {
        command: candidate,
        prefix: candidate === 'py' ? ['-3'] : []
      };
    }
  }
  return null;
}

export function runBuild(args = process.argv.slice(2)) {
  const python = findPython();
  if (!python) {
    console.error('Cannot find Python. Install Python 3 and retry.');
    return 1;
  }

  const result = spawnSync(
    python.command,
    [...python.prefix, 'build.py', ...args],
    { cwd: root, stdio: 'inherit', shell: false }
  );
  if ((result.status ?? 1) !== 0) return result.status ?? 1;

  try {
    const bundle = buildArchiveBrowserBundle();
    for (const artifact of buildArtifactPaths(args)) {
      const changed = injectArchiveBundle(artifact, bundle);
      const label = path.relative(root, artifact);
      console.log(`[Archive] ${changed ? 'Injected into' : 'Already present in'} ${label}`);
    }
    return 0;
  } catch (error) {
    console.error(`[Archive] Build injection failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exit(runBuild());
}
