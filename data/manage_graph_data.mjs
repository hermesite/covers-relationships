#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(scriptDir);
const frontendDir = path.join(rootDir, 'frontend');
const optionsFile = path.join(frontendDir, 'src/constants/artistOptions.js');
const graphDir = path.join(frontendDir, 'data/graphs');
const cacheDir = path.join(rootDir, 'data/.cache');
const generator = path.join(scriptDir, 'generate_graph_data.py');

function artistIds() {
  const source = fs.readFileSync(optionsFile, 'utf8');
  return [...new Set([...source.matchAll(/\bid\s*:\s*(\d+)\b/g)].map((match) => match[1]))];
}

function generate(ids) {
  const result = spawnSync(
    'python3',
    [generator, '--artists', ...ids, '--no-cache'],
    { cwd: frontendDir, stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 1);
}

const operation = process.argv[2];
const ids = artistIds();

if (ids.length === 0) {
  console.error(`No artist IDs found in ${optionsFile}`);
  process.exit(1);
}

if (operation === 'reset') {
  fs.rmSync(graphDir, { recursive: true, force: true });
  console.log(`Removed generated graphs. Regenerating default artist ${ids[0]}.`);
  generate([ids[0]]);
}

if (operation === 'refresh-cache') {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const entry of fs.readdirSync(cacheDir)) {
    if (entry !== '_sent.json') {
      fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true });
    }
  }
  console.log(`Removed endpoint cache files from ${cacheDir}; preserved the API quota ledger.`);
  console.log(`Regenerating ${ids.length} artist cache(s): ${ids.join(', ')}`);
  generate(ids);
}

console.error('Usage: node data/manage_graph_data.mjs <reset|refresh-cache>');
process.exit(1);