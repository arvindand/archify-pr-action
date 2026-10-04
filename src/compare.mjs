import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const env = (name, fallback) => process.env[name] ?? fallback;

const BASE_SHA = env('BASE_SHA');
const MAP_GLOB = env('MAP_GLOB', 'docs/architecture/*.architecture.json');
const NUDGE_PATHS = env('NUDGE_PATHS', 'src/**').split(/\s+/).filter(Boolean);
const QUALITY = env('QUALITY', 'standard');
const ARCHIFY_DIR = env('ARCHIFY_DIR', '.archify-vendor');
const OUTPUT_DIR = env('OUTPUT_DIR', 'archify-out');
const ARCHIFY_VERSION = 'v3.0.1';

if (!BASE_SHA) {
  console.error('BASE_SHA is required');
  process.exit(1);
}

const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
const gitLines = (...args) => git(...args).split('\n').map((line) => line.trim()).filter(Boolean);
const baseSha = git('rev-parse', '--verify', `${BASE_SHA}^{commit}`).trim();
const headSha = git('rev-parse', 'HEAD').trim();

function snapshot(revision, mapPath) {
  // ls-tree distinguishes an absent path from a Git/read error. Unexpected
  // failures must stop the review rather than report a deletion or a new map.
  const object = git('ls-tree', '--format=%(objectname)', revision, '--', mapPath).trim();
  if (!object) return null;
  return execFileSync('git', ['cat-file', 'blob', object], { maxBuffer: GIT_MAX_BUFFER });
}

function archify(args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(ARCHIFY_DIR, 'bin', 'archify.mjs'), ...args], {
      encoding: 'utf8',
      // The renderer is pinned; delivery must not make advisory update requests.
      env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function diagnosticsFrom(stdout, fallbackPrefix) {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed.diagnostics) && parsed.diagnostics.length) return parsed.diagnostics;
  } catch { /* not JSON — fall through */ }
  return [{ message: `${fallbackPrefix}: ${stdout.slice(0, 2000)}` }];
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const currentMaps = gitLines('ls-files', '--', MAP_GLOB);
const changedMaps = gitLines('diff', '--name-only', baseSha, headSha, '--', MAP_GLOB);
const allMaps = [...new Set([...currentMaps, ...changedMaps])].sort();
const changedCodePaths = NUDGE_PATHS.length
  ? gitLines('diff', '--name-only', baseSha, headSha, '--', ...NUDGE_PATHS)
  : [];

let failed = false;
const maps = [];

for (const mapPath of allMaps) {
  const headContent = snapshot(headSha, mapPath);
  const headExists = headContent !== null;
  const baseContent = snapshot(baseSha, mapPath);
  if (!headExists && baseContent === null) continue;
  // Include the repository-relative path so equal basenames cannot share outputs.
  const pathHash = createHash('sha256').update(mapPath).digest('hex').slice(0, 16);
  const slug = `${path.basename(mapPath).replace(/\.json$/, '')}-${pathHash}`;
  const entry = { path: mapPath, status: 'unchanged', summary: null, changes: null, deltaHtml: null, diagnostics: [] };
  // Read both committed snapshots, so the reported SHAs describe the inputs.
  const headPath = path.join(OUTPUT_DIR, `head-${slug}.json`);
  if (headExists && (baseContent === null || changedMaps.includes(mapPath))) fs.writeFileSync(headPath, headContent);

  if (!headExists && baseContent !== null) {
    entry.status = 'deleted';
  } else if (headExists && baseContent === null) {
    const validation = archify(['validate', 'architecture', headPath, '--quality', QUALITY, '--json']);
    if (validation.status !== 0) {
      entry.status = 'invalid';
      entry.diagnostics = diagnosticsFrom(validation.stdout, 'validate failed');
      failed = true;
    } else {
      entry.status = 'new';
      const htmlName = `render-${slug}.html`;
      const deliver = archify(['deliver', 'architecture', headPath, path.join(OUTPUT_DIR, htmlName), '--quality', QUALITY, '--json']);
      if (deliver.status === 0) entry.deltaHtml = htmlName;
      else {
        entry.status = 'render-failed';
        entry.diagnostics = diagnosticsFrom(deliver.stdout, 'deliver failed');
        failed = true;
      }
    }
  } else if (headExists && changedMaps.includes(mapPath)) {
    const validation = archify(['validate', 'architecture', headPath, '--quality', QUALITY, '--json']);
    if (validation.status !== 0) {
      entry.status = 'invalid';
      entry.diagnostics = diagnosticsFrom(validation.stdout, 'validate failed');
      failed = true;
    } else {
      const basePath = path.join(OUTPUT_DIR, `base-${slug}.json`);
      fs.writeFileSync(basePath, baseContent);
      const baseValidation = archify(['validate', 'architecture', basePath, '--quality', QUALITY, '--json']);
      if (baseValidation.status !== 0) {
        entry.status = 'base-invalid';
        entry.diagnostics = diagnosticsFrom(baseValidation.stdout, 'base validate failed');
      } else {
        const htmlName = `delta-${slug}.html`;
        const receiptPath = path.join(OUTPUT_DIR, `receipt-${slug}.json`);
        const compare = archify([
          'compare', 'architecture', basePath, headPath,
          path.join(OUTPUT_DIR, htmlName), '--receipt', receiptPath,
          '--quality', QUALITY, '--json',
        ]);
        if (compare.status !== 0) {
          entry.status = 'compare-failed';
          entry.diagnostics = diagnosticsFrom(compare.stdout, 'compare failed');
          failed = true;
        } else {
          try {
            const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
            if (receipt.ok !== true || receipt.command !== 'compare' || receipt.type !== 'architecture'
              || receipt.schemaVersion !== 1 || receipt.completeness !== 'complete'
              || !receipt.summary || !receipt.changes) throw new Error('Expected a complete architecture comparison receipt.');
            entry.status = 'changed';
            for (const key of ['summary', 'changes', 'base', 'head', 'proofLevel', 'completeness', 'provenance']) {
              entry[key] = receipt[key] ?? null;
            }
            entry.deltaHtml = htmlName;
          } catch (error) {
            entry.status = 'compare-failed';
            entry.diagnostics = [{ code: 'action/compare-receipt', message: error.message }];
            failed = true;
          }
        }
      }
    }
  }
  maps.push(entry);
}

const results = {
  archifyVersion: ARCHIFY_VERSION,
  baseSha,
  headSha,
  nudge: changedCodePaths.length > 0 && !maps.some((map) => map.status !== 'unchanged'),
  changedCodePaths,
  maps,
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(maps.map((map) => ({ path: map.path, status: map.status })), null, 2));
process.exit(failed ? 1 : 0);
