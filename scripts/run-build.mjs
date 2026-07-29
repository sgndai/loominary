import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const candidates = process.platform === 'win32'
  ? ['py', 'python', 'python3']
  : ['python3', 'python'];

let command = null;
let prefix = [];
for (const candidate of candidates) {
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (!result.error && result.status === 0) {
    command = candidate;
    if (candidate === 'py') prefix = ['-3'];
    break;
  }
}

if (!command) {
  console.error('Cannot find Python. Install Python 3 and retry.');
  process.exit(1);
}

const result = spawnSync(command, [...prefix, 'build.py', ...args], {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
