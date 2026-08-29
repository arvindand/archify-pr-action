import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ARCHIFY_DIR = path.resolve(process.env.ARCHIFY_DIR ?? '.archify-vendor');
const COMPARE = path.resolve('src/compare.mjs');
const FIXTURES = path.resolve('examples/fixtures');

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'base.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'console.log(1);\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();
  return { dir, git, baseSha };
}

function runPipeline(dir, baseSha) {
  const outputDir = path.join(dir, 'out');
  let status = 0;
  try {
    execFileSync('node', [COMPARE], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: baseSha, ARCHIFY_DIR, OUTPUT_DIR: outputDir },
    });
  } catch (error) {
    status = error.status ?? 1;
  }
  const results = JSON.parse(fs.readFileSync(path.join(outputDir, 'results.json'), 'utf8'));
  return { results, status, outputDir };
}

test('map changed: status changed, summary present, delta html rendered, no nudge', () => {
  const { dir, git, baseSha } = initRepo();
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, 'docs/architecture/app.architecture.json'));
  git('add', '-A');
  git('commit', '-m', 'head');
  const { results, status, outputDir } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps.length, 1);
  assert.equal(results.maps[0].status, 'changed');
  assert.ok(results.maps[0].summary.components);
  assert.ok(Array.isArray(results.maps[0].changes.components));
  assert.equal(results.nudge, false);
  assert.ok(fs.existsSync(path.join(outputDir, results.maps[0].deltaHtml)));
});

test('code changed without map: status unchanged, nudge true', () => {
  const { dir, git, baseSha } = initRepo();
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'console.log(2);\n');
  git('add', '-A');
  git('commit', '-m', 'code only');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps[0].status, 'unchanged');
  assert.equal(results.nudge, true);
  assert.deepEqual(results.changedCodePaths, ['src/app.js']);
});

test('map deleted: status deleted', () => {
  const { dir, git, baseSha } = initRepo();
  git('rm', 'docs/architecture/app.architecture.json');
  git('commit', '-m', 'delete map');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  assert.equal(results.maps[0].status, 'deleted');
});

test('new map added: status new, render attached', () => {
  const { dir, git, baseSha } = initRepo();
  fs.copyFileSync(path.join(FIXTURES, 'head.architecture.json'), path.join(dir, 'docs/architecture/second.architecture.json'));
  git('add', '-A');
  git('commit', '-m', 'second map');
  const { results, status, outputDir } = runPipeline(dir, baseSha);
  assert.equal(status, 0);
  const entry = results.maps.find((m) => m.path.endsWith('second.architecture.json'));
  assert.equal(entry.status, 'new');
  assert.ok(fs.existsSync(path.join(outputDir, entry.deltaHtml)));
});

test('invalid head map: status invalid, diagnostics present, exit 1', () => {
  const { dir, git, baseSha } = initRepo();
  fs.writeFileSync(path.join(dir, 'docs/architecture/app.architecture.json'), '{ "meta": { "title": "broken" }, "components": [] }\n');
  git('add', '-A');
  git('commit', '-m', 'break map');
  const { results, status } = runPipeline(dir, baseSha);
  assert.equal(status, 1);
  assert.equal(results.maps[0].status, 'invalid');
  assert.ok(results.maps[0].diagnostics.length > 0);
});
