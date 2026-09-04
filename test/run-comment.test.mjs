import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('quiet review is written to the summary with PR comments disabled', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultsPath = path.join(directory, 'results.json');
  const summaryPath = path.join(directory, 'summary.md');
  fs.writeFileSync(resultsPath, JSON.stringify({ archifyVersion: 'v2.15.0', nudge: false, maps: [], changedCodePaths: [] }));
  execFileSync(process.execPath, ['src/run-comment.mjs'], {
    env: { ...process.env, RESULTS_PATH: resultsPath, GITHUB_STEP_SUMMARY: summaryPath,
      COMMENT_MODE: 'never', GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', RUN_URL: 'https://example.test/run' },
    encoding: 'utf8',
  });
  const summary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(summary, /No architecture change declared/);
  assert.match(summary, /workflow run/);
  assert.doesNotMatch(summary, /workflow artifacts/);
});
