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
const { runFix, runFixFlow } = await import('../src/fix/commands.mjs');
const { FIX_POLICY } = await import('../src/fix/policy.mjs');
const { applyEdits } = await import('../src/fix/apply.mjs');
const { createProgressWriter, readProgress } = await import('../src/report/progress.mjs');

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

test('fix --findings: only the chosen findings are fixed, an earlier fix is cleared, unknown ids are rejected', async () => {
  const { tmp, runDir, patched } = await makeRun();
  try {
    await runFix({ run: runDir, patched }, { client: fakeClient([toastEdit]) }); // F1 fixed
    const { fixes } = await runFix({ run: runDir, patched, findings: 'F4,F2' }, { client: fakeClient([missingEdit]) });
    assert.deepEqual(fixes.map((f) => f.finding).sort(), ['F2', 'F4'], 'a chosen degrade finding is fixed too; F1 is not');
    const report = readJSON(path.join(runDir, 'report.json'));
    assert.equal(report.findings.find((f) => f.id === 'F1').fix, null, 'patched/ was rebuilt without F1, so its old fix must not be shown');
    assert.doesNotMatch(fs.readFileSync(path.join(patched, 'index.html'), 'utf8'), /role="status"/);
    await assert.rejects(runFix({ run: runDir, patched, findings: 'F4,F99' }, { client: fakeClient([]) }), /F99/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fix refuses a patched copy that is (or contains) the site itself', async () => {
  const { tmp, runDir } = await makeRun();
  const originalSrc = fs.readFileSync(ORIGINAL, 'utf8');
  try {
    for (const patched of ['sites/testpage/original', 'sites/testpage']) {
      await assert.rejects(runFix({ run: runDir, patched }, { client: fakeClient([toastEdit]) }), /patched copy/);
    }
    assert.equal(fs.readFileSync(ORIGINAL, 'utf8'), originalSrc);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('report.fixPolicy: enforced rules are cited by apply.mjs, instructed rules are quoted from the fixer prompt', async () => {
  const { tmp, runDir, patched } = await makeRun();
  try {
    await runFix({ run: runDir, patched }, { client: fakeClient([toastEdit]) });
    assert.deepEqual(readJSON(path.join(runDir, 'report.json')).fixPolicy, FIX_POLICY);
    const rule = Object.fromEntries(FIX_POLICY.enforced.map((r) => [r.id, r.rule]));
    assert.deepEqual(Object.keys(rule).sort(), ['keep-visible-text', 'site-copy-only', 'unique-match']);
    const errorFor = (edit) => applyEdits(patched, [edit]).errors[0];
    assert.ok(errorFor({ file: 'index.html', old: "carderr.textContent = ok ? '' : 'Card number is invalid';", new: "carderr.textContent = '';" })
      .includes(rule['keep-visible-text']));
    assert.ok(errorFor({ file: 'index.html', old: '<', new: '<' }).includes(rule['unique-match']));
    assert.ok(errorFor({ file: '../original/index.html', old: 'x', new: 'y' }).includes(rule['site-copy-only']));
    assert.deepEqual(readJSON(path.join(ROOT, 'docs/report.example.json')).fixPolicy, FIX_POLICY, 'docs/report.example.json shows the real policy');
    const prompt = fs.readFileSync(path.join(ROOT, 'src/agent/prompts/fixer.md'), 'utf8');
    assert.ok(FIX_POLICY.instructed.length > 0);
    for (const r of FIX_POLICY.instructed) assert.ok(prompt.includes(r.rule), `instructed rule is not in the fixer prompt: ${r.rule}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Replays a recorded trace as the rerun's browser session (no browser, no planner: the trace's own actions are the script).
const fixedTrace = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-fixed/trace.jsonl'), 'utf8'));
const replaySession = (steps) => async () => {
  let k = 0;
  return { start: async () => steps[k++], step: async () => steps[k++], axeResults: () => ({ violations: [] }), close: async () => {} };
};
const rerunOpts = { script: fixedTrace.slice(1).map((s) => s.action), openSession: replaySession(fixedTrace) };
const tryProgress = (dir) => { try { return readProgress(dir); } catch { return null; } };

test('fix + rerun with progress: fixing → rerunning (rerun dir already has its progress) → done; rerun written back', async () => {
  const { tmp, runDir, patched } = await makeRun();
  const originalSteps = readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8')).length;
  const seen = [];
  const progressFor = (dir) => {
    const write = createProgressWriter(dir);
    return (u) => {
      write(u);
      const p = readProgress(dir);
      seen.push({ dir, state: p.state, steps: p.timeline.length, rerunDir: p.rerunDir, rerunProgress: p.rerunDir ? tryProgress(path.join(tmp, p.rerunDir)) : null });
    };
  };
  try {
    const { rerun } = await runFixFlow({ run: runDir, patched, rerun: true, out: tmp, 'no-judge': true },
      { client: fakeClient([toastEdit]), progressFor, ...rerunOpts });
    const own = seen.filter((s) => s.dir === runDir);
    assert.deepEqual(own.map((s) => s.state), ['fixing', 'rerunning', 'done']);
    assert.ok(own.every((s) => s.steps === originalSteps), 'the audit timeline stays visible while fixing');
    const { rerunDir, rerunProgress } = own[1];
    assert.match(rerunDir, /^[\w.-]+-rerun$/);
    assert.deepEqual([rerunProgress?.state, rerunProgress?.timeline], ['running', []], 'rerun progress.json must exist before rerunDir is published');
    assert.equal(own[2].rerunDir, rerunDir, 'done keeps rerunDir');
    const rerunStates = seen.filter((s) => s.dir === path.join(tmp, rerunDir)).map((s) => s.state);
    assert.deepEqual([...new Set(rerunStates)], ['running', 'analyzing', 'done']);
    const report = readJSON(path.join(runDir, 'report.json'));
    assert.deepEqual(report.rerun, rerun);
    assert.equal(rerun.closedLoop, true);
    assert.equal(path.basename(rerun.runDir), rerunDir);
    assert.ok(!path.isAbsolute(rerun.runDir));
    assert.equal(report.fixes.find((f) => f.finding === 'F1').applied, 1);
    assert.ok(report.fixPolicy);
    const rerunMeta = readJSON(path.join(tmp, rerunDir, 'report.json')).meta;
    assert.equal(rerunMeta.url, 'http://localhost:8080/testpage/patched/');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fix + rerun: a failing rerun marks both the rerun and the original run failed', async () => {
  const { tmp, runDir, patched } = await makeRun();
  const broken = async () => ({ start: async () => fixedTrace[0], step: async () => { throw new Error('page crashed\nstack'); },
    axeResults: () => null, close: async () => {} });
  try {
    await assert.rejects(runFixFlow({ run: runDir, patched, rerun: true, out: tmp, 'no-judge': true },
      { client: fakeClient([toastEdit]), progressFor: createProgressWriter, script: rerunOpts.script, openSession: broken }), /page crashed/);
    const p = readProgress(runDir);
    assert.equal(p.state, 'failed');
    assert.equal(p.error, 'page crashed');
    assert.equal(readProgress(path.join(tmp, p.rerunDir)).state, 'failed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fix without rerun: fixing → done, report.rerun is null', async () => {
  const { tmp, runDir, patched } = await makeRun();
  const states = [];
  const progressFor = (dir) => { const w = createProgressWriter(dir); return (u) => { w(u); states.push(readProgress(dir).state); }; };
  try {
    const { rerun } = await runFixFlow({ run: runDir, patched }, { client: fakeClient([toastEdit]), progressFor });
    assert.equal(rerun, null);
    assert.deepEqual(states, ['fixing', 'done']);
    assert.equal(readJSON(path.join(runDir, 'report.json')).rerun, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
