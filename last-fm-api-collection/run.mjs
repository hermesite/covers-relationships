import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const envPath = new URL('../data/.env', import.meta.url);
const key = parseEnv(readFileSync(envPath, 'utf8')).LASTFM_API_KEY;
if (!key) {
  console.error('LASTFM_API_KEY is missing from data/.env.');
  process.exit(1);
}

const result = spawnSync('npx', [
  '--yes', '--package=@usebruno/cli@4.2.0', 'bru', 'run',
  '--delay', '1000', ...process.argv.slice(2)
], {
  cwd: fileURLToPath(new URL('./LAST FM/', import.meta.url)),
  env: { ...process.env, LASTFM_API_KEY: key },
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

for (const output of [result.stdout, result.stderr]) {
  if (output) process.stdout.write(output.split(key).join('[REDACTED]'));
}
if (result.error) console.error('Unable to start Bruno:', result.error.message);
process.exit(result.status ?? 1);