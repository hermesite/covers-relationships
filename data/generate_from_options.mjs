#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const cwd = process.cwd();
const optionsFile = path.join(cwd, 'src/constants/artistOptions.js');

if (!fs.existsSync(optionsFile)) {
  console.error(`artist options file not found: ${optionsFile}`);
  process.exit(1);
}

const source = fs.readFileSync(optionsFile, 'utf8');
const ids = [...source.matchAll(/\bid\s*:\s*(\d+)\b/g)].map((m) => m[1]);
const uniqueIds = [...new Set(ids)];

if (uniqueIds.length === 0) {
  console.error('No artist ids found in src/constants/artistOptions.js');
  process.exit(1);
}

console.log(`Generating data for artist option ids: ${uniqueIds.join(', ')}`);

const child = spawn(
  'python3',
  ['../data/generate_graph_data.py', '--artists', ...uniqueIds],
  {
    cwd,
    stdio: 'inherit',
    env: process.env,
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
