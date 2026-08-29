import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ARCHIFY_DIR = process.env.ARCHIFY_DIR ?? '.archify-vendor';
const CLI = path.join(ARCHIFY_DIR, 'bin', 'archify.mjs');

// Drop only run-variant keys (durations, timestamps, machine paths) if the CLI adds any.
const VOLATILE = /^(durationMs|elapsedMs|generatedAt|timestamp|createdAt|outputPath|receiptPath|htmlPath)$/;
const normalize = (value) =>
  JSON.parse(JSON.stringify(value, (key, val) => (VOLATILE.test(key) ? undefined : val)));

function runCompare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-det-'));
  const receiptPath = path.join(dir, 'receipt.json');
  execFileSync('node', [
    CLI, 'compare', 'architecture',
    'examples/fixtures/base.architecture.json', 'examples/fixtures/head.architecture.json',
    path.join(dir, 'delta.html'), '--receipt', receiptPath, '--json',
  ], { encoding: 'utf8' });
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

test('compare is deterministic across runs and matches the committed receipt', () => {
  const first = runCompare();
  const second = runCompare();
  assert.deepEqual(normalize(first), normalize(second));
  const expected = JSON.parse(fs.readFileSync('examples/fixtures/expected-receipt.json', 'utf8'));
  assert.deepEqual(normalize(first), normalize(expected));
});
