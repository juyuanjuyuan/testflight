// progress.json (plan 17): atomic writes, one timeline conversion shared with report.json, state order, schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../src/paths.mjs';
import { readTrace, MAX_STEPS } from '../src/contracts.mjs';
import { audit } from '../src/audit.mjs';
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
  assert.deepEqual(states, [...trace.map(() => 'running'), 'analyzing', 'done']);
  assert.deepEqual(seen.filter((s) => s.state === 'running').map((s) => s.step), trace.map((s) => s.i));
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
