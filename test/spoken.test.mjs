// Plan 16: step.spoken from the Guidepup virtual screen reader. No browser, no LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPOKEN_SOURCE } from '../src/contracts.mjs';
import { heardInStep, ruleHeard, spokenAgreement, buildObservation } from '../src/agent/observation.mjs';
import { redactSpoken } from '../src/runner/guard.mjs';

const focus = (name, selector, role = 'button') => ({ role, name, description: '', selector, barrierId: null, isBody: false, inModal: false });
const change = (text, o = {}) => ({ text, selector: '#x', visible: true, inLiveRegion: false, focusMovedInto: false, referencedBy: [], repeatCount: 0, ...o });
const step = (o) => ({ i: 1, action: { kind: 'press', key: 'Enter', reason: 'x' }, focusBefore: focus('Pay', '#pay'), focusAfter: focus('Pay', '#pay'),
  changes: [], spoken: [], pageLoad: false, ...o });

test('heardInStep: the virtual screen reader is the source when it ran on the step', () => {
  // the rules would say the live-region text was heard; the screen reader said something else: it wins
  const s = step({ changes: [change('Card number is invalid', { inLiveRegion: true })], spoken: ['assertive: Card number is invalid'], spokenSource: SPOKEN_SOURCE });
  assert.deepEqual(heardInStep(s), ['assertive: Card number is invalid']);
  assert.deepEqual(heardInStep({ ...s, spoken: [] }), [], 'it said nothing → nothing heard, even if the rules disagree');
});

test('heardInStep: without the screen reader (old traces, injection failed) the rules are the fallback', () => {
  const s = step({ changes: [change('Card number is invalid', { inLiveRegion: true }), change('Order total $24', {})] });
  assert.deepEqual(heardInStep(s), ['Card number is invalid']);
  assert.deepEqual(heardInStep({ ...s, spokenSource: null, spokenError: 'CSP blocked the module' }), ['Card number is invalid']);
  assert.deepEqual(ruleHeard({ ...s, spokenSource: SPOKEN_SOURCE }), ['Card number is invalid'], 'ruleHeard never reads spoken');
});

test('INFORMATION BARRIER: with the screen reader, text it never announced does not reach the planner', () => {
  const start = step({ i: 0, action: { kind: 'start', reason: 'open' }, focusBefore: null, spoken: ['document'], spokenSource: SPOKEN_SOURCE });
  const pay = step({ changes: [change('Card number is invalid')], spoken: [], spokenSource: SPOKEN_SOURCE });
  const obs = JSON.stringify(buildObservation('buy', [start, pay]));
  assert.ok(!obs.includes('Card number is invalid'), obs);
});

test('redactSpoken: password values are masked in every mode, like the AX tree does', () => {
  const fields = [{ selector: '#pw', value: 'hunter2', password: true }];
  for (const mode of ['local', 'real']) {
    assert.deepEqual(redactSpoken(['Password, hunter2'], fields, { mode, typedSelectors: new Set(['#pw']) }), ['Password, •••••••']);
  }
});

test('redactSpoken: real mode keeps only values the planner typed; local mode keeps everything else', () => {
  const fields = [{ selector: '#email', value: 'me@example.com', password: false }, { selector: '#q', value: 'tote', password: false }];
  const said = ['textbox, Email, me@example.com', 'textbox, Search, tote', 'polite: 3 results for tote bags'];
  assert.deepEqual(redactSpoken(said, fields, { mode: 'local', typedSelectors: new Set() }), said);
  assert.deepEqual(redactSpoken(said, fields, { mode: 'real', typedSelectors: new Set(['#q']) }),
    ['textbox, Email, (redacted)', 'textbox, Search, tote', 'polite: 3 results for tote bags']);
  // only whole phrase segments are values: a short value does not blank out other words that contain it
  const qty = [{ selector: '#qty', value: '1', password: false }];
  assert.deepEqual(redactSpoken(['spinbutton, Qty, 1', 'button, Add 1 item'], qty, { mode: 'real', typedSelectors: new Set() }),
    ['spinbutton, Qty, (redacted)', 'button, Add 1 item']);
});

test('spokenAgreement: per step, does the screen reader announce each new text exactly when the rules say it is heard', () => {
  const vsr = (o) => step({ spokenSource: SPOKEN_SOURCE, ...o });
  const trace = [
    vsr({ i: 0, action: { kind: 'start', reason: 'open' }, focusBefore: null, spoken: ['document'] }),              // nothing new on screen: not compared
    vsr({ i: 1, changes: [change('Added to cart', { inLiveRegion: true })], spoken: ['polite: Added   to cart'] }), // both: heard
    vsr({ i: 2, changes: [change('Card number is invalid')], spoken: [] }),                                          // both: not heard
    vsr({ i: 3, changes: [change('Canvas Tote Bag $24.00', { focusMovedInto: true })], spoken: ['dialog, Your cart, modal'] }), // disagree
    step({ i: 4, changes: [change('Order confirmed', { inLiveRegion: true })] }),                                    // no screen reader: fallback
  ];
  assert.deepEqual(spokenAgreement(trace), {
    compared: 3, agreed: 2, fallbackSteps: 1,
    disagreements: [{ step: 3, text: 'Canvas Tote Bag $24.00', rules: true, virtualScreenReader: false }],
  });
  assert.equal(spokenAgreement(trace.slice(4)), null, 'no step ran the screen reader → nothing to compare');
});
