// Regression tests for the rules in docs/CODING_STANDARDS.md (no browser, no LLM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, insideDir } from '../src/paths.mjs';
import { mergeAxe } from '../src/runner/axe.mjs';
import { buildReport } from '../src/report/build.mjs';
import { applyEdits } from '../src/fix/apply.mjs';
import { readTrace } from '../src/contracts.mjs';

const trace = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));

test('paths are anchored to the repo root, not cwd', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package.json')));
});

test('insideDir rejects escapes, including sibling-prefix dirs', () => {
  assert.throws(() => insideDir('/repo/sites', '../sites2/x'));
  assert.throws(() => insideDir('/repo/sites', '/etc/passwd'));
  assert.equal(insideDir('/repo/sites', 'shop/index.html'), '/repo/sites/shop/index.html');
});

test('axe failure is reported as unavailable, never as 0 violations', () => {
  const axe = mergeAxe([{ violations: [] }, { error: 'CSP blocked script' }]);
  const r = buildReport({ meta: { goal: 'x' }, trace, findings: [], axe });
  assert.equal(r.counts.axeViolations, null);
  assert.equal(r.axe.error, 'CSP blocked script');
});

test('applyEdits validates LLM output shape at the boundary', () => {
  const dir = fs.mkdtempSync('/tmp/site-');
  assert.match(applyEdits(dir, null).errors[0], /array/);
  assert.match(applyEdits(dir, [{ file: 'index.html' }]).errors[0], /invalid edit shape/);
});
