// Runs on recorded REAL traces (fixtures/), no browser, no LLM. `npm test` before every push.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/paths.mjs';
import { readTrace, validateAction } from '../src/contracts.mjs';
import { blockAction, redactFocusValue } from '../src/runner/guard.mjs';
import { focusInfo, pageText } from '../src/runner/observe.mjs';
import { runDetectors } from '../src/detect/index.mjs';
import { buildObservation } from '../src/agent/observation.mjs';
import { judge } from '../src/agent/judge.mjs';
import { computeVerdicts } from '../src/verdicts.mjs';
import { buildReport } from '../src/report/build.mjs';
import { checkEdit, applyEdits } from '../src/fix/apply.mjs';
import { parseJSON } from '../src/agent/llm.mjs';

const load = (v) => readTrace(fs.readFileSync(path.join(ROOT, `fixtures/testpage-${v}/trace.jsonl`), 'utf8'));
const original = load('original');
const fixed = load('fixed');

test('detectors find all 4 planted barriers on the original page', () => {
  const ids = new Set(runDetectors(original).map((c) => c.evidence.barrierId).filter(Boolean));
  assert.deepEqual([...ids].sort(), ['T1', 'T2', 'T3', 'T4']);
});

test('detectors report nothing on the fixed page (no false positives)', () => {
  assert.deepEqual(runDetectors(fixed), []);
});

test('carousel noise is not reported', () => {
  assert.ok(!runDetectors(original).some((c) => c.evidence.selector === '#promo'));
});

test('INFORMATION BARRIER: planner never sees an unannounced error', () => {
  const k = original.findIndex((s) => s.changes.some((c) => c.text === 'Card number is invalid'));
  const obs = JSON.stringify(buildObservation('buy', original.slice(0, k + 1)));
  assert.ok(!obs.includes('Card number is invalid'), 'unannounced text leaked to planner');
  const kf = fixed.findIndex((s) => s.changes.some((c) => c.text === 'Card number is invalid'));
  assert.ok(JSON.stringify(buildObservation('buy', fixed.slice(0, kf + 1))).includes('Card number is invalid'), 'announced text must reach planner');
});

test('focusValue is the AX value of the focused field, not what the planner typed', () => {
  // A screen reader reads a textbox's value on focus; the runner records it from the AX tree as focusAfter.value.
  const withValue = (steps, value) => steps.map((s, n) => (n === steps.length - 1 ? { ...s, focusAfter: { ...s.focusAfter, value } } : s));
  assert.equal(buildObservation('buy', withValue(fixed.slice(0, 6), '4242 4242')).focusValue, '4242 4242');
  assert.equal(buildObservation('buy', withValue(fixed.slice(0, 6), '')).focusValue, '');
  assert.equal(buildObservation('buy', fixed.slice(0, 6)).focusValue, null, 'no AX value recorded → null, never inferred from typed text');
});

test('Action: type accepts optional boolean replace, nothing else does', () => {
  assert.equal(validateAction({ kind: 'type', text: '4242', replace: true, reason: 'fix' }, { plannerOnly: true }), null);
  assert.equal(validateAction({ kind: 'type', text: '4242', replace: false, reason: 'x' }, { plannerOnly: true }), null);
  assert.match(validateAction({ kind: 'type', text: '4242', replace: 'yes', reason: 'x' }), /replace/);
  assert.match(validateAction({ kind: 'press', key: 'Tab', replace: true, reason: 'x' }), /replace/);
});

test('guard: real-site mode refuses typing into sensitive fields, with or without replace', () => {
  const card = { role: 'textbox', name: 'Card number', inputHints: 'text card cc-number' };
  const search = { role: 'searchbox', name: 'Search', inputHints: 'search q' };
  assert.match(blockAction({ kind: 'type', text: '4242', reason: 'x' }, card), /sensitive/);
  assert.match(blockAction({ kind: 'type', text: '4242', replace: true, reason: 'x' }, card), /sensitive/);
  assert.equal(blockAction({ kind: 'type', text: 'tote', replace: true, reason: 'x' }, search), null);
  assert.equal(blockAction({ kind: 'press', key: 'Enter', reason: 'x' }, card), null);
});

test('real mode: only fields the planner typed into keep their value; sensitive fields never do', () => {
  const email = { role: 'textbox', name: 'Email', selector: '#email', inputHints: 'email email', value: 'me@example.com' };
  const search = { role: 'searchbox', name: 'Search', selector: '#q', inputHints: 'search q', value: 'tote' };
  const card = { role: 'textbox', name: 'Card number', selector: '#card', inputHints: 'text card cc-number', value: '4242' };
  const button = { role: 'button', name: 'Pay', selector: '#pay' };
  const typed = new Set(['#q', '#card']);
  const real = (f) => redactFocusValue(f, { mode: 'real', typedSelectors: typed });
  assert.deepEqual(real(email), { ...email, value: null, valueRedacted: true }, 'autofilled / user-entered value is not recorded');
  assert.deepEqual(real(search), search, 'value the planner typed itself is kept');
  assert.deepEqual(real(card), { ...card, value: null, valueRedacted: true }, 'sensitive field: never recorded, even if typed');
  assert.deepEqual(real(button), button, 'nodes without a value are untouched');
  assert.deepEqual(redactFocusValue(email, { mode: 'local', typedSelectors: new Set() }), email, 'local mode unchanged');
});

test('real mode: pageText leaves out text inside editable fields (autofilled values)', async () => {
  const n = (nodeId, role, name, childIds = []) => ({ nodeId, role: { value: role }, name: { value: name }, childIds });
  const nodes = [n('1', 'RootWebArea', 'Form', ['2', '3']), n('2', 'StaticText', 'Email'),
    n('3', 'textbox', 'Email', ['4']), n('4', 'generic', '', ['5']), n('5', 'StaticText', 'me@example.com')];
  const cdp = { send: async () => ({ nodes }) };
  assert.ok((await pageText(cdp)).includes('me@example.com'), 'local mode unchanged');
  const real = await pageText(cdp, 4000, { redactFieldText: true });
  assert.ok(!real.includes('me@example.com'), 'field content leaked into pageText');
  assert.ok(real.includes('[textbox] Email'), 'the field itself is still listed');
});

test('focusInfo records the AX value of the focused node', async () => {
  const page = { evaluate: async () => ({ selector: '#card', barrierId: null, isBody: false, inModal: true, rect: null }) };
  const ax = { role: { value: 'textbox' }, name: { value: 'Card number' }, value: { value: '4242' }, backendDOMNodeId: 7 };
  const cdp = { send: async (m) => ({ 'Runtime.evaluate': { result: { objectId: 'o' } }, 'DOM.describeNode': { node: { backendNodeId: 7 } },
    'Accessibility.getPartialAXTree': { nodes: [ax] } })[m] || {} };
  assert.equal((await focusInfo(page, cdp)).value, '4242');
  delete ax.value;
  assert.equal('value' in (await focusInfo(page, cdp)), false, 'nodes without a value (buttons) get no value field');
});

test('trap: Escape that leaves the cycle is not a trap', () => {
  assert.equal(runDetectors(fixed).filter((c) => c.detector === 'trap').length, 0);
  const t = runDetectors(original).find((c) => c.detector === 'trap');
  assert.ok(t.hint.startsWith('trap'));
});

test('judge disabled → deterministic findings with traceable steps; verdicts', async () => {
  const findings = await judge({ goal: 'buy', trace: original, candidates: runDetectors(original), enabled: false });
  assert.ok(findings.every((f) => f.steps.length > 0 && f.id.startsWith('F')));
  const v = computeVerdicts(original, findings);
  assert.equal(v.screenReaderUserCanComplete, false);
  const r = buildReport({ meta: { goal: 'buy' }, trace: original, findings });
  assert.equal(r.timeline.length, original.length);
});

test('fix guard: cannot delete the error message, can add aria', () => {
  assert.ok(checkEdit({ old: "carderr.textContent = ok ? '' : 'Card number is invalid';", new: "carderr.textContent = '';" }));
  assert.equal(checkEdit({ old: '<p id="carderr">', new: '<p id="carderr" aria-live="assertive">' }), null);
  assert.equal(checkEdit({ old: '<button id="add">🛒</button>', new: '<button id="add" aria-label="Add to cart">🛒</button>' }), null);
});

test('applyEdits requires a unique match and stays inside the site dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.writeFileSync(`${dir}/index.html`, '<p id="a">x</p><p id="a">x</p>');
  assert.match(applyEdits(dir, [{ file: 'index.html', old: '<p id="a">', new: '<p id="a" role="status">' }]).errors[0], /2 times/);
  assert.match(applyEdits(dir, [{ file: '../etc/passwd', old: 'x', new: 'y' }]).errors[0], /outside/);
});

test('parseJSON tolerates fences and chatter', () => {
  assert.deepEqual(parseJSON('```json\n{"kind":"press","key":"Tab","reason":"x"}\n```'), { kind: 'press', key: 'Tab', reason: 'x' });
  assert.deepEqual(parseJSON('Sure! {"a":1} hope that helps'), { a: 1 });
});

test('fixed page: a screen-reader user can complete the purchase', async () => {
  const findings = await judge({ goal: 'buy', trace: fixed, candidates: runDetectors(fixed), enabled: false });
  assert.equal(computeVerdicts(fixed, findings).screenReaderUserCanComplete, true);
});
