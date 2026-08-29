#!/usr/bin/env bash
# Runs the demo locally: compares the committed map against a proposed change,
# prints the PR comment the action would post, and renders the interactive
# delta viewer. No GitHub setup needed.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -d .archify-vendor ] || bash scripts/vendor-archify.sh

out="examples/demo-app/out"
mkdir -p "$out"

node .archify-vendor/bin/archify.mjs compare architecture \
  examples/demo-app/docs/architecture/orders.architecture.json \
  examples/demo-app/proposed/orders.architecture.json \
  "$out/delta.html" --receipt "$out/receipt.json" --json > /dev/null

node -e "
const fs = require('node:fs');
const receipt = JSON.parse(fs.readFileSync('$out/receipt.json', 'utf8'));
import('./src/markdown.mjs').then((m) => {
  const results = {
    archifyVersion: 'v2.15.0',
    nudge: false,
    changedCodePaths: [],
    maps: [{
      path: 'docs/architecture/orders.architecture.json',
      status: 'changed',
      summary: receipt.summary,
      changes: receipt.changes,
      deltaHtml: 'delta.html',
      diagnostics: [],
    }],
  };
  console.log('--- The comment the action would post on this PR ---');
  console.log();
  console.log(m.buildComment(results, 'examples/demo-app/out/delta.html'));
  console.log();
  console.log('--- Interactive Before/Delta/After viewer ---');
  console.log();
  console.log('open ' + '$out/delta.html');
});
"
