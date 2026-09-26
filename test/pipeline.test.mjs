// Runs on recorded REAL traces (fixtures/), no browser, no LLM. `npm test` before every push.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';
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

test('planner hears the text it already typed into the focused field (type appends)', () => {
  // A screen reader reads a textbox's value on focus; without it the planner retyped and doubled the card number.
  assert.equal(buildObservation('buy', fixed.slice(0, 6)).focusValue, '4242 4242'); // after step 5
  assert.equal(buildObservation('buy', fixed.slice(0, 7)).focusValue, null);        // focus on Pay
  assert.equal(buildObservation('buy', fixed.slice(0, 14)).focusValue, '4242 4242'); // back in the field
  assert.equal(buildObservation('buy', fixed.slice(0, 15)).focusValue, '4242 4242 4242 4242');
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
