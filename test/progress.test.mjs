// progress.json (plan 17): atomic writes, one timeline conversion shared with report.json, state order, schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../src/paths.mjs';
import { readTrace, MAX_STEPS, MAX_STEPS_REAL } from '../src/contracts.mjs';
import { audit } from '../src/audit.mjs';
import { buildReport } from '../src/report/build.mjs';
import { writeJsonAtomic } from '../src/report/atomic.mjs';
import { createProgressWriter, markFailedIfUnfinished, readProgress } from '../src/report/progress.mjs';

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(readJSON('docs/report.schema.json'));
const validate = ajv.compile(readJSON('docs/progress.schema.json'));
function assertValid(progress, label) {
  if (!validate(progress)) assert.fail(`${label} does not match docs/progress.schema.json:\n${JSON.stringify(validate.errors, null, 2)}`);
}

const trace = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));

test('writeJsonAtomic: writes via a temp file in the same dir and leaves no .tmp behind', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'x.json');
  const renames = [];
  const origRename = fs.renameSync;
  fs.renameSync = (a, b) => { renames.push([a, b]); return origRename(a, b); };
  try { writeJsonAtomic(file, { a: 1 }); } finally { fs.renameSync = origRename; }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  assert.equal(renames.length, 1);
  assert.equal(path.dirname(renames[0][0]), dir, 'temp file must be in the same directory (rename is atomic only within a filesystem)');
  assert.equal(renames[0][1], file);
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('progress writer: every state matches progress.schema.json and keeps the timeline', () => {
  const dir = tmpDir();
  const write = createProgressWriter(dir);
  write({ state: 'running', trace: [] });
  let p = readProgress(dir);
  assertValid(p, 'initial');
  assert.deepEqual({ state: p.state, step: p.step, maxSteps: p.maxSteps, timeline: p.timeline, rerunDir: p.rerunDir, error: p.error },
    { state: 'running', step: null, maxSteps: MAX_STEPS, timeline: [], rerunDir: null, error: null });
  write({ state: 'running', trace: trace.slice(0, 3) });
  p = readProgress(dir);
  assertValid(p, 'running');
  assert.equal(p.step, 2);
  assert.deepEqual(p.timeline.map((t) => t.i), [0, 1, 2]);
  assert.ok(p.timeline.every((t) => Array.isArray(t.findingIds) && t.findingIds.length === 0));
  write({ state: 'analyzing', trace });
  assertValid(readProgress(dir), 'analyzing');
  write({ state: 'failed', error: 'judge exploded' }); // no trace passed: the last timeline is kept
  p = readProgress(dir);
  assertValid(p, 'failed');
  assert.equal(p.error, 'judge exploded');
  assert.equal(p.timeline.length, trace.length);
});

test('markFailedIfUnfinished: marks a running progress failed, keeps its timeline, never touches done', () => {
  const dir = tmpDir();
  createProgressWriter(dir)({ state: 'running', trace: trace.slice(0, 2) });
  assert.equal(markFailedIfUnfinished(dir, 'The audit process crashed.'), true);
  const p = readProgress(dir);
  assertValid(p, 'crashed');
  assert.equal(p.state, 'failed');
  assert.equal(p.error, 'The audit process crashed.');
  assert.equal(p.timeline.length, 2);
  createProgressWriter(dir)({ state: 'done', trace });
  assert.equal(markFailedIfUnfinished(dir, 'late exit'), false);
  assert.equal(readProgress(dir).state, 'done');
});

test('markFailedIfUnfinished: a missing or unreadable progress.json is replaced by a failed one', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'progress.json'), '{"state":"runn');
  assert.equal(markFailedIfUnfinished(dir, 'crashed'), true);
  const p = readProgress(dir);
  assertValid(p, 'replaced');
  assert.equal(p.state, 'failed');
});

// Replays the fixture trace through audit() with a fake session: the real orchestration, no browser.
function fakeSession() {
  let k = 0;
  return async () => ({
    start: async () => trace[k++],
    step: async () => trace[k++],
    axeResults: () => ({ violations: [] }),
    close: async () => {},
  });
}

test('audit(): progress goes running… → analyzing → done, report.json exists before done, timelines agree', async () => {
  const runDir = tmpDir();
  const seen = [];
  const write = createProgressWriter(runDir);
  const onProgress = (u) => {
    write(u);
    const p = readProgress(runDir);
    assertValid(p, `state ${p.state}`);
    seen.push({ state: p.state, step: p.step, reportExists: fs.existsSync(path.join(runDir, 'report.json')) });
  };
  const { report } = await audit({ url: 'http://localhost:8080/testpage/original/', goal: 'Buy the canvas tote bag', runDir,
    script: trace.slice(1).map((s) => s.action), judgeEnabled: false, onProgress, openSession: fakeSession() });
  const states = seen.map((s) => s.state);
  assert.deepEqual(states, ['running', ...trace.map(() => 'running'), 'analyzing', 'done'], 'first running is written before the session opens');
  assert.deepEqual(seen.filter((s) => s.state === 'running').map((s) => s.step), [null, ...trace.map((s) => s.i)]);
  assert.ok(seen.filter((s) => s.state !== 'done').every((s) => !s.reportExists), 'report.json appeared before analysis finished');
  assert.ok(seen.at(-1).reportExists, 'done was written before report.json');
  const final = readProgress(runDir);
  assert.deepEqual(final.timeline, report.timeline.map((t) => ({ ...t, findingIds: [] })),
    'progress timeline must be built by the same function as report.timeline');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8')), JSON.parse(JSON.stringify(report)));
});

test('audit(): a failure mid-run writes failed with a one-line error and rethrows', async () => {
  const runDir = tmpDir();
  const write = createProgressWriter(runDir);
  const broken = async () => ({ start: async () => trace[0], step: async () => { throw new Error('page crashed\nstack…'); },
    axeResults: () => null, close: async () => {} });
  await assert.rejects(audit({ url: 'http://x/', goal: 'g', runDir, script: [{ kind: 'press', key: 'Tab', reason: 'x' }],
    judgeEnabled: false, onProgress: write, openSession: broken }), /page crashed/);
  const p = readProgress(runDir);
  assertValid(p, 'failed');
  assert.equal(p.state, 'failed');
  assert.equal(p.error, 'page crashed');
  assert.equal(p.timeline.length, 1);
});

test('audit(): runDir must already exist when given', async () => {
  await assert.rejects(audit({ url: 'http://x/', goal: 'g', runDir: path.join(os.tmpdir(), 'no-such-run-dir-17'), openSession: fakeSession() }), /no-such-run-dir-17/);
});

test('audit(): real mode writes its own step limit into every progress.json state', async () => {
  const runDir = tmpDir();
  const write = createProgressWriter(runDir);
  const limits = [];
  await audit({ mode: 'real', goal: 'g', runDir, script: [{ kind: 'press', key: 'Tab', reason: 'x' }], judgeEnabled: false,
    onProgress: (u) => { write(u); limits.push(readProgress(runDir).maxSteps); }, openSession: fakeSession() });
  assert.ok(limits.length > 3 && limits.every((m) => m === MAX_STEPS_REAL), `maxSteps written: ${limits.join(', ')}`);
  assert.equal(markFailedIfUnfinished(runDir, 'x'), false);
  fs.writeFileSync(path.join(runDir, 'progress.json'), JSON.stringify({ ...readProgress(runDir), state: 'running' }));
  markFailedIfUnfinished(runDir, 'crashed');
  assert.equal(readProgress(runDir).maxSteps, MAX_STEPS_REAL, 'a crashed real run keeps its limit');
});

// ---- P2: meta.startedAt / finishedAt / maxSteps, timeline[].t, url + goal in progress.json ----

test('audit(): meta has startedAt ≤ finishedAt ≤ generatedAt and maxSteps; timeline[].t is ms since step 0', async () => {
  const runDir = tmpDir();
  const before = new Date().toISOString();
  const { report } = await audit({ url: 'http://localhost:8080/testpage/original/', goal: 'Buy the canvas tote bag', runDir,
    script: trace.slice(1).map((s) => s.action), judgeEnabled: false, openSession: fakeSession() });
  const { startedAt, finishedAt, generatedAt, maxSteps } = report.meta;
  assert.ok(before <= startedAt && startedAt <= finishedAt && finishedAt <= generatedAt, `${before} ${startedAt} ${finishedAt} ${generatedAt}`);
  assert.equal(maxSteps, MAX_STEPS);
  assert.deepEqual(report.timeline.map((s) => s.t), trace.map((s) => s.t - trace[0].t));
  assert.equal(report.timeline[0].t, 0);
});

test('audit(): real mode meta.maxSteps is the real-mode limit', async () => {
  const { report } = await audit({ mode: 'real', goal: 'g', runDir: tmpDir(), script: [{ kind: 'press', key: 'Tab', reason: 'x' }],
    judgeEnabled: false, openSession: fakeSession() });
  assert.equal(report.meta.maxSteps, MAX_STEPS_REAL);
});

test('timeline[].t is null for a step without a timestamp', () => {
  const noTime = trace.map(({ t, ...s }) => (s.i === 2 ? s : { ...s, t }));
  const r = buildReport({ meta: { goal: 'g' }, trace: noTime, findings: [] });
  assert.equal(r.timeline[2].t, null);
  assert.equal(r.timeline[3].t, trace[3].t - trace[0].t);
});

test('progress.json carries the audit url and goal (null until known); markFailedIfUnfinished keeps them', async () => {
  const runDir = tmpDir();
  const write = createProgressWriter(runDir);
  write({ state: 'fixing', trace: [] });
  assert.equal(readProgress(runDir).url, null);
  const url = 'http://localhost:8080/testpage/original/';
  await audit({ url, goal: 'Buy the canvas tote bag', runDir, script: trace.slice(1).map((s) => s.action), judgeEnabled: false,
    onProgress: (u) => { write(u); const p = readProgress(runDir); assertValid(p, p.state); assert.equal(p.url, url); assert.equal(p.goal, 'Buy the canvas tote bag'); },
    openSession: fakeSession() });
  fs.writeFileSync(path.join(runDir, 'progress.json'), JSON.stringify({ ...readProgress(runDir), state: 'running' }));
  markFailedIfUnfinished(runDir, 'crashed');
  assert.equal(readProgress(runDir).goal, 'Buy the canvas tote bag');
});

// ---- plan 17 frontend feedback: first progress.json before the session opens; waiting_for_user in real mode ----

/** fakeSession() that snapshots progress.json when opened and while the human is "solving the captcha". */
function watchedSession(runDir, seen) {
  const inner = fakeSession();
  return async (o) => {
    seen.atOpen = fs.existsSync(path.join(runDir, 'progress.json')) ? readProgress(runDir) : null;
    if (o.mode === 'real') await o.waitForUser?.();
    return inner(o);
  };
}

test('audit(): the first progress.json (running, goal, maxSteps, url) is written before the session opens', async () => {
  const runDir = tmpDir();
  const seen = {};
  const url = 'http://localhost:8080/testpage/original/';
  await audit({ url, goal: 'Buy the canvas tote bag', runDir, script: trace.slice(1).map((s) => s.action), judgeEnabled: false,
    onProgress: createProgressWriter(runDir), openSession: watchedSession(runDir, seen) });
  assert.ok(seen.atOpen, 'no progress.json when the session opened');
  assertValid(seen.atOpen, 'first progress');
  assert.deepEqual([seen.atOpen.state, seen.atOpen.goal, seen.atOpen.url, seen.atOpen.maxSteps, seen.atOpen.timeline],
    ['running', 'Buy the canvas tote bag', url, MAX_STEPS, []]);
});

test('audit(): real mode is waiting_for_user until the human presses Enter, then running (planning_task without a goal)', async () => {
  for (const goal of ['g', undefined]) {
    const runDir = tmpDir();
    const seen = {};
    const write = createProgressWriter(runDir);
    const states = [];
    const waitForUser = async () => { seen.duringWait = readProgress(runDir); };
    await audit({ mode: 'real', goal, runDir, script: [{ kind: 'press', key: 'Tab', reason: 'x' }], judgeEnabled: false, waitForUser,
      site: 'testpage', onProgress: (u) => { write(u); states.push(readProgress(runDir).state); assertValid(readProgress(runDir), u.state); },
      openSession: watchedSession(runDir, seen) }).catch((e) => { if (goal) throw e; }); // no goal: the tasker may fail offline, that is fine here
    for (const p of [seen.atOpen, seen.duringWait]) {
      assert.deepEqual([p.state, p.url, p.goal ?? null, p.maxSteps], ['waiting_for_user', null, goal ?? null, MAX_STEPS_REAL], `goal ${goal}`);
    }
    assert.equal(states[0], 'waiting_for_user');
    assert.equal(states[1], goal ? 'running' : 'planning_task', `after Enter: ${states.join(' → ')}`);
    assert.ok(!states.slice(1).includes('waiting_for_user'), states.join(' → '));
  }
});

test('cli audit --mode real --progress: progress.json is waiting_for_user (goal, maxSteps, url null) while Chrome is still being attached', async () => {
  const { spawn } = await import('node:child_process');
  const net = await import('node:net');
  const socks = [];
  const hang = net.createServer((s) => socks.push(s)); // accepts the CDP connection and never answers: openSession() never returns
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const out = tmpDir();
  const child = spawn(process.execPath, [path.join(ROOT, 'cli.mjs'), 'audit', '--mode', 'real', '--cdp', `http://127.0.0.1:${hang.address().port}`,
    '--goal', 'Buy socks', '--progress', '--out', out], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    let p = null;
    for (let k = 0; k < 100 && !p; k++) {
      const [dir] = fs.readdirSync(out);
      if (dir && fs.existsSync(path.join(out, dir, 'progress.json'))) p = readProgress(path.join(out, dir));
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(p, 'no progress.json within 10 s');
    assertValid(p, 'cli first progress');
    assert.deepEqual([p.state, p.goal, p.url, p.maxSteps, p.step], ['waiting_for_user', 'Buy socks', null, MAX_STEPS_REAL, null]);
  } finally {
    child.kill('SIGKILL');
    hang.close();
    for (const s of socks) s.destroy();
  }
});
