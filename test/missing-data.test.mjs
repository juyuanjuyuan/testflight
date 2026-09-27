// A demo run with goal "buy one thing" got stuck at the card field (no card in the goal) and the report said a screen
// reader user cannot complete the task. Missing test data is not a barrier of the site:
//  1. local sites with a test-data config get its values appended to a user goal that has no digits;
//  2. a stuck caused by missing data makes both headline verdicts null (inconclusive), findings are kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LLM_CACHE = 'off';
const { ROOT } = await import('../src/paths.mjs');
const { readTrace, FABRICATED_REASON, MISSING_DATA_PREFIX } = await import('../src/contracts.mjs');
const { computeVerdicts } = await import('../src/verdicts.mjs');
const { reportMarkdown, buildReport } = await import('../src/report/build.mjs');
const { compareRuns } = await import('../src/report/compare.mjs');
const { typedValueInGoal } = await import('../src/agent/planner.mjs');
const { appendTestData } = await import('../src/agent/tasker.mjs');
const { audit } = await import('../src/audit.mjs');
const { createProgressWriter, readProgress } = await import('../src/report/progress.mjs');

const trace = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));
const endingWith = (action) => [...trace.slice(0, -1), { ...trace.at(-1), action }];
const block = { id: 'F1', impact: 'block', steps: [3] };
const SHOP = 'http://localhost:8080/shop/original/';
const DEMO_STUCK = 'Card number field is required but the goal does not provide a value to enter.';

test('verdicts: a planner stuck with reason "missing data: …" is inconclusive (null), block findings are kept', () => {
  const v = computeVerdicts(endingWith({ kind: 'stuck', reason: `${MISSING_DATA_PREFIX} ${DEMO_STUCK}` }), [block]);
  assert.equal(v.outcome, 'stuck');
  assert.equal(v.agentCanComplete, null);
  assert.equal(v.screenReaderUserCanComplete, null);
  assert.equal(v.inconclusiveReason, 'missing_test_data');
  assert.deepEqual(v.blockingFindings, ['F1']);
  assert.equal(v.unexplainedStuck, false, 'missing data explains the stuck');
});

test('verdicts: "Missing data:" is matched case-insensitively; the planner input-value check stuck is inconclusive too', () => {
  const v = computeVerdicts(endingWith({ kind: 'stuck', reason: `Missing data: ${DEMO_STUCK}` }), []);
  assert.equal(v.screenReaderUserCanComplete, null);
  const f = computeVerdicts(endingWith({ kind: 'stuck', reason: FABRICATED_REASON, plannerError: true }), []);
  assert.deepEqual([f.agentCanComplete, f.screenReaderUserCanComplete, f.inconclusiveReason, f.unexplainedStuck], [null, null, 'missing_test_data', false]);
});

test('verdicts: any other stuck stays false and has no inconclusiveReason', () => {
  for (const reason of [DEMO_STUCK, 'Pressed Pay and heard nothing', 'runner: no progress in 6 steps']) {
    const v = computeVerdicts(endingWith({ kind: 'stuck', reason }), []);
    assert.equal(v.agentCanComplete, false, reason);
    assert.equal(v.screenReaderUserCanComplete, false, reason);
    assert.ok(!('inconclusiveReason' in v), reason);
    assert.equal(v.unexplainedStuck, true, reason);
  }
});

test('report.md says inconclusive, not "no"; a rerun from an inconclusive run is not a closed loop', () => {
  const t = endingWith({ kind: 'stuck', reason: `missing data: ${DEMO_STUCK}` });
  const r = buildReport({ meta: { goal: 'g' }, trace: t, findings: [] });
  const md = reportMarkdown(r);
  assert.match(md, /Screen-reader user can complete: \*\*[^*]*inconclusive/);
  assert.doesNotMatch(md, /❌ no/);
  const done = buildReport({ meta: { goal: 'g' }, trace: endingWith({ kind: 'done', reason: 'Order confirmed' }), findings: [] });
  assert.equal(compareRuns(r, done).closedLoop, false);
  const stuck = buildReport({ meta: { goal: 'g' }, trace: endingWith({ kind: 'stuck', reason: 'no feedback' }), findings: [] });
  assert.equal(compareRuns(stuck, done).closedLoop, true);
});

test('planner prompt: missing values → stuck with a reason starting "missing data:"', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'src/agent/prompts/planner.md'), 'utf8');
  assert.ok(prompt.includes(`"${MISSING_DATA_PREFIX}`), 'the prompt must tell the planner the exact prefix');
});

test('appendTestData: shop goal without digits gets the shop test data; the planner may type both cards', () => {
  const r = appendTestData({ goal: 'buy one thing', siteKey: 'sites/shop/original', mode: 'local' });
  assert.equal(r.appended, true);
  assert.equal(r.profile, 'shop');
  assert.equal(r.goal, 'buy one thing. Pay with card 4000 0000 0000 0002; if it is declined, use 4242 4242 4242 4242.');
  const shop = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/test-data/shop.json'), 'utf8'));
  assert.ok(r.goal.endsWith(shop.sentences.payment_card), 'values come from config/test-data/shop.json');
  assert.ok(typedValueInGoal('4000 0000 0000 0002', r.goal) && typedValueInGoal('4242 4242 4242 4242', r.goal));
  assert.equal(appendTestData({ goal: 'Buy the tote.', siteKey: 'sites/shop/fixed', mode: 'local' }).goal.split('. ')[0], 'Buy the tote');
});

test('appendTestData: nothing appended with a digit in the goal, in real mode, or for a site without its own test-data config', () => {
  const same = (o) => {
    const r = appendTestData(o);
    assert.deepEqual(r, { goal: o.goal, appended: false, profile: null }, JSON.stringify(o));
  };
  same({ goal: 'Buy 2 mugs', siteKey: 'sites/shop/original', mode: 'local' });
  same({ goal: 'Buy the tote. Pay with card 4242 4242 4242 4242.', siteKey: 'sites/shop/original', mode: 'local' });
  same({ goal: 'buy one thing', siteKey: 'sites/shop/original', mode: 'real' });
  same({ goal: 'buy one thing', siteKey: 'sites/testpage/original', mode: 'local' });
  same({ goal: 'buy one thing', siteKey: null, mode: 'local' });
});

// Replays the fixture trace through audit() with a fake session: the real orchestration, no browser.
function fakeSession() {
  let k = 0;
  return async () => ({ start: async () => trace[k++], step: async () => trace[k++], axeResults: () => ({ violations: [] }), close: async () => {} });
}

test('audit(): user goal "buy one thing" on the shop → full goal in every progress.json and meta.goal, raw input in meta.goalInput', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-data-'));
  const goals = [];
  const write = createProgressWriter(runDir);
  const { report } = await audit({ url: SHOP, goal: 'buy one thing', site: 'sites/shop/original', runDir, script: trace.slice(1).map((s) => s.action),
    judgeEnabled: false, openSession: fakeSession(), onProgress: (u) => { write(u); goals.push(readProgress(runDir).goal); } });
  const full = appendTestData({ goal: 'buy one thing', siteKey: 'sites/shop/original', mode: 'local' }).goal;
  assert.ok(goals.length > 2 && goals.every((g) => g === full), `progress goals: ${[...new Set(goals)].join(' | ')}`);
  assert.equal(report.meta.goal, full);
  assert.equal(report.meta.goalInput, 'buy one thing');
  assert.equal(report.meta.testDataAppended, true);
  assert.equal(report.meta.testDataProfile, 'shop');
  assert.equal(report.meta.goalSource, 'user');
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
  assert.equal(meta.goal, full);
  assert.equal(meta.goalInput, 'buy one thing');
});

test('audit(): without --site the shop is found from the URL; a goal with digits is used as given (no goalInput)', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-data-'));
  const { report } = await audit({ url: SHOP, goal: 'buy one thing', runDir, script: trace.slice(1).map((s) => s.action), judgeEnabled: false, openSession: fakeSession() });
  assert.equal(report.meta.testDataAppended, true);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-data-'));
  const goal = 'Buy the tote. Pay with card 4242 4242 4242 4242.';
  const r2 = (await audit({ url: SHOP, goal, runDir: dir2, script: trace.slice(1).map((s) => s.action), judgeEnabled: false, openSession: fakeSession() })).report;
  assert.equal(r2.meta.goal, goal);
  assert.ok(!('goalInput' in r2.meta) && !('testDataAppended' in r2.meta));
  assert.equal(r2.meta.testDataProfile, null);
});

test('audit(): real mode never appends test data', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-data-'));
  const { report } = await audit({ url: SHOP, goal: 'buy one thing', mode: 'real', site: 'sites/shop/original', runDir, script: trace.slice(1).map((s) => s.action),
    judgeEnabled: false, openSession: fakeSession() });
  assert.equal(report.meta.goal, 'buy one thing');
  assert.ok(!('testDataAppended' in report.meta));
});
