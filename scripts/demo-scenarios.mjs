import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { upsertComment } from '../src/comment.mjs';
import { buildComment } from '../src/markdown.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAP = 'docs/architecture/orders.architecture.json';
const readMap = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const baseline = readMap('examples/demo-app/docs/architecture/orders.architecture.json');
const proposed = readMap('examples/demo-app/proposed/orders.architecture.json');
const encode = (value) => JSON.stringify(value, null, 2) + '\n';

// This in-memory API exercises the actual comment updater. It never contacts GitHub.
function commentApi() {
  const comments = [];
  const events = [];
  return {
    comments, events,
    async fetchImpl(url, init = {}) {
      const method = init.method ?? 'GET';
      events.push({ method, url });
      if (method === 'POST') comments.push({ id: comments.length + 1, ...JSON.parse(init.body) });
      if (method === 'PATCH') {
        const comment = comments.find((item) => item.id === Number(url.split('/').at(-1)));
        assert.ok(comment, 'Only update a comment that already exists');
        Object.assign(comment, JSON.parse(init.body));
      }
      return { ok: true, json: async () => structuredClone(comments), text: async () => '' };
    },
  };
}

export const scenarios = [
  {
    id: 'service-extraction', title: 'Extract stock reservation',
    description: 'Add a reservation service, remove Redis, change REST to gRPC, and move the warehouse connection.',
    async run(c) {
      c.write(MAP, proposed); c.commit('Extract stock reservation');
      const r = await c.review('01-refactor');
      assert.equal(r.exit, 0); assert.equal(r.results.maps[0].status, 'changed');
      assert.ok(r.results.maps[0].changes.components.some((item) => item.status === 'added'));
      assert.ok(r.results.maps[0].changes.components.some((item) => item.status === 'removed'));
      assert.equal(r.commentAction, 'created'); c.assertViewer(r);
    },
  },
  {
    id: 'reverted-change', title: 'Revert a previously reviewed change',
    description: 'Two commits on one simulated PR: introduce the refactor, then restore the baseline. The same comment must be updated.',
    async run(c) {
      c.write(MAP, proposed); c.commit('Introduce refactor');
      const first = await c.review('01-introduced');
      assert.equal(first.commentAction, 'created');
      c.write(MAP, baseline); c.commit('Revert refactor');
      const reverted = await c.review('02-reverted');
      assert.equal(reverted.exit, 0); assert.equal(reverted.results.maps[0].status, 'unchanged');
      assert.equal(reverted.commentAction, 'updated');
      assert.equal(c.api.comments.length, 1);
      assert.match(reverted.comment, /No architecture change declared/);
      assert.doesNotMatch(reverted.comment, /\| component \|/);
      assert.equal(c.api.events.filter((e) => e.method === 'POST').length, 1);
      assert.equal(c.api.events.filter((e) => e.method === 'PATCH').length, 1);
    },
  },
  {
    id: 'same-filename', title: 'Two maps with the same filename',
    description: 'Orders and fulfillment each have a runtime.architecture.json. Both independent viewers and receipts must survive.',
    maps: ['docs/architecture/orders/runtime.architecture.json', 'docs/architecture/fulfillment/runtime.architecture.json'],
    async run(c) {
      for (const [index, mapPath] of c.mapPaths.entries()) {
        const map = structuredClone(index === 0 ? proposed : baseline);
        map.meta.title = index === 0 ? 'Orders refactor' : 'Fulfillment review';
        if (index === 1) map.components.find((item) => item.id === 'fulfillment').sublabel = 'Dedicated worker';
        c.write(mapPath, map);
      }
      c.commit('Update both service maps');
      const r = await c.review('01-two-maps');
      assert.equal(r.exit, 0); assert.equal(r.results.maps.length, 2);
      assert.ok(r.results.maps.every((map) => map.status === 'changed'));
      assert.equal(new Set(r.results.maps.map((map) => map.deltaHtml)).size, 2);
      c.assertViewer(r);
      const receipts = fs.readdirSync(r.directory).filter((file) => file.startsWith('receipt-'));
      assert.equal(receipts.length, 2);
      const summaries = receipts.map((file) => JSON.parse(fs.readFileSync(path.join(r.directory, file))).summary);
      assert.notDeepEqual(summaries[0], summaries[1], 'Each map must retain its own delta');
    },
  },
  {
    id: 'render-failure', title: 'A valid new map fails to render',
    description: 'Fault injection: real validation succeeds, the delivery subprocess fails deliberately, then the next run uses the real renderer.',
    async run(c) {
      c.write('docs/architecture/new.architecture.json', proposed); c.commit('Add a new map');
      const wrapper = path.join(c.temp, 'fault-injection', 'bin');
      fs.mkdirSync(wrapper, { recursive: true });
      fs.writeFileSync(path.join(wrapper, 'archify.mjs'), [
        "import { spawnSync } from 'node:child_process';",
        "if (process.argv[2] === 'deliver') {",
        "  console.log(JSON.stringify({ diagnostics: [{ code: 'demo-render-failure', message: 'Injected delivery failure for the demo; no viewer was produced.' }] }));",
        '  process.exit(1);',
        '}',
        'const r = spawnSync(process.execPath, [' + JSON.stringify(path.join(c.archifyDir, 'bin/archify.mjs')) + ', ...process.argv.slice(2)], { stdio: "inherit" });',
        'process.exit(r.status ?? 1);',
      ].join('\n'));
      const failed = await c.review('01-render-failed', { archifyDir: path.dirname(wrapper) });
      assert.equal(failed.exit, 1);
      const newMap = failed.results.maps.find((map) => map.path.endsWith('/new.architecture.json'));
      assert.equal(newMap.status, 'render-failed'); assert.equal(newMap.deltaHtml, null);
      assert.match(failed.comment, /Injected delivery failure/);
      assert.doesNotMatch(failed.comment, /full render is attached|interactive Before\/Delta\/After/);
      const fixed = await c.review('02-render-recovered');
      assert.equal(fixed.exit, 0); assert.equal(fixed.commentAction, 'updated');
      assert.equal(fixed.results.maps.find((map) => map.path.endsWith('/new.architecture.json')).status, 'new');
      c.assertViewer(fixed);
    },
  },
  {
    id: 'code-only', title: 'Code changed; map unchanged',
    description: 'A watched source file changes. The review asks whether the architecture changed, without asserting that it did.',
    async run(c) {
      c.write('src/order-handler.js', '// Simulated code-only revision: add request logging.\n'); c.commit('Change watched code');
      const r = await c.review('01-code-only');
      assert.equal(r.exit, 0); assert.equal(r.results.nudge, true);
      assert.match(r.comment, /Does the architecture change\?/);
      assert.doesNotMatch(r.comment, /interactive Before\/Delta\/After/);
    },
  },
  {
    id: 'invalid-repaired', title: 'An invalid map gets repaired',
    description: 'Commit an invalid map, observe a failing check with diagnostics, then fix it and update the same comment.',
    async run(c) {
      c.write(MAP, { meta: { title: 'Broken map' }, components: [] }); c.commit('Introduce invalid map');
      const invalid = await c.review('01-invalid');
      assert.equal(invalid.exit, 1); assert.equal(invalid.results.maps[0].status, 'invalid');
      assert.ok(invalid.results.maps[0].diagnostics.length); assert.match(invalid.comment, /fails archify validation/);
      c.write(MAP, proposed); c.commit('Repair map');
      const repaired = await c.review('02-repaired');
      assert.equal(repaired.exit, 0); assert.equal(repaired.commentAction, 'updated');
      assert.equal(c.api.comments.length, 1); assert.doesNotMatch(repaired.comment, /fails archify validation/);
      c.assertViewer(repaired);
    },
  },
];

export async function runScenario(scenario, { outputDir, archifyDir = path.join(ROOT, '.archify-vendor') }) {
  archifyDir = path.resolve(archifyDir);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-scenario-'));
  const directory = path.join(path.resolve(outputDir), scenario.id);
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo); fs.mkdirSync(directory, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), typeof content === 'string' ? content : encode(content));
  };
  const commit = (message) => { git('add', '-A'); git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', message); };
  const revisions = [];
  const api = commentApi();
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Archify demo'); git('config', 'user.email', 'demo@example.invalid');
    const mapPaths = scenario.maps ?? [MAP];
    for (const mapPath of mapPaths) write(mapPath, baseline);
    write('src/order-handler.js', '// Simulated source file; these demos do not run a service.\n');
    commit('Demo baseline');
    const baseSha = git('rev-parse', 'HEAD');
    const review = async (name, options = {}) => {
      const revisionDir = path.join(directory, name);
      // A fresh output directory prevents prior demo artifacts from masking failures.
      assert.ok(!fs.existsSync(revisionDir), 'Use a fresh output directory for each demo run');
      const result = spawnSync(process.execPath, [path.join(ROOT, 'src/compare.mjs')], {
        cwd: repo, encoding: 'utf8',
        env: { ...process.env, BASE_SHA: baseSha, ARCHIFY_DIR: options.archifyDir ?? archifyDir,
          MAP_GLOB: 'docs/architecture/*.architecture.json', NUDGE_PATHS: 'src/**', QUALITY: 'standard', OUTPUT_DIR: revisionDir },
      });
      if (result.error) throw result.error;
      fs.mkdirSync(revisionDir, { recursive: true });
      fs.writeFileSync(path.join(revisionDir, 'pipeline.log'), result.stdout + result.stderr);
      const results = JSON.parse(fs.readFileSync(path.join(revisionDir, 'results.json'), 'utf8'));
      const outcome = await upsertComment({ token: 'demo-unused', repository: 'demo/order-management', prNumber: 1,
        mode: 'on-change', results, runUrl: './', fetchImpl: api.fetchImpl });
      const comment = api.comments[0]?.body ?? buildComment(results, './');
      fs.writeFileSync(path.join(revisionDir, 'comment.md'), comment + '\n');
      fs.writeFileSync(path.join(revisionDir, 'github-events.json'), encode(api.events));
      const revision = { name, exit: result.status, directory: revisionDir, results, comment, commentAction: outcome.action,
        baseSha, headSha: git('rev-parse', 'HEAD'), simulatedCommentCount: api.comments.length };
      revisions.push(revision);
      return revision;
    };
    const assertViewer = (revision) => {
      const rendered = revision.results.maps.filter((map) => map.deltaHtml);
      assert.ok(rendered.length, 'At least one viewer must be generated');
      for (const map of rendered) assert.match(fs.readFileSync(path.join(revision.directory, map.deltaHtml), 'utf8'), /<svg[\s>]/i);
    };
    await scenario.run({ write, commit, review, assertViewer, api, temp, archifyDir, mapPaths });
    const report = { id: scenario.id, title: scenario.title, description: scenario.description, passed: true, revisions };
    fs.writeFileSync(path.join(directory, 'scenario.json'), encode(report));
    return report;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function writeReport(reports, outputDir) {
  const cards = reports.map((report) => `<section><h2>${escapeHtml(report.title)}</h2><p>${escapeHtml(report.description)}</p>${report.revisions.map((revision) => {
    const relative = `${report.id}/${revision.name}`;
    const links = revision.results.maps.filter((map) => map.deltaHtml).map((map) => `<a href="${relative}/${encodeURIComponent(map.deltaHtml)}">Open viewer: ${escapeHtml(map.path)}</a>`);
    return `<article><h3>${escapeHtml(revision.name)} <span class="${revision.exit === 0 ? 'ok' : 'failure'}">${revision.exit === 0 ? 'CHECK PASSES' : 'EXPECTED CHECK FAILURE'}</span></h3><p>Comment: ${escapeHtml(revision.commentAction)} · ${revision.simulatedCommentCount} comment in simulated PR</p><nav>${links.join('')}<a href="${relative}/results.json">Results JSON</a><a href="${relative}/comment.md">Comment Markdown</a><a href="${relative}/github-events.json">Simulated API calls</a></nav><details><summary>Read the PR comment</summary><pre>${escapeHtml(revision.comment)}</pre></details></article>`;
  }).join('')}</section>`).join('');
  fs.writeFileSync(path.join(outputDir, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Archify PR Action — scenario report</title><style>body{margin:0;background:#f4f6fa;color:#172338;font:16px/1.55 system-ui,sans-serif}main{max-width:1080px;margin:48px auto;padding:0 24px}h1{font-size:38px;line-height:1.15}h2{font-size:25px;margin-top:0}h3{font-size:17px}section{background:white;border:1px solid #dce2eb;border-radius:12px;padding:28px;margin:24px 0}article{border-top:1px solid #e4e8ef;padding:12px 0}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#2454aa}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:16px;border-radius:8px;font-size:13px}span{font-size:11px;padding:5px 8px;border-radius:5px;white-space:nowrap}.ok{background:#e2f5e9;color:#165633}.failure{background:#fff0d9;color:#774b09}summary{cursor:pointer;margin-top:16px}.intro{max-width:850px;color:#48566d}</style><main><p>ARCHIFY PR ACTION · LOCAL VERIFICATION</p><h1>Six scenarios. Nine review revisions.</h1><p class="intro">All ${reports.length} scenarios passed their assertions. These are simulated pull requests using real temporary Git repositories and the pinned Archify renderer. GitHub comment calls are simulated in memory; no PR was created or updated. One scenario deliberately injects a rendering failure. Expected failing checks are part of a passing scenario.</p>${cards}</main></html>`);
  fs.writeFileSync(path.join(outputDir, 'report.json'), encode(reports));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outputDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'examples/demo-app/out/scenarios-' + Date.now()));
  const archifyDir = path.resolve(process.env.ARCHIFY_DIR ?? path.join(ROOT, '.archify-vendor'));
  assert.ok(fs.existsSync(path.join(archifyDir, 'bin/archify.mjs')), 'Run bash scripts/vendor-archify.sh first');
  fs.mkdirSync(outputDir, { recursive: true });
  const reports = [];
  for (const scenario of scenarios) {
    reports.push(await runScenario(scenario, { outputDir, archifyDir }));
    console.log('PASS ' + scenario.title);
  }
  writeReport(reports, outputDir);
  console.log('Open ' + path.join(outputDir, 'index.html'));
}
