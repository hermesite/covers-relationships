import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const envPath = new URL('../data/.env', import.meta.url);
const token = parseEnv(readFileSync(envPath, 'utf8')).DISCOGS_TOKEN;
if (!token) {
  console.error('DISCOGS_TOKEN is missing from data/.env.');
  process.exit(1);
}

const result = spawnSync('npx', [
  '--yes', '--package=@usebruno/cli@4.2.0', 'bru', 'run',
  '--delay', '1200', '--bail', ...process.argv.slice(2)
], {
  cwd: fileURLToPath(new URL('./', import.meta.url)),
  env: { ...process.env, DISCOGS_TOKEN: token },
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

for (const output of [result.stdout, result.stderr]) {
  if (output) process.stdout.write(output.split(token).join('[REDACTED]'));
}
if (result.error) console.error('Unable to start Bruno:', result.error.message);
process.exit(result.status ?? 1);