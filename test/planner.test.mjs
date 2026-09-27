// Planner guards that run in code, not in the prompt: no made-up input values, no endless no-progress loops.
// Fake LLM client (no network, no cache); traces come from fixtures/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Set before llm.mjs loads .env: dotenv never overrides variables that already exist.
process.env.LLM_CACHE = 'off';
process.env.MODEL_PLANNER = 'fake-planner';
const { ROOT } = await import('../src/paths.mjs');
const { readTrace, NO_PROGRESS_STEPS, MAX_STEPS } = await import('../src/contracts.mjs');
const { nextAction, typedValueInGoal, noProgressSteps } = await import('../src/agent/planner.mjs');
const { detectTrap } = await import('../src/detect/trap.mjs');

const original = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));

/** Fake OpenAI client: replies[i] is the JSON object the model "answers" on call i (last one repeats). */
function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (body) => {
      calls.push(body.messages[1].content);
      return { choices: [{ message: { content: JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]) } }] };
    } } },
  };
}

// focus on the Card number field (fixture step 4), nothing typed yet
const atCard = original.slice(0, 5);
const CARD_GOAL = 'Buy the canvas tote bag. Pay with card number 4242 4242.';

test('typedValueInGoal: trimmed, case- and space-insensitive substring of the goal', () => {
  assert.equal(typedValueInGoal('4242 4242', CARD_GOAL), true);
  assert.equal(typedValueInGoal('  4242   4242 ', CARD_GOAL), true);
  assert.equal(typedValueInGoal('4242 4242 4242 4242', CARD_GOAL), false);
  assert.equal(typedValueInGoal('Canvas  TOTE', 'Search for the canvas tote and buy it'), true);
  assert.equal(typedValueInGoal('canvas tote bag', 'Search for the canvas tote and buy it'), false);
});

test('planner may not type a value that is not in the goal: fed back once, then stuck', async () => {
  const client = fakeClient([{ kind: 'type', text: '4242 4242 4242 4242', reason: 'full card number' }]);
  const a = await nextAction({ goal: CARD_GOAL, trace: atCard, stats: {}, client });
  assert.equal(client.calls.length, 2, 'one retry with the reason fed back');
  assert.match(client.calls[1], /not given in the goal/);
  assert.equal(a.kind, 'stuck');
  assert.match(a.reason, /planner tried to type a value not given in the goal/);
  assert.equal(a.plannerError, true);
});

test('a made-up value corrected after feedback is accepted', async () => {
  const client = fakeClient([
    { kind: 'type', text: '4242 4242 4242 4242', reason: 'full card number' },
    { kind: 'type', text: '4242 4242', reason: 'card number from the goal' },
  ]);
  const a = await nextAction({ goal: CARD_GOAL, trace: atCard, stats: {}, client });
  assert.equal(a.kind, 'type');
  assert.equal(a.text, '4242 4242');
});

test('search task: typing a phrase taken from the goal is allowed on the first try', async () => {
  const client = fakeClient([{ kind: 'type', text: 'canvas tote', reason: 'search for it' }]);
  const a = await nextAction({ goal: 'Search for the canvas tote and buy it', trace: atCard, stats: {}, client });
  assert.equal(client.calls.length, 1);
  assert.deepEqual([a.kind, a.text], ['type', 'canvas tote']);
});

/** Continue a trace with copies of template steps (new i/t). */
const extend = (trace, templates) => templates.reduce((t, s) => [...t, { ...structuredClone(s), i: t.length, t: t.at(-1).t + 1000 }], trace);
const byI = (i) => original.find((s) => s.i === i);

test('no progress for NO_PROGRESS_STEPS steps: the runner ends the run as stuck without asking the model', async () => {
  // after Pay (step 7) keep Tabbing between Card number and Pay. Step 8 still hears something new (the screen reader
  // reads the field with its value for the first time); from step 9 on nothing new is heard and no new element reached
  let trace = original.slice(0, 8);
  while (trace.length < 9 + NO_PROGRESS_STEPS) trace = extend(trace, [byI(8), byI(9)]);
  trace = trace.slice(0, 9 + NO_PROGRESS_STEPS);
  assert.equal(noProgressSteps(trace), NO_PROGRESS_STEPS);
  const client = fakeClient([{ kind: 'press', key: 'Tab', reason: 'keep looking' }]);
  const a = await nextAction({ goal: CARD_GOAL, trace, stats: {}, client });
  assert.equal(client.calls.length, 0, 'the model is not asked again');
  assert.equal(a.kind, 'stuck');
  assert.match(a.reason, /^runner: no progress/);
  assert.equal(a.plannerError, undefined, 'the planner did not fail; the runner stopped it');

  const oneLess = trace.slice(0, -1);
  assert.equal(noProgressSteps(oneLess), NO_PROGRESS_STEPS - 1);
  assert.equal((await nextAction({ goal: CARD_GOAL, trace: oneLess, stats: {}, client })).kind, 'press');
});

test('typing a new value or hearing something new counts as progress', () => {
  const typed = extend(original.slice(0, 8), [byI(8), byI(9), byI(8)]);
  typed.at(-1).action = { kind: 'type', text: '1', reason: 'x' };
  typed.at(-1).focusAfter.value = '4242 42421';
  assert.equal(noProgressSteps(typed), 0, 'field content never seen before');
  const heard = extend(original.slice(0, 8), [byI(8), byI(9)]);
  assert.equal(noProgressSteps(heard), 1, 'the Pay button again, heard before');
  heard.at(-1).spoken = ['assertive: Something new'];
  assert.equal(noProgressSteps(heard), 0, 'the screen reader said something new');
  const ruled = extend(original.slice(0, 8), [byI(8), byI(9)]);
  Object.assign(ruled.at(-1), { spokenSource: null, changes: [{ ...structuredClone(original[4].changes[0] || {}), text: 'Something new', selector: '#x', visible: true, inLiveRegion: true, referencedBy: [] }] });
  assert.equal(noProgressSteps(ruled), 0, 'screen reader not running: the rules say new live-region text was heard');
});

test('focus-trap detection is not cut short: the fixture trap and a 3-cycle + Escape probe both finish', () => {
  for (let n = 1; n <= original.length; n++) assert.ok(noProgressSteps(original.slice(0, n)) < NO_PROGRESS_STEPS, `fixture prefix ${n}`);
  assert.ok(detectTrap(original).length > 0);
  // prompt rule 6: cycle 3 times, then Escape
  const probe = extend(original.slice(0, 8), [byI(8), byI(9), byI(8), byI(9), byI(8), byI(9), byI(12)]);
  for (let n = 1; n <= probe.length; n++) assert.ok(noProgressSteps(probe.slice(0, n)) < NO_PROGRESS_STEPS, `probe prefix ${n}`);
  const trap = detectTrap(probe);
  assert.ok(trap.length > 0);
  assert.ok(trap[0].steps.includes(probe.at(-1).i), 'the Escape is part of the evidence');
});

test('MAX_STEPS leaves the planner room to explore: at least 1.5× the longest scripted local route', () => {
  // With 25 and a 23-step shop route, the planner ran out even on the hand-fixed shop, right after pressing Pay.
  const routes = fs.readdirSync(path.join(ROOT, 'eval')).filter((f) => /^keys\..*\.json$/.test(f));
  assert.ok(routes.length > 0);
  const longest = Math.max(...routes.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', f), 'utf8')).length));
  assert.ok(MAX_STEPS >= 1.5 * longest, `MAX_STEPS ${MAX_STEPS} < 1.5 × ${longest}`);
});
