import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scenarios, runScenario } from '../scripts/demo-scenarios.mjs';

for (const scenario of scenarios) {
  test('demo scenario: ' + scenario.title, async (t) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-scenario-output-'));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
    await runScenario(scenario, { outputDir, archifyDir: process.env.ARCHIFY_DIR });
  });
}
