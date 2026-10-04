import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildComment, shouldPost, MARKER } from '../src/markdown.mjs';

const receipt = JSON.parse(fs.readFileSync('examples/fixtures/expected-receipt.json', 'utf8'));

const changedResults = {
  archifyVersion: 'v3.0.1',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  nudge: false,
  changedCodePaths: [],
  maps: [{
    path: 'docs/architecture/app.architecture.json',
    status: 'changed',
    summary: receipt.summary,
    changes: receipt.changes,
    base: receipt.base,
    head: receipt.head,
    proofLevel: receipt.proofLevel,
    completeness: receipt.completeness,
    provenance: receipt.provenance ?? null,
    deltaHtml: 'delta-app.architecture.html',
    diagnostics: [],
  }],
};

const quietResults = {
  archifyVersion: 'v3.0.1',
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
  assert.match(body, /2 added · 2 removed · 5 changed/);
  // The rewired authorization connection also changes geometry, in addition to queue movement and publish rerouting.
  assert.match(body, /Layout: geometry changed on 3 elements/);
  assert.match(body, /Presentation: changed/);
  assert.match(body, /\| kind \| element \| change \|/);
  assert.match(body, /workflow artifacts\]\(https:\/\/example\.test\/run\/1\)/);
  assert.match(body, /archify v3\.0\.1/i);
  assert.match(body, /authored snapshots/i);
  assert.ok(body.includes(changedResults.baseSha));
  assert.ok(body.includes(changedResults.headSha));
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

function noStructureResults(overrides = {}) {
  const result = structuredClone(changedResults);
  const map = result.maps[0];
  map.base.semanticSha256 = '1'.repeat(64);
  map.head.semanticSha256 = '2'.repeat(64);
  for (const group of ['components', 'connections', 'boundaries']) {
    for (const counter of Object.keys(map.summary[group])) map.summary[group][counter] = 0;
    map.changes[group] = [];
  }
  map.summary.presentationChanged = false;
  map.summary.provenanceChanged = false;
  Object.assign(map, overrides);
  return result;
}

test('equal canonical digests explain edited bytes without an all-zero change headline', () => {
  const results = noStructureResults();
  results.maps[0].head.semanticSha256 = results.maps[0].base.semanticSha256;
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /No structural changes?/i);
  assert.match(body, /canonical map content is unchanged/i);
  assert.match(body, /formatting, element order, or `meta\.output`/i);
  assert.doesNotMatch(body, /0 added · 0 removed · 0 changed/);
  assert.equal(shouldPost(results, 'on-change'), true);
});

test('evidence-only changes stay visible without inflating authored structural counts', () => {
  const results = noStructureResults();
  const map = results.maps[0];
  map.summary.components.evidenceChanged = 1;
  map.changes.components = [{
    id: 'checkout', baseLabel: 'Checkout API', headLabel: 'Checkout API',
    status: 'evidence-changed', classifications: ['evidence'], changedFields: ['/sources'],
  }];
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /No structural changes?/i);
  assert.match(body, /Evidence bindings: 1 changed/);
  assert.match(body, /Checkout API/);
  assert.match(body, /\| E \| component \| `Checkout API` \| evidence-changed: \/sources \|/);
  assert.doesNotMatch(body, /\b1 changed ·/);
});

test('layout-only changes stay separate from authored structure', () => {
  const results = noStructureResults();
  results.maps[0].summary.components.moved = 1;
  results.maps[0].summary.connections.rerouted = 1;
  results.maps[0].summary.boundaries.geometryChanged = 1;
  results.maps[0].changes.components = [{ id: 'queue', headLabel: 'Order Events', status: 'moved', changedFields: ['/pos'] }];
  results.maps[0].changes.connections = [{ id: 'publish-order', status: 'rerouted', head: { from: 'checkout', to: 'queue' }, changedFields: ['/labelDy'] }];
  results.maps[0].changes.boundaries = [{ key: 'region:Production region', kind: 'region', label: 'Production region', status: 'geometry-changed', classifications: ['geometry'], changedFields: ['/pos'] }];
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /No structural changes?/i);
  assert.match(body, /Layout: geometry changed on 3 elements/);
  assert.match(body, /\| ↔ \| boundary \| `Production region` \(region\) \| geometry-changed \|/);
  assert.match(body, /Order Events/);
  assert.doesNotMatch(body, /0 added · 0 removed · 0 changed/);
});

test('title-only presentation changes are not structural changes', () => {
  const results = noStructureResults();
  results.maps[0].summary.presentationChanged = true;
  results.maps[0].head.title = 'Renamed checkout';
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /No structural changes?/i);
  assert.match(body, /Presentation: changed/);
  assert.doesNotMatch(body, /canonical map content is unchanged/i);
  assert.doesNotMatch(body, /0 added · 0 removed · 0 changed/);
});

test('provenance-only receipt shows changed repository references with bounded proof', () => {
  const results = noStructureResults({
    proofLevel: 'revision-pinned',
    provenance: {
      changedFields: ['/revision', '/link_mode'],
      base: { revision: 'c'.repeat(40), linkMode: 'web' },
      head: { revision: 'd'.repeat(40), linkMode: 'local-only' },
    },
  });
  results.maps[0].summary.provenanceChanged = true;
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /No structural changes?/i);
  assert.match(body, /Repository provenance: changed/);
  assert.match(body, /\/revision/);
  assert.match(body, /\/link_mode/);
  assert.ok(body.includes('c'.repeat(40)));
  assert.ok(body.includes('d'.repeat(40)));
  assert.match(body, /revision-pinned source references/i);
  assert.match(body, /authored architecture/i);
  assert.match(body, /(?:no|not|does not|do not)[^.\n]*runtime topology/i);
  assert.doesNotMatch(body, /proof[^\n]*verified architecture/i);
});

test('base validation failure exposes new-renderer diagnostics without declaring pre-existing defects', () => {
  const results = structuredClone(quietResults);
  results.maps[0].status = 'base-invalid';
  results.maps[0].diagnostics = [{
    rule: 'output/meta-path-syntax', subject: '/meta/output',
    message: 'meta.output must be a portable POSIX-relative path',
  }];
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /v3\.0\.1/);
  assert.match(body, /head (?:version|snapshot) validates/i);
  assert.match(body, /output\/meta-path-syntax/);
  assert.match(body, /meta\.output must be a portable POSIX-relative path/);
  assert.doesNotMatch(body, /pre-existing issue/i);
});

test('comparison output failure names the failed stage and gives a path or retry hint', () => {
  const results = structuredClone(quietResults);
  results.maps[0].status = 'compare-failed';
  results.maps[0].diagnostics = [{ code: 'output/meta-path-syntax', message: 'Cannot write comparison output' }];
  const body = buildComment(results, 'https://example.test/run/1');
  assert.match(body, /could not compare.*snapshots/i);
  assert.match(body, /output\/meta-path-syntax/);
  assert.match(body, /(?:check[^\n]*paths?|paths?[^\n]*check|retry)/i);
  assert.doesNotMatch(body, /fails archify validation|archify validate architecture|receipt is unusable/i);
  assert.equal(shouldPost(results, 'on-change'), true);
});

test('shouldPost matrix', () => {
  assert.equal(shouldPost(changedResults, 'on-change'), true);
  assert.equal(shouldPost(quietResults, 'on-change'), false);
  assert.equal(shouldPost(nudgeResults, 'on-change'), true);
  assert.equal(shouldPost(quietResults, 'always'), true);
  assert.equal(shouldPost(changedResults, 'never'), false);
});
