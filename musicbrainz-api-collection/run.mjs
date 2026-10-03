import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('npx', [
  '--yes', '--package=@usebruno/cli@4.2.0', 'bru', 'run',
  '--delay', '1200', '--bail', ...process.argv.slice(2)
], {
  cwd: fileURLToPath(new URL('./', import.meta.url)),
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

for (const output of [result.stdout, result.stderr]) {
  if (output) process.stdout.write(output);
}
if (result.error) console.error('Unable to start Bruno:', result.error.message);
process.exit(result.status ?? 1);