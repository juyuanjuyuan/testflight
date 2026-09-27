// --trace (plan 15): Playwright tracing start/stop order and output path, with a fake browser (no Chromium launched).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';
import { openSession } from '../src/runner/session.mjs';
import { audit } from '../src/audit.mjs';

const fixture = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));

// Records every call that matters for tracing into `calls`; start/stop can be made to throw.
function fakeChromium(calls, { startError, stopError } = {}) {
  const cdp = { send: async () => {}, detach: async () => {} };
  const ctx = {
    addInitScript: async () => {},
    newPage: async () => page,
    newCDPSession: async () => cdp,
    pages: () => [page],
    tracing: {
      start: async (o) => { calls.push(['tracing.start', o]); if (startError) throw new Error(startError); },
      stop: async (o) => { calls.push(['tracing.stop', o]); if (stopError) throw new Error(stopError); },
    },
  };
  const page = { context: () => ctx, on: () => {}, evaluate: async () => true, goto: async () => {} };
  const browser = { newContext: async () => ctx, contexts: () => [ctx], close: async () => { calls.push(['browser.close']); } };
  return {
    launch: async () => { calls.push(['launch']); return browser; },
    connectOverCDP: async () => { calls.push(['connectOverCDP']); return browser; },
  };
}

test('openSession trace: tracing starts after launch and is saved to runDir/trace.zip before the browser closes', async () => {
  const runDir = tmpDir(), calls = [];
  try {
    const s = await openSession({ url: 'http://x/', runDir, trace: true, browserType: fakeChromium(calls) });
    assert.deepEqual(await s.close(), { trace: 'trace.zip' });
    assert.deepEqual(calls, [
      ['launch'],
      ['tracing.start', { screenshots: true, snapshots: true, sources: false }],
      ['tracing.stop', { path: path.join(runDir, 'trace.zip') }],
      ['browser.close'],
    ]);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('openSession without trace never touches tracing', async () => {
  const runDir = tmpDir(), calls = [];
  try {
    const s = await openSession({ url: 'http://x/', runDir, browserType: fakeChromium(calls) });
    assert.deepEqual(await s.close(), {});
    assert.deepEqual(calls, [['launch'], ['browser.close']]);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('openSession trace, real mode: starts only after the human is done; a refused start is recorded, the run goes on', async () => {
  const runDir = tmpDir(), calls = [];
  try {
    const waitForUser = async () => { calls.push(['waitForUser']); };
    const s = await openSession({ runDir, mode: 'real', cdp: 'http://localhost:9222', trace: true, waitForUser,
      browserType: fakeChromium(calls, { startError: 'Tracing is not supported\nstack…' }) });
    assert.deepEqual(await s.close(), { traceError: 'trace not started: Tracing is not supported' });
    assert.deepEqual(calls.map((c) => c[0]), ['connectOverCDP', 'waitForUser', 'tracing.start', 'browser.close']);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('openSession trace: a failed save is recorded as traceError and the browser still closes', async () => {
  const runDir = tmpDir(), calls = [];
  try {
    const s = await openSession({ url: 'http://x/', runDir, trace: true, browserType: fakeChromium(calls, { stopError: 'ENOSPC' }) });
    assert.deepEqual(await s.close(), { traceError: 'trace not saved: ENOSPC' });
    assert.deepEqual(calls.at(-1), ['browser.close']);
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('audit(): --trace reaches openSession; meta.json records trace/traceError, report.json meta does not', async () => {
  for (const outcome of [{ trace: 'trace.zip' }, { traceError: 'trace not started: nope' }]) {
    const runDir = tmpDir(), opened = [], logs = [];
    let k = 0;
    const openSession = async (o) => { opened.push(o); return { start: async () => fixture[k++], step: async () => fixture[k++],
      axeResults: () => ({ violations: [] }), close: async () => outcome }; };
    try {
      const { report } = await audit({ url: 'http://x/', goal: 'Buy the canvas tote bag', runDir, trace: true, judgeEnabled: false,
        script: fixture.slice(1).map((s) => s.action), openSession, log: (m) => logs.push(m) });
      assert.equal(opened[0].trace, true);
      const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
      assert.deepEqual({ trace: meta.trace, traceError: meta.traceError }, { trace: undefined, traceError: undefined, ...outcome });
      assert.ok(!('trace' in report.meta) && !('traceError' in report.meta), 'report.json is the frontend contract');
      assert.ok(logs.some((m) => m.includes(outcome.trace ? path.join(runDir, 'trace.zip') : outcome.traceError)), logs.join('\n'));
    } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
  }
});
