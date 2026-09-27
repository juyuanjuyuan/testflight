// Regression tests for the rules in docs/CODING_STANDARDS.md (no browser, no LLM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, insideDir } from '../src/paths.mjs';
import { mergeAxe } from '../src/runner/axe.mjs';
import { enableAX, screenshotOrNull, waitForLoad, pngSize, RECORDER_CONFIG } from '../src/runner/session.mjs';
import { buildReport } from '../src/report/build.mjs';
import { applyEdits } from '../src/fix/apply.mjs';
import { readTrace, validateStep, CHANGE_WINDOW_MS } from '../src/contracts.mjs';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  assert.match(applyEdits(dir, null).errors[0], /array/);
  assert.match(applyEdits(dir, [{ file: 'index.html' }]).errors[0], /invalid edit shape/);
});

test('runner: Accessibility.enable failure is an error, not silently ignored', async () => {
  const cdp = { send: async () => { throw new Error('boom'); } };
  await assert.rejects(enableAX(cdp), /Accessibility\.enable.*boom/);
});

test('runner: a failed screenshot is recorded as null, not a dangling path', async () => {
  const page = { screenshot: async () => { throw new Error('target closed'); } };
  assert.equal(await screenshotOrNull(page, '/run', 'shots/0001.png'), null);
  const ok = { screenshot: async () => {} };
  assert.equal(await screenshotOrNull(ok, '/run', 'shots/0001.png'), 'shots/0001.png');
});

test('runner: a load that never finishes is recorded as loadTimeout', async () => {
  const slow = { waitForLoadState: async () => { throw Object.assign(new Error('Timeout 10000ms exceeded'), { name: 'TimeoutError' }); } };
  assert.deepEqual(await waitForLoad(slow), { loadTimeout: true });
  const fast = { waitForLoadState: async () => {} };
  assert.deepEqual(await waitForLoad(fast), { loadTimeout: false });
  const broken = { waitForLoadState: async () => { throw new Error('page crashed'); } };
  await assert.rejects(waitForLoad(broken), /page crashed/);
});

test('runner: screenshot size is read from the PNG header; a non-PNG is an error, not a made-up size', () => {
  assert.deepEqual(pngSize(path.join(ROOT, 'fixtures/testpage-original/shots/0000.png')), { w: 1280, h: 800 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'png-'));
  try {
    fs.writeFileSync(path.join(dir, 'x.png'), 'not an image at all, just text');
    assert.throws(() => pngSize(path.join(dir, 'x.png')), /not a PNG/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shotSize: every recorded screenshot has its size; report carries it, null when a step has none', () => {
  for (const s of trace) assert.deepEqual(s.shotSize, s.screenshot ? { w: 1280, h: 800, dpr: 1 } : undefined, `step ${s.i}`);
  const noShot = trace.map((s, k) => (k === 1 ? { ...s, screenshot: null, shotSize: undefined } : s));
  const r = buildReport({ meta: { goal: 'x' }, trace: noShot, findings: [] });
  assert.deepEqual(r.timeline[0].shotSize, { w: 1280, h: 800, dpr: 1 });
  assert.equal(r.timeline[1].shotSize, null);
  assert.match(validateStep({ ...trace[0], shotSize: { w: 1280, h: 0, dpr: 1 } }), /shotSize/);
  assert.match(validateStep({ ...trace[0], shotSize: null }), /shotSize/);
});

test('recorder thresholds come from contracts.mjs, not literals in the page script', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/runner/recorder.js'), 'utf8');
  assert.ok(!/\b1500\b/.test(src), 'recorder.js hard-codes 1500');
  assert.match(src, /__A11Y_CONFIG/);
  assert.deepEqual(RECORDER_CONFIG, { CHANGE_WINDOW_MS, NOISE_GAP_MS: CHANGE_WINDOW_MS });
});

test('package.json scripts only reference files that exist', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const ref of cmd.match(/\b(?:fixtures|eval|scripts|test)\/[\w./-]+\.\w+/g) || []) {
      if (ref.includes('*')) continue;
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `npm run ${name}: ${ref} does not exist`);
    }
  }
});
