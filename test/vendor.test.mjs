import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ARCHIFY_DIR = process.env.ARCHIFY_DIR ?? '.archify-vendor';

test('vendored archify CLI exists and prints usage', () => {
  const cliPath = path.join(ARCHIFY_DIR, 'bin', 'archify.mjs');
  assert.ok(fs.existsSync(cliPath), `expected ${cliPath} to exist — run: bash scripts/vendor-archify.sh`);
  let output = '';
  try {
    output = execFileSync('node', [cliPath], { encoding: 'utf8' });
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  assert.match(output, /Usage:/);
});

test('vendored archify ships the fixture example pair', () => {
  assert.ok(fs.existsSync(path.join(ARCHIFY_DIR, 'examples', 'checkout-platform.base.architecture.json')));
  assert.ok(fs.existsSync(path.join(ARCHIFY_DIR, 'examples', 'checkout-platform.head.architecture.json')));
});
