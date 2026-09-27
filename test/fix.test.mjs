// `fix` command with a fake LLM client (no network, no cache): patched copy + fix plan written back into report.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set before llm.mjs loads .env: dotenv never overrides variables that already exist.
process.env.LLM_CACHE = 'off';
process.env.MODEL_JUDGE = 'fake-model';
const { ROOT } = await import('../src/paths.mjs');
const { readTrace } = await import('../src/contracts.mjs');
const { analyze } = await import('../src/audit.mjs');
const { runFix } = await import('../src/fix/commands.mjs');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ORIGINAL = path.join(ROOT, 'sites/testpage/original/index.html');

/** Fake OpenAI client that always proposes the same edits. */
const fakeClient = (edits) => ({ chat: { completions: { create: async () => (
  { choices: [{ message: { content: JSON.stringify({ edits, rationale: 'announce the toast' }) } }] }) } } });

const toastEdit = { file: 'index.html', old: '<div id="toast" data-barrier="T2"></div>', new: '<div id="toast" data-barrier="T2" role="status"></div>' };
const missingEdit = { file: 'index.html', old: '<p id="nope">', new: '<p id="nope" role="alert">' };

/** A run folder like `audit` leaves behind, built from the recorded original-page trace. F1 is made a block finding too. */
async function makeRun() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-'));
  const runDir = path.join(tmp, 'run');
  fs.mkdirSync(runDir);
  fs.copyFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), path.join(runDir, 'trace.jsonl'));
  const trace = readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8'));
  const meta = { url: 'http://localhost:8080/testpage/original/', mode: 'local', site: 'sites/testpage/original', script: true };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, goal: 'buy' }));
  fs.writeFileSync(path.join(runDir, 'axe.json'), JSON.stringify({ violations: [] }));
  await analyze({ trace, goal: 'buy', meta, runDir, judgeEnabled: false, axe: { violations: [] }, stats: { calls: 3 } });
  const findings = readJSON(path.join(runDir, 'findings.json'));
  findings.find((f) => f.id === 'F1').impact = 'block';
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings));
  return { tmp, runDir, patched: path.join(tmp, 'patched') };
}

test('fix writes the applied fix plan back into report.json, from any working directory', async () => {
  const { tmp, runDir, patched } = await makeRun();
  const originalSrc = fs.readFileSync(ORIGINAL, 'utf8');
  const cwd = process.cwd();
  process.chdir(tmp); // meta.site is repo-relative: must not depend on cwd
  try {
    const { fixes } = await runFix({ run: runDir, patched }, { client: fakeClient([toastEdit, missingEdit]) });
    const report = readJSON(path.join(runDir, 'report.json'));
    assert.deepEqual(report.fixes, fixes);
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
    const f1 = fixes.find((x) => x.finding === 'F1');
    assert.equal(f1.applied, 1);
    assert.deepEqual(byId.F1.fix, { edits: [toastEdit], rationale: 'announce the toast' }, 'only edits that were applied are shown as the diff');
    assert.equal(fixes.find((x) => x.finding === 'F4').applied, 0);
    assert.equal(byId.F4.fix, null, 'no edit applied → no fix shown; the reason is in fixes[].errors');
    assert.equal(byId.F2.fix, null, 'degrade findings are not fixed');
    assert.equal(report.meta.judge, false, 'meta of the original report is kept');
    assert.deepEqual(report.stats, { calls: 3 }, 'stats of the original report are kept');
    assert.equal(report.rerun, null);
    assert.deepEqual(readJSON(path.join(runDir, 'findings.json')).find((f) => f.id === 'F1').fix, byId.F1.fix);
    assert.match(fs.readFileSync(path.join(patched, 'index.html'), 'utf8'), /role="status"/);
    assert.equal(fs.readFileSync(ORIGINAL, 'utf8'), originalSrc, 'original site untouched');
    assert.match(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /Task audit/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fix never applies an edit that deletes visible text', async () => {
  const { tmp, runDir, patched } = await makeRun();
  try {
    const del = { file: 'index.html', old: "carderr.textContent = ok ? '' : 'Card number is invalid';", new: "carderr.textContent = '';" };
    const { fixes } = await runFix({ run: runDir, patched }, { client: fakeClient([del]) });
    assert.ok(fixes.every((f) => f.applied === 0 && f.errors.some((e) => /removes visible text/.test(e))));
    assert.match(fs.readFileSync(path.join(patched, 'index.html'), 'utf8'), /Card number is invalid/);
    assert.ok(readJSON(path.join(runDir, 'report.json')).findings.every((f) => f.fix === null));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
