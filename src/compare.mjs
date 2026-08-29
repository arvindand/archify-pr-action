import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = (name, fallback) => process.env[name] ?? fallback;

const BASE_SHA = env('BASE_SHA');
const MAP_GLOB = env('MAP_GLOB', 'docs/architecture/*.architecture.json');
const NUDGE_PATHS = env('NUDGE_PATHS', 'src/**').split(/\s+/).filter(Boolean);
const QUALITY = env('QUALITY', 'standard');
const ARCHIFY_DIR = env('ARCHIFY_DIR', '.archify-vendor');
const OUTPUT_DIR = env('OUTPUT_DIR', 'archify-out');
const ARCHIFY_VERSION = 'v2.15.0';

if (!BASE_SHA) {
  console.error('BASE_SHA is required');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const gitLines = (...args) => git(...args).split('\n').map((line) => line.trim()).filter(Boolean);

function archify(args) {
  try {
    const stdout = execFileSync('node', [path.join(ARCHIFY_DIR, 'bin', 'archify.mjs'), ...args], { encoding: 'utf8' });
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
const changedMaps = gitLines('diff', '--name-only', BASE_SHA, 'HEAD', '--', MAP_GLOB);
const allMaps = [...new Set([...currentMaps, ...changedMaps])].sort();
const changedCodePaths = NUDGE_PATHS.length
  ? gitLines('diff', '--name-only', BASE_SHA, 'HEAD', '--', ...NUDGE_PATHS)
  : [];

let failed = false;
const maps = [];

for (const mapPath of allMaps) {
  const headExists = fs.existsSync(mapPath);
  let baseContent = null;
  try {
    baseContent = git('show', `${BASE_SHA}:${mapPath}`);
  } catch {
    baseContent = null;
  }
  const slug = path.basename(mapPath).replace(/\.json$/, '');
  const entry = { path: mapPath, status: 'unchanged', summary: null, changes: null, deltaHtml: null, diagnostics: [] };

  if (!headExists && baseContent !== null) {
    entry.status = 'deleted';
  } else if (headExists && baseContent === null) {
    const validation = archify(['validate', 'architecture', mapPath, '--quality', QUALITY, '--json']);
    if (validation.status !== 0) {
      entry.status = 'invalid';
      entry.diagnostics = diagnosticsFrom(validation.stdout, 'validate failed');
      failed = true;
    } else {
      entry.status = 'new';
      const htmlName = `render-${slug}.html`;
      const deliver = archify(['deliver', 'architecture', mapPath, path.join(OUTPUT_DIR, htmlName), '--quality', QUALITY, '--json']);
      if (deliver.status === 0) entry.deltaHtml = htmlName;
      else entry.diagnostics = diagnosticsFrom(deliver.stdout, 'deliver failed');
    }
  } else if (headExists && changedMaps.includes(mapPath)) {
    const validation = archify(['validate', 'architecture', mapPath, '--quality', QUALITY, '--json']);
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
          'compare', 'architecture', basePath, mapPath,
          path.join(OUTPUT_DIR, htmlName), '--receipt', receiptPath,
          '--quality', QUALITY, '--json',
        ]);
        if (compare.status !== 0) {
          entry.status = 'invalid';
          entry.diagnostics = diagnosticsFrom(compare.stdout, 'compare failed');
          failed = true;
        } else {
          const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
          entry.status = 'changed';
          entry.summary = receipt.summary ?? null;
          entry.changes = receipt.changes ?? null;
          entry.deltaHtml = htmlName;
        }
      }
    }
  }
  maps.push(entry);
}

const results = {
  archifyVersion: ARCHIFY_VERSION,
  nudge: changedCodePaths.length > 0 && !maps.some((map) => map.status !== 'unchanged'),
  changedCodePaths,
  maps,
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(maps.map((map) => ({ path: map.path, status: map.status })), null, 2));
process.exit(failed ? 1 : 0);
