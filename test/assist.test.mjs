// Facilitator assist (src/runner/assist.mjs): once a keyboard trap is confirmed, a sighted helper closes it with the mouse
// and the run goes on. No browser, no network: fake session and fake LLM client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set before llm.mjs loads .env: dotenv never overrides variables that already exist.
process.env.LLM_CACHE = 'off';
process.env.MODEL_PLANNER = 'fake-planner';
const { ROOT } = await import('../src/paths.mjs');
const { readTrace, validateAction, validateStep, MAX_ASSISTS, MAX_STEPS, ASSIST_EXTRA_STEPS } = await import('../src/contracts.mjs');
const { runnerAction } = await import('../src/runner/assist.mjs');
const { runDetectors } = await import('../src/detect/index.mjs');
const { buildObservation, ASSIST_NOTE } = await import('../src/agent/observation.mjs');
const { noProgressSteps } = await import('../src/agent/planner.mjs');
const { computeVerdicts } = await import('../src/verdicts.mjs');
const { audit } = await import('../src/audit.mjs');
const { probedPopupTrap } = await import('./trap-traces.mjs');

const original = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));
const popup = probedPopupTrap();
const OUT = original[3].focusAfter; // #checkout, outside the dialog

/** The helper's click: focus lands outside the dialog, which is gone. */
const assisted = (prev, extra = {}) => ({ ...prev, i: prev.i + 1, action: { kind: 'assist', target: '#close', reason: 'runner: keyboard trap' },
  focusBefore: prev.focusAfter, focusAfter: OUT, modalOpen: false, changes: [], spoken: ['button, Checkout'], ...extra });
const reindex = (steps) => steps.map((s, k) => ({ ...s, i: k }));

test('runner acts only once the trap is confirmed: loop closed, Escape failed, focus still in the open dialog', () => {
  assert.equal(runnerAction(popup.slice(0, 6)), null, 'Tab after Join not seen yet');
  const a = runnerAction(popup.slice(0, 7));
  assert.equal(a.kind, 'assist');
  assert.match(a.reason, /^runner: keyboard trap, Tab only cycles among 2 elements and Escape does not leave/);
  assert.equal(a.target, undefined, 'the audit loop looks the close control up in the page');
  assert.equal(runnerAction([...popup.slice(0, 7), assisted(popup[6])]), null, 'out of the dialog: the planner goes on');
});

test('runner leaves the planner alone while Escape is untried or a Close button is in the cycle', () => {
  // testpage payment dialog: Tab cycles Card number ↔ Pay from step 8, Escape first pressed at step 12
  assert.ok(runDetectors(original.slice(0, 12)).some((c) => c.detector === 'trap' && c.hint.startsWith('esc-untested')));
  assert.equal(runnerAction(original.slice(0, 12)), null, 'the planner may still be working inside a normal dialog');
  assert.equal(runnerAction(original.slice(0, 13)).kind, 'assist');
  const withClose = original.slice(0, 13).map((s) => (s.focusAfter.selector === '#pay' ? { ...s, focusAfter: { ...s.focusAfter, name: 'Close' } } : s));
  assert.equal(runnerAction(withClose), null, 'a reachable Close button: the planner can leave by itself (esc-only)');
});

test('runner gives up instead of helping again: same trap after an assist, or no assists left', () => {
  const back = [...popup.slice(0, 7), assisted(popup[6], { focusAfter: popup[6].focusAfter, modalOpen: true })];
  const again = runnerAction(back);
  assert.equal(again.kind, 'stuck');
  assert.match(again.reason, /even after a sighted helper tried to close it/);
  const helped = Array.from({ length: MAX_ASSISTS }, () => ({ ...original[3], action: { kind: 'assist', target: '#x', reason: 'r' }, changes: [], spoken: [] }));
  const spent = runnerAction(reindex([original[0], ...helped, ...popup.slice(1, 7)]));
  assert.equal(spent.kind, 'stuck');
  assert.match(spent.reason, /no assists left/);
});

test('assist is a runner-only action with a target; the planner can never emit it', () => {
  assert.equal(validateAction({ kind: 'assist', target: '#close', reason: 'r' }), null);
  assert.match(validateAction({ kind: 'assist', reason: 'r' }), /target/);
  assert.match(validateAction({ kind: 'assist', target: '#close', reason: 'r' }, { plannerOnly: true }), /kind must be one of/);
  assert.equal(validateStep(assisted(popup[6])), null);
});

test('planner after an assist: a fixed note, nothing about what was clicked; the no-progress count restarts', () => {
  const trace = [...popup.slice(0, 7), assisted(popup[6])];
  const obs = buildObservation('buy', trace);
  assert.equal(obs.helper, ASSIST_NOTE);
  assert.ok(!JSON.stringify(obs).includes('#close'), 'the target selector is not page knowledge the user has');
  assert.equal(buildObservation('buy', trace.slice(0, -1)).helper, undefined);
  const next = { ...trace.at(-1), i: 8, action: { kind: 'press', key: 'Tab', reason: 'go on' }, spoken: [] };
  assert.match(buildObservation('buy', [...trace, next]).history.at(-1).did, /sighted helper/);
  assert.equal(noProgressSteps([...popup, { ...assisted(popup.at(-1)), focusAfter: popup.at(-1).focusAfter, spoken: [] }]), 0);
});

test('detectors skip the helper\'s click; an assisted run never counts as completed', () => {
  const click = assisted(popup[6], { changes: [{ ...structuredClone(original[7].changes[0]), inLiveRegion: false, referencedBy: [], focusMovedInto: false }], focusVisible: false });
  const cands = runDetectors([...popup.slice(0, 7), click]);
  assert.ok(!cands.some((c) => c.steps.includes(click.i) && c.detector !== 'trap'), JSON.stringify(cands.map((c) => [c.detector, c.steps])));
  const done = { ...click, i: 8, action: { kind: 'done', reason: 'confirmation heard' }, changes: [] };
  const v = computeVerdicts([...popup.slice(0, 7), click, done], []);
  assert.equal(v.outcome, 'done');
  assert.equal(v.agentCanComplete, false);
  assert.deepEqual(v.assistedSteps, [7]);
  assert.equal('assistedSteps' in computeVerdicts(original, []), false, 'absent when nobody helped');
});

/** Fake LLM client: replies[i] is the JSON the model "answers" on call i (last one repeats). */
function fakeClient(replies) {
  const calls = [];
  return { calls, chat: { completions: { create: async (body) => {
    calls.push(body.messages[1].content);
    return { choices: [{ message: { content: JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]) } }] };
  } } } };
}

/** Plays the popup trace back whatever the action; after an assist, focus leaves the dialog. */
function fakeSession(exits) {
  let k = 0;
  const trace = [];
  return async () => ({
    start: async () => (trace.push(popup[k++]), trace.at(-1)),
    step: async (action) => {
      const prev = trace.at(-1);
      const s = action.kind === 'assist' ? assisted(prev, { action }) : action.kind === 'done' || action.kind === 'stuck'
        ? { ...prev, i: prev.i + 1, action, focusBefore: prev.focusAfter, changes: [], spoken: [] } : { ...popup[k++], action };
      trace.push(s);
      return s;
    },
    mouseExit: async (sel) => (exits.push(sel), { selector: '#joinclose', barrierId: null, text: '×' }),
    axeResults: () => ({ violations: [] }),
    close: async () => {},
  });
}

const keys = popup.slice(1, 7).map((s) => ({ kind: 'press', key: s.action.key, reason: 'look' }));

test('audit(): the helper clicks the dialog\'s ×, the step limit grows, the planner finishes, the trap is reported', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-'));
  const exits = [];
  const client = fakeClient([...keys, { kind: 'done', reason: 'order confirmed' }]);
  const { report } = await audit({ url: 'http://localhost:8080/shop/original/', goal: 'Buy it', runDir, judgeEnabled: false,
    openSession: fakeSession(exits), llmClient: client });
  const kinds = report.timeline.map((t) => t.action.kind);
  assert.deepEqual(kinds, ['start', 'press', 'press', 'press', 'press', 'press', 'press', 'assist', 'done']);
  assert.equal(client.calls.length, 7, 'the planner is not asked on the assist step');
  assert.deepEqual(exits, [popup[6].focusAfter.selector], 'looked up from where focus was trapped');
  const help = report.timeline[7].action;
  assert.equal(help.target, '#joinclose');
  assert.match(help.reason, /a sighted helper clicked "×" with the mouse$/);
  assert.equal(report.meta.maxSteps, MAX_STEPS + ASSIST_EXTRA_STEPS);
  assert.equal(JSON.parse(client.calls[6]).stepsLeft, MAX_STEPS + ASSIST_EXTRA_STEPS - 8);
  assert.equal(report.verdicts.agentCanComplete, false);
  assert.deepEqual(report.verdicts.assistedSteps, [7]);
  const trap = report.findings.find((f) => f.detector === 'trap');
  assert.equal(trap.impact, 'block');
  assert.deepEqual(report.verdicts.blockingFindings, [trap.id]);
  fs.rmSync(runDir, { recursive: true, force: true });
});

test('audit(): scripted routes are replayed exactly, never assisted', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-'));
  const exits = [];
  const { report } = await audit({ url: 'http://localhost:8080/shop/original/', goal: 'Buy it', runDir, judgeEnabled: false,
    script: popup.slice(1).map((s) => s.action), openSession: fakeSession(exits) });
  assert.deepEqual(exits, []);
  assert.ok(!report.timeline.some((t) => t.action.kind === 'assist'));
  assert.equal(report.meta.maxSteps, MAX_STEPS);
  fs.rmSync(runDir, { recursive: true, force: true });
});
