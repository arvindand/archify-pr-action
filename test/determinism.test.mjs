import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ARCHIFY_DIR = process.env.ARCHIFY_DIR ?? '.archify-vendor';
const CLI = path.join(ARCHIFY_DIR, 'bin', 'archify.mjs');

function runCompare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-det-'));
  const receiptPath = path.join(dir, 'receipt.json');
  const htmlPath = path.join(dir, 'delta.html');
  try {
    execFileSync(process.execPath, [
      CLI, 'compare', 'architecture',
      'examples/fixtures/base.architecture.json', 'examples/fixtures/head.architecture.json',
      htmlPath, '--receipt', receiptPath, '--json',
    ], { encoding: 'utf8' });
    return {
      receipt: fs.readFileSync(receiptPath),
      html: fs.readFileSync(htmlPath),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('compare emits identical receipt and HTML bytes across runs', () => {
  const first = runCompare();
  const second = runCompare();
  assert.deepEqual(first.receipt, second.receipt);
  assert.deepEqual(first.html, second.html);
});

// Renderer bytes and validation counts can change without changing the authored
// architecture delta. Keep that semantic contract independent of the byte check.
function semanticComparison(receipt) {
  return {
    summary: receipt.summary,
    changes: receipt.changes,
    baseSemanticSha256: receipt.base.semanticSha256,
    headSemanticSha256: receipt.head.semanticSha256,
  };
}

test('compare preserves the committed semantic delta and input hashes', () => {
  const actual = JSON.parse(runCompare().receipt.toString('utf8'));
  const expected = JSON.parse(fs.readFileSync('examples/fixtures/expected-receipt.json', 'utf8'));
  assert.deepEqual(semanticComparison(actual), semanticComparison(expected));
});
