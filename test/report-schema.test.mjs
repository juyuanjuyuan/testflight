// report.json is the frontend contract: every report the backend produces must match docs/report.schema.json.
// Reports are rebuilt from the fixture traces on every run, so a change to build.mjs / compare.mjs fails here
// until the schema (and REPORT_FORMAT.md, report.example.json) catch up. viewer/sample/ is frontend-owned: not checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';
import { analyze } from '../src/audit.mjs';
import { buildReport } from '../src/report/build.mjs';
import { compareRuns } from '../src/report/compare.mjs';
import { mergeAxe } from '../src/runner/axe.mjs';
import { runDetectors } from '../src/detect/index.mjs';
import { judge } from '../src/agent/judge.mjs';
import { probedPopupTrap } from './trap-traces.mjs';

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const schema = readJSON('docs/report.schema.json');
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const describeErrors = (errors) => errors.map((e) => `  ${e.instancePath || '/'}: ${e.message} ${JSON.stringify(e.params)}`).join('\n');
function assertValid(report, label) {
  if (!validate(report)) assert.fail(`${label} does not match docs/report.schema.json:\n${describeErrors(validate.errors)}`);
}

const deref = (s) => (s?.$ref ? deref(s.$ref.slice(2).split('/').reduce((o, k) => o[k], schema)) : s);
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function admits(s, v) {
  if (!s.type) return true;
  const types = [].concat(s.type);
  return types.includes(jsonType(v)) || (jsonType(v) === 'integer' && types.includes('number'));
}

/** Walk a report alongside the schema; `visit(schemaNode, value, at)` returns problem strings for each object. */
function walk(s, value, at, visit) {
  s = deref(s);
  const branches = s.oneOf || s.anyOf;
  if (branches) {
    const results = branches.map(deref).filter((b) => admits(b, value)).map((b) => walk(b, value, at, visit));
    return results.length ? results.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  }
  if (Array.isArray(value)) return s.items ? value.flatMap((v, i) => walk(s.items, v, `${at}/${i}`, visit)) : [];
  if (!value || typeof value !== 'object') return [];
  return [...visit(s, value, at), ...Object.entries(value).flatMap(([k, v]) => {
    const sub = s.properties?.[k] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : undefined);
    return sub ? walk(sub, v, `${at}/${k}`, visit) : [];
  })];
}
const missingRequired = (report) => walk(schema, report, '', (s, v, at) => (s.required || []).filter((k) => !(k in v)).map((k) => `${at}/${k}`));
const undeclared = (report) => walk(schema, report, '', (s, v, at) => Object.keys(v)
  .filter((k) => !s.properties?.[k] && typeof s.additionalProperties !== 'object').map((k) => `${at}/${k}`));

// Raw axe-core output (one WCAG rule, one best-practice rule) so the live reports cover the violations branch.
const rawAxe = [{ violations: [
  { id: 'button-name', impact: 'critical', tags: ['wcag2a', 'wcag412'], nodes: [{ target: ['#add'] }] },
  { id: 'region', impact: 'moderate', tags: ['best-practice'], nodes: [{ target: ['main'] }, { target: ['footer'] }] },
] }];

async function liveReport(variant) {
  const trace = readTrace(fs.readFileSync(path.join(ROOT, `fixtures/testpage-${variant}/trace.jsonl`), 'utf8'));
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-schema-'));
  try {
    const meta = { url: `http://localhost:8080/testpage/${variant}/`, mode: 'local', site: `sites/testpage/${variant}`, script: true };
    const { report, findings } = await analyze({ trace, goal: 'Buy the canvas tote bag', meta, runDir, judgeEnabled: false, axe: mergeAxe(rawAxe) });
    return { trace, findings, report };
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

const original = await liveReport('original');
const fixed = await liveReport('fixed');
const rerunReport = { ...original.report, rerun: { runDir: 'runs/x-rerun', ...compareRuns(original.report, fixed.report) } };
const axeErrorReport = buildReport({ meta: { goal: 'x' }, trace: original.trace, findings: original.findings, axe: mergeAxe([{ error: 'CSP blocked script' }]) });
// a planner stuck for missing test data: verdicts null + inconclusiveReason
const missingData = buildReport({ meta: { goal: 'x', goalInput: 'x', testDataAppended: true, testDataProfile: 'shop', goalSource: 'user', goalReason: null },
  trace: [...original.trace.slice(0, -1), { ...original.trace.at(-1), action: { kind: 'stuck', reason: 'missing data: no card number in the goal' } }], findings: original.findings });
// a sighted helper closed a keyboard trap (runner/assist.mjs): action kind 'assist' with target, verdicts.assistedSteps
const popup = probedPopupTrap().slice(0, 7);
const helped = { ...popup[6], i: 7, action: { kind: 'assist', target: '#joinclose', reason: 'runner: keyboard trap' }, focusBefore: popup[6].focusAfter,
  focusAfter: original.trace[3].focusAfter, modalOpen: false };
const assistedTrace = [...popup, helped, { ...helped, i: 8, action: { kind: 'done', reason: 'confirmation heard' } }];
const assisted = buildReport({ meta: { goal: 'x', maxSteps: 60 }, trace: assistedTrace, findings: await judge({ goal: 'x', trace: assistedTrace, candidates: runDetectors(assistedTrace), enabled: false }) });
const live = { 'assisted (live)': assisted, 'missing data (live)': missingData,'original (live)': original.report, 'fixed (live)': fixed.report, 'original + rerun (live)': rerunReport, 'axe error (live)': axeErrorReport };

test('schema compiles in strict mode', () => {
  assert.equal(typeof validate, 'function');
});

// testpage-fixloop: a real audit → fix → rerun run, so fixes, findings[].fix and rerun are covered by real data.
const FIXTURE_REPORTS = ['fixtures/testpage-original/report.json', 'fixtures/testpage-fixed/report.json', 'fixtures/testpage-fixloop/report.json'];
for (const rel of [...FIXTURE_REPORTS, 'docs/report.example.json']) {
  test(`${rel} matches the schema`, () => assertValid(readJSON(rel), rel));
}

test('fixture reports contain no local absolute paths and every screenshot they reference exists', () => {
  for (const rel of FIXTURE_REPORTS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!text.includes(ROOT), `${rel} contains the local repo path ${ROOT}`);
    const r = JSON.parse(text);
    for (const shot of [...r.timeline.map((t) => t.screenshot), ...r.findings.map((f) => f.evidence.screenshot)].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(rel), shot)), `${rel} references missing ${shot}`);
    }
  }
});

test('fixloop fixture: fixes, findings[].fix and a closed loop are present', () => {
  const r = readJSON('fixtures/testpage-fixloop/report.json');
  assert.ok(r.fixes.length > 0 && r.fixes.every((f) => f.applied > 0));
  assert.ok(r.findings.some((f) => f.fix?.edits.length > 0));
  assert.equal(r.rerun.closedLoop, true);
  assert.match(r.rerun.runDir, /^runs\/[^/]+$/, 'runDir is repo-relative, as the viewer links to it');
});

for (const [label, report] of Object.entries(live)) {
  test(`report built by buildReport: ${label} matches the schema`, () => assertValid(report, label));
}

test('live reports contain every field the schema marks as required', () => {
  for (const [label, report] of Object.entries(live)) {
    assert.deepEqual(missingRequired(report), [], `${label}: required by docs/report.schema.json but missing`);
  }
});

test('live reports only contain fields declared in the schema (new fields must be documented)', () => {
  for (const [label, report] of Object.entries(live)) {
    assert.deepEqual(undeclared(report), [], `${label}: produced by the backend but not declared in docs/report.schema.json`);
  }
});

test('a schema violation names the field path and the reason', () => {
  const broken = structuredClone(original.report);
  delete broken.timeline[1].heard;
  broken.counts.block = -1;
  assert.equal(validate(broken), false);
  const msg = describeErrors(validate.errors);
  assert.match(msg, /\/timeline\/1: must have required property 'heard'/);
  assert.match(msg, /\/counts\/block: must be >= 0/);
});
