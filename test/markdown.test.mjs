import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildComment, shouldPost, MARKER } from '../src/markdown.mjs';

const receipt = JSON.parse(fs.readFileSync('examples/fixtures/expected-receipt.json', 'utf8'));

const changedResults = {
  archifyVersion: 'v2.15.0',
  nudge: false,
  changedCodePaths: [],
  maps: [{
    path: 'docs/architecture/app.architecture.json',
    status: 'changed',
    summary: receipt.summary,
    changes: receipt.changes,
    deltaHtml: 'delta-app.architecture.html',
    diagnostics: [],
  }],
};

const quietResults = {
  archifyVersion: 'v2.15.0',
  nudge: false,
  changedCodePaths: [],
  maps: [{ path: 'docs/architecture/app.architecture.json', status: 'unchanged', summary: null, changes: null, deltaHtml: null, diagnostics: [] }],
};

const nudgeResults = { ...quietResults, nudge: true, changedCodePaths: ['src/app.js', 'src/db.js'] };

const invalidResults = {
  ...quietResults,
  maps: [{
    path: 'docs/architecture/app.architecture.json',
    status: 'invalid',
    summary: null,
    changes: null,
    deltaHtml: null,
    diagnostics: [{ rule: 'schema/missing-field', subject: '/components/0/type', message: 'type is required' }],
  }],
};

test('changed map: marker, path, counts headline, change table, artifact link', () => {
  const body = buildComment(changedResults, 'https://example.test/run/1');
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /docs\/architecture\/app\.architecture\.json/);
  assert.match(body, /added · \d+ removed · \d+ changed · \d+ moved\/rerouted/);
  assert.match(body, /\| kind \| element \| change \|/);
  assert.match(body, /workflow artifacts\]\(https:\/\/example\.test\/run\/1\)/);
  assert.match(body, /archify v2\.15\.0/);
});

test('rewired connection shows both the old and new route', () => {
  const body = buildComment(changedResults, 'https://example.test/run/1');
  // authorize-payment moves from orders->payments to fraud->payments in the fixture pair.
  assert.match(body, /~~`orders → payments`~~ → `fraud → payments`/);
});

test('quiet PR: no-change wording, no nudge', () => {
  const body = buildComment(quietResults, 'https://example.test/run/1');
  assert.match(body, /No architecture change declared/);
  assert.doesNotMatch(body, /Does the architecture change\?/);
});

test('nudge: code changed without map update', () => {
  const body = buildComment(nudgeResults, 'https://example.test/run/1');
  assert.match(body, /changes 2 file\(s\) under watched code paths/);
  assert.match(body, /Does the architecture change\?/);
});

test('invalid map: diagnostics listed with fix hint', () => {
  const body = buildComment(invalidResults, 'https://example.test/run/1');
  assert.match(body, /fails archify validation/);
  assert.match(body, /schema\/missing-field/);
  assert.match(body, /archify validate architecture/);
});

test('shouldPost matrix', () => {
  assert.equal(shouldPost(changedResults, 'on-change'), true);
  assert.equal(shouldPost(quietResults, 'on-change'), false);
  assert.equal(shouldPost(nudgeResults, 'on-change'), true);
  assert.equal(shouldPost(quietResults, 'always'), true);
  assert.equal(shouldPost(changedResults, 'never'), false);
});
