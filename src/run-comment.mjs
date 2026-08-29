import fs from 'node:fs';
import { upsertComment } from './comment.mjs';

const resultsPath = process.env.RESULTS_PATH ?? 'archify-out/results.json';
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

const outcome = await upsertComment({
  token: process.env.GITHUB_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
  prNumber: process.env.PR_NUMBER,
  mode: process.env.COMMENT_MODE ?? 'on-change',
  results,
  runUrl: process.env.RUN_URL ?? '',
});
console.log(`comment: ${outcome.action}`);
