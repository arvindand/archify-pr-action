import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildComment, shouldPost } from '../src/markdown.mjs';

const ARCHIFY_DIR = path.resolve(process.env.ARCHIFY_DIR ?? '.archify-vendor');
const COMPARE = path.resolve('src/compare.mjs');
const FIXTURES = path.resolve('examples/fixtures');

function initRepo(t, prepareBase = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'base.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  prepareBase(path.join(dir, 'docs/architecture/app.architecture.json'));
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'console.log(1);\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();
  return { dir, git, baseSha };
}

function runPipeline(dir, baseSha, archifyDir = ARCHIFY_DIR) {
  const outputDir = path.join(dir, 'out');
  let status = 0;
  try {
    execFileSync(process.execPath, [COMPARE], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: baseSha, ARCHIFY_DIR: archifyDir, OUTPUT_DIR: outputDir, ARCHIFY_UPDATE_CHECK_DISABLED: '1', GITHUB_SHA: 'f'.repeat(40) },
    });
  } catch (error) {
    status = error.status ?? 1;
  }
  const results = JSON.parse(fs.readFileSync(path.join(outputDir, 'results.json'), 'utf8'));
  return { results, status, outputDir };
}

test('map changed: preserve receipt evidence and actual compared Git commits', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  git('add', '-A');
  git('commit', '-m', 'head');
  const headSha = git('rev-parse', 'HEAD').trim();
  // Resolve the symbolic ref rather than echoing an input or GITHUB_SHA into the report.
  const { results, status, outputDir } = runPipeline(dir, 'HEAD~1');
  assert.equal(status, 0);
  assert.equal(results.maps.length, 1);
  assert.equal(results.maps[0].status, 'changed');
  assert.equal(results.archifyVersion, 'v3.0.1');
  assert.equal(results.baseSha, baseSha);
  assert.equal(results.headSha, headSha);
  assert.ok(results.maps[0].summary.components);
  assert.ok(Array.isArray(results.maps[0].changes.components));
  assert.equal(results.nudge, false);
  assert.ok(fs.existsSync(path.join(outputDir, results.maps[0].deltaHtml)));
  const receiptName = results.maps[0].deltaHtml.replace(/^delta-/, 'receipt-').replace(/\.html$/, '.json');
  const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, receiptName), 'utf8'));
  for (const field of ['summary', 'changes', 'base', 'head', 'proofLevel', 'completeness']) {
    assert.deepEqual(results.maps[0][field], receipt[field], field);
  }
  assert.deepEqual(results.maps[0].provenance, receipt.provenance ?? null);
  assert.equal(results.maps[0].proofLevel, 'authored');
  assert.equal(results.maps[0].completeness, 'complete');
  const comment = buildComment(results, 'https://example.test/run/1');
  assert.ok(comment.includes(baseSha));
  assert.ok(comment.includes(headSha));
});

test('code changed without map: status unchanged, nudge true', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'console.log(2);\n');
  git('add', '-A');
  git('commit', '-m', 'code only');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps[0].status, 'unchanged');
  assert.equal(results.nudge, true);
  assert.deepEqual(results.changedCodePaths, ['src/app.js']);
});

test('reported head revision compares committed map bytes even when the worktree is dirty', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  const mapPath = 'docs/architecture/app.architecture.json';
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, mapPath));
  git('add', '-A');
  git('commit', '-m', 'valid committed head');
  const headSha = git('rev-parse', 'HEAD').trim();
  const committedHash = createHash('sha256').update(git('show', `HEAD:${mapPath}`)).digest('hex');
  fs.writeFileSync(path.join(dir, mapPath), '{ invalid uncommitted JSON');

  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.headSha, headSha);
  assert.equal(results.maps[0].status, 'changed');
  assert.equal(results.maps[0].head.rawSha256, committedHash);
  assert.equal(fs.readFileSync(path.join(dir, mapPath), 'utf8'), '{ invalid uncommitted JSON');
});

test('map deleted: status deleted', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  git('rm', 'docs/architecture/app.architecture.json');
  git('commit', '-m', 'delete map');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps[0].status, 'deleted');
});

test('new map added: status new, render attached', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, 'docs/architecture/second.architecture.json'));
  git('add', '-A');
  git('commit', '-m', 'second map');
  const { results, status, outputDir } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  const entry = results.maps.find((m) => m.path.endsWith('second.architecture.json'));
  assert.equal(entry.status, 'new');
  assert.ok(fs.existsSync(path.join(outputDir, entry.deltaHtml)));
});

test('invalid head map: status invalid, diagnostics present, exit 1', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  fs.writeFileSync(path.join(dir, 'docs/architecture/app.architecture.json'), '{ "meta": { "title": "broken" }, "components": [] }\n');
  git('add', '-A');
  git('commit', '-m', 'break map');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 1);
  assert.equal(results.maps[0].status, 'invalid');
  assert.ok(results.maps[0].diagnostics.length > 0);
});

test('a valid head without a stable connection id reports comparison failure, not validation failure', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  const mapPath = path.join(dir, 'docs/architecture/app.architecture.json');
  const head = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  delete head.connections[0].id;
  fs.writeFileSync(mapPath, `${JSON.stringify(head, null, 2)}\n`);
  git('add', '-A');
  git('commit', '-m', 'remove connection identity');

  const validation = JSON.parse(execFileSync(process.execPath, [
    path.join(ARCHIFY_DIR, 'bin/archify.mjs'), 'validate', 'architecture', mapPath,
    '--quality', 'standard', '--json',
  ], { cwd: dir, encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } }));
  assert.equal(validation.ok, true);
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 1);
  assert.equal(results.maps[0].status, 'compare-failed');
  assert.equal(results.maps[0].deltaHtml, null);
  assert.ok(results.maps[0].diagnostics.some((diagnostic) => diagnostic.code === 'delta/relationship-id-required'));
  const comment = buildComment(results, 'https://example.test/run/1');
  assert.match(comment, /could not compare.*snapshots/i);
  assert.match(comment, /delta\/relationship-id-required/);
  assert.match(comment, /stable(?: (?:connection|relationship) ids| `id`[^\n]*connection)/i);
  assert.doesNotMatch(comment, /fails archify validation|archify validate architecture|receipt is unusable/i);
});

test('committed JSON larger than the subprocess default buffer remains a compared map', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  const mapPath = 'docs/architecture/app.architecture.json';
  const original = fs.readFileSync(path.join(dir, mapPath));
  fs.writeFileSync(path.join(dir, mapPath), Buffer.concat([Buffer.from(' '.repeat(1024 * 1024 + 64)), original]));
  git('add', '-A');
  git('commit', '-m', 'large formatting-only map');
  const committedBytes = execFileSync('git', ['show', `HEAD:${mapPath}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  assert.ok(committedBytes.length > 1024 * 1024);

  const { results, status, outputDir } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  const map = results.maps[0];
  assert.equal(map.status, 'changed');
  assert.equal(map.head.rawSha256, createHash('sha256').update(committedBytes).digest('hex'));
  assert.equal(map.head.bytes, committedBytes.length);
  assert.equal(map.base.semanticSha256, map.head.semanticSha256);
  assert.ok(fs.existsSync(path.join(outputDir, map.deltaHtml)));
  const comment = buildComment(results, 'https://example.test/run/1');
  assert.match(comment, /No structural changes/i);
  assert.doesNotMatch(comment, /map removed/i);
});

for (const edit of ['formatting', 'output', 'title']) {
  test(`${edit}-only edit: real receipt separates map bytes from authored structure`, (t) => {
    const { dir, git, baseSha } = initRepo(t);
    const mapPath = path.join(dir, 'docs/architecture/app.architecture.json');
    const head = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    if (edit === 'output') head.meta.output = 'reports/renamed-checkout.html';
    if (edit === 'title') head.meta.title = 'Checkout Platform — New title';
    fs.writeFileSync(mapPath, `${JSON.stringify(head, null, edit === 'formatting' ? 4 : 2)}\n`);
    git('add', '-A');
    git('commit', '-m', `${edit} only`);

    const { results, status, outputDir } = runPipeline(dir, baseSha);
    assert.equal(status, 0);
    const map = results.maps[0];
    assert.equal(map.status, 'changed');
    assert.equal(results.nudge, false);
    assert.equal(shouldPost(results, 'on-change'), true);
    assert.ok(fs.existsSync(path.join(outputDir, map.deltaHtml)));
    assert.notEqual(map.base.rawSha256, map.head.rawSha256);
    assert.deepEqual(map.changes, { components: [], connections: [], boundaries: [] });
    assert.equal(map.summary.presentationChanged, edit === 'title');
    assert.equal(map.summary.provenanceChanged, false);
    const comment = buildComment(results, 'https://example.test/run/1');
    assert.doesNotMatch(comment, /0 added · 0 removed · 0 changed/);
    if (edit === 'title') {
      assert.notEqual(map.base.semanticSha256, map.head.semanticSha256);
      assert.match(comment, /No structural changes?\b/i);
      assert.match(comment, /presentation.*changed/i);
    } else {
      assert.equal(map.base.semanticSha256, map.head.semanticSha256);
      assert.match(comment, /No structural changes?/i);
    }
  });
}

test('migration: head repairs missing meta.output while old base diagnostics stay visible', (t) => {
  const { dir, git, baseSha } = initRepo(t, (mapPath) => {
    const base = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    delete base.meta.output;
    fs.writeFileSync(mapPath, `${JSON.stringify(base, null, 2)}\n`);
  });
  fs.copyFileSync(path.join(FIXTURES, 'base.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  git('add', '-A');
  git('commit', '-m', 'migrate meta.output');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps[0].status, 'base-invalid');
  assert.equal(results.maps[0].deltaHtml, null);
  assert.ok(results.maps[0].diagnostics.some((diagnostic) => diagnostic.code === 'schema/required'
    && diagnostic.evidence?.missingProperty === 'output'));
  const comment = buildComment(results, 'https://example.test/run/1');
  assert.match(comment, /v3\.0\.1/);
  assert.match(comment, /schema\/required/);
  assert.match(comment, /required property 'output'/);
  assert.match(comment, /head (?:version|snapshot) validates/i);
  assert.doesNotMatch(comment, /pre-existing issue/i);
});

test('a successful subprocess with an incomplete receipt cannot claim a complete review', (t) => {
  const { dir, git, baseSha } = initRepo(t);
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  git('add', '-A'); git('commit', '-m', 'head');
  const vendor = path.join(dir, 'fault-vendor');
  fs.mkdirSync(path.join(vendor, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(vendor, 'bin/archify.mjs'), [
    "import fs from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    "if (process.argv[2] === 'compare') {",
    "  const receiptPath = process.argv[process.argv.indexOf('--receipt') + 1];",
    "  fs.writeFileSync(receiptPath, JSON.stringify({ ok: true, schemaVersion: 1, command: 'compare', type: 'architecture', completeness: 'partial', summary: {}, changes: {} }));",
    '  process.exit(0);',
    '}',
    'const result = spawnSync(process.execPath, [' + JSON.stringify(path.join(ARCHIFY_DIR, 'bin/archify.mjs')) + ', ...process.argv.slice(2)], { stdio: "inherit" });',
    'process.exit(result.status ?? 1);',
  ].join('\n'));
  const { results, status } = runPipeline(dir, baseSha, vendor);
  assert.equal(status, 1);
  assert.equal(results.maps[0].status, 'compare-failed');
  assert.equal(results.maps[0].deltaHtml, null);
  assert.equal(results.maps[0].diagnostics[0].code, 'action/compare-receipt');
  const comment = buildComment(results, 'https://example.test/run/1');
  assert.match(comment, /could not compare.*snapshots/i);
  assert.doesNotMatch(comment, /fails archify validation|generated HTML viewers/i);
});
