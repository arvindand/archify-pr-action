import fs from 'node:fs';
import { upsertComment } from './comment.mjs';
import { buildComment } from './markdown.mjs';

const results = JSON.parse(fs.readFileSync(process.env.RESULTS_PATH ?? 'archify-out/results.json', 'utf8'));
const mode = process.env.COMMENT_MODE ?? 'on-change';
const runUrl = process.env.RUN_URL ?? '';
const isFork = process.env.IS_FORK === 'true';

// The job summary always carries the review. Pull requests from forks get a
// read-only token, so the comment cannot be posted there.
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${buildComment(results, runUrl)}\n`);
}

const outcome = await upsertComment({
  token: process.env.GITHUB_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
  prNumber: process.env.PR_NUMBER,
  mode,
  results,
  runUrl,
  isFork,
  expectedHeadSha: process.env.EXPECTED_HEAD_SHA,
});

if (outcome.action === 'skipped-readonly') {
  console.log('comment: skipped (read-only token, expected for a pull request from a fork). The review is in the job summary.');
} else if (outcome.action === 'skipped-stale') {
  console.log('comment: skipped (the PR head changed). This revision remains available in the job summary.');
} else {
  console.log(`comment: ${outcome.action}`);
}
