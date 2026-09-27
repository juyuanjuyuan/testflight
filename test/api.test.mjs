// HTTP API (plan 17 P0): POST /api/runs with an injected fake "spawn a run" function — no browser, no LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../src/paths.mjs';
import { createStaticServer, listen, HOST } from '../src/server.mjs';
import { runDirPath } from '../src/api/runs.mjs';
import { readProgress, createProgressWriter } from '../src/report/progress.mjs';

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(readJSON('docs/report.schema.json'));
const validateProgress = ajv.compile(readJSON('docs/progress.schema.json'));

/** Fake spawner: records each run and lets the test decide when and how the "child" exits. */
function fakeSpawner() {
  const calls = [];
  const spawnRun = ({ runDir, argv }) => new Promise((resolve) => { calls.push({ runDir, argv, exit: resolve }); });
  return { calls, spawnRun };
}

async function withApi(fn, { spawnRun } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-runs-'));
  const server = createStaticServer({ runsDir, spawnRun });
  await listen(server, 0);
  const port = server.address().port;
  const post = async (p, body, headers = { 'content-type': 'application/json' }) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const site = (rel = 'testpage/original/') => `http://localhost:${port}/${rel}`;
  try { await fn({ port, runsDir, post, site, server }); } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runsDir, { recursive: true, force: true });
  }
}
const tick = () => new Promise((r) => setImmediate(r));
const GOAL = 'Buy the canvas tote bag';

test('server listens on 127.0.0.1 only', async () => {
  assert.equal(HOST, '127.0.0.1');
  const server = createStaticServer();
  await listen(server, 0);
  try { assert.equal(server.address().address, '127.0.0.1'); } finally { await new Promise((r) => server.close(r)); }
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/serve.mjs'), 'utf8'), /\blisten\(/, 'npm run serve must use listen() from src/server.mjs');
});

test('POST /api/runs: 202 + runDir; progress.json exists (running, empty timeline) before the response', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post, site }) => {
    const r = await post('/api/runs', { url: site(), goal: GOAL });
    assert.equal(r.status, 202);
    assert.match(r.body.runDir, /^[\w.-]+-audit$/);
    const dir = path.join(runsDir, r.body.runDir);
    const p = readProgress(dir);
    assert.ok(validateProgress(p), JSON.stringify(validateProgress.errors));
    assert.equal(p.state, 'running');
    assert.deepEqual(p.timeline, []);
    assert.equal(fake.calls.length, 1);
    const { argv, runDir } = fake.calls[0];
    assert.equal(runDir, dir);
    const arg = (k) => argv[argv.indexOf(k) + 1];
    assert.equal(argv[0], 'audit');
    assert.equal(arg('--url'), site());
    assert.equal(arg('--goal'), GOAL);
    assert.equal(arg('--run-dir'), dir);
    assert.equal(arg('--site'), 'sites/testpage/original');
    assert.ok(argv.includes('--progress'));
    assert.ok(!argv.includes('--script') && !argv.includes('--no-judge'), 'no script → the planner and judge run');
  }, fake);
});

test('POST /api/runs: 409 while a run is active; the lock is released when the child exits', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ post, site }) => {
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL })).status, 202);
    const busy = await post('/api/runs', { url: site(), goal: GOAL });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'run_in_progress');
    fake.calls[0].exit({ code: 0, signal: null, stderr: '' });
    await tick();
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL })).status, 202);
    assert.notEqual(fake.calls[1].runDir, fake.calls[0].runDir, 'two runs in the same second get different directories');
  }, fake);
});

test('child exits without finishing → progress failed with a readable error; done is never overwritten', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ post, site }) => {
    await post('/api/runs', { url: site(), goal: GOAL });
    fake.calls[0].exit({ code: 1, signal: null, stderr: 'loading\nerror: net::ERR_CONNECTION_REFUSED (DEBUG=1 for details)\n' });
    await tick();
    const p = readProgress(fake.calls[0].runDir);
    assert.equal(p.state, 'failed');
    assert.match(p.error, /ERR_CONNECTION_REFUSED/);
    assert.ok(!p.error.includes('\n'));
    assert.ok(validateProgress(p));

    await post('/api/runs', { url: site(), goal: GOAL });
    createProgressWriter(fake.calls[1].runDir)({ state: 'done', trace: [] });
    fake.calls[1].exit({ code: 0, signal: null, stderr: '' });
    await tick();
    assert.equal(readProgress(fake.calls[1].runDir).state, 'done');
  }, fake);
});

test('spawn throwing → 500, progress failed, lock released', async () => {
  let n = 0;
  const spawnRun = () => { if (n++ === 0) throw new Error('spawn ENOENT'); return new Promise(() => {}); };
  await withApi(async ({ runsDir, post, site }) => {
    const r = await post('/api/runs', { url: site(), goal: GOAL });
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'internal_error');
    const [dir] = fs.readdirSync(runsDir);
    assert.equal(readProgress(path.join(runsDir, dir)).state, 'failed');
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL })).status, 202);
  }, { spawnRun });
});

test('POST /api/runs: script whitelist → --script <eval file> and --no-judge; anything else is 400', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ post, site }) => {
    for (const script of ['../package.json', 'keys.nope.json', 'groundtruth/testpage.yaml', 'score.mjs', 42, '']) {
      const r = await post('/api/runs', { url: site(), goal: GOAL, script });
      assert.equal(r.status, 400, `script ${JSON.stringify(script)}`);
      assert.equal(r.body.error.code, 'invalid_script');
    }
    assert.equal(fake.calls.length, 0);
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL, script: 'keys.testpage.json' })).status, 202);
    const { argv } = fake.calls[0];
    assert.equal(argv[argv.indexOf('--script') + 1], path.join(ROOT, 'eval', 'keys.testpage.json'));
    assert.ok(argv.includes('--no-judge'));
  }, fake);
});

test('POST /api/runs: parameter validation → 400 with {error:{code,message}}', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ port, post, site }) => {
    const cases = [
      [{ url: 'file:///etc/passwd', goal: GOAL }, 'invalid_url'],
      [{ url: 'javascript:alert(1)', goal: GOAL }, 'invalid_url'],
      [{ url: 'not a url', goal: GOAL }, 'invalid_url'],
      [{ goal: GOAL }, 'invalid_url'],
      [{ url: 'https://example.com/', goal: GOAL }, 'real_site_cli_only'],
      [{ url: `http://localhost:${port + 1}/testpage/original/`, goal: GOAL }, 'real_site_cli_only'],
      [{ url: `http://0.0.0.0:${port}/testpage/original/`, goal: GOAL }, 'real_site_cli_only'],
      [{ url: site('nope/x/'), goal: GOAL }, 'unknown_site'],
      [{ url: site('viewer/'), goal: GOAL }, 'unknown_site'],
      [{ url: site('testpage/../../package.json'), goal: GOAL }, 'unknown_site'],
      [{ url: site(), goal: '' }, 'invalid_goal'],
      [{ url: site(), goal: '   ' }, 'invalid_goal'],
      [{ url: site(), goal: 'x'.repeat(501) }, 'invalid_goal'],
      [{ url: site(), goal: 7 }, 'invalid_goal'],
      [[1, 2], 'invalid_body'],
      ['{"url":', 'invalid_body'],
      [JSON.stringify({ url: site(), goal: 'x'.repeat(17 * 1024) }), 'body_too_large'],
    ];
    for (const [body, code] of cases) {
      const r = await post('/api/runs', body);
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)} → ${r.status}`);
      assert.equal(r.body.error.code, code, JSON.stringify(body).slice(0, 80));
      assert.equal(typeof r.body.error.message, 'string');
      assert.ok(r.body.error.message.length > 0);
    }
    const noJson = await post('/api/runs', JSON.stringify({ url: site(), goal: GOAL }), { 'content-type': 'text/plain' });
    assert.equal(noJson.status, 400);
    assert.equal(noJson.body.error.code, 'invalid_body');
    assert.equal(fake.calls.length, 0);
    assert.equal((await post('/api/runs', { url: `http://127.0.0.1:${port}/shop/original/`, goal: 'x'.repeat(500) })).status, 202);
    const { argv } = fake.calls[0];
    assert.equal(argv[argv.indexOf('--site') + 1], 'sites/shop/original');
  }, fake);
});

test('runDir in a path: must match ^[\\w.-]+$, not be . or .., and exist', () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-runs-'));
  fs.mkdirSync(path.join(runsDir, '2026-09-26T21-24-50-audit'));
  fs.writeFileSync(path.join(runsDir, 'file.json'), '{}');
  assert.equal(runDirPath(runsDir, '2026-09-26T21-24-50-audit'), path.join(runsDir, '2026-09-26T21-24-50-audit'));
  for (const bad of ['..', '.', '', 'a/b', '../x', '%2e%2e', 'nope', 'file.json', '.hidden', 'a\\b']) {
    assert.equal(runDirPath(runsDir, bad), null, bad);
  }
});

test('/api: unknown routes and run dirs → 404, wrong method → 405, same error shape', async () => {
  await withApi(async ({ port, post }) => {
    const bad = await post('/api/runs/..%2f..%2fetc/fix', {});
    assert.equal(bad.status, 404);
    assert.equal(bad.body.error.code, 'run_not_found');
    assert.equal((await post('/api/runs/nope/fix', {})).body.error.code, 'run_not_found');
    const unknown = await post('/api/nothing', {});
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'not_found');
    const del = await fetch(`http://127.0.0.1:${port}/api/runs`, { method: 'DELETE' });
    assert.equal(del.status, 405);
    assert.equal((await del.json()).error.code, 'method_not_allowed');
  });
});

// ---- P1: POST /api/runs/<runDir>/fix ----

/**
 * A finished run in runsDir (the recorded testpage audit); `edit(report)` adjusts its report.json. Finding ids are
 * renumbered when the fixture is re-recorded, so they are looked up by detector + planted barrier:
 * trap (T4) and pointerOnly (T5) are block findings, toast (unannounced T2) is degrade.
 */
function finishedRun(runsDir, name = '2026-09-26T21-24-50-audit', edit = () => {}) {
  const dir = path.join(runsDir, name);
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), path.join(dir, 'trace.jsonl'));
  const report = readJSON('fixtures/testpage-original/report.json');
  const idOf = (detector, barrierId) => {
    const f = report.findings.find((x) => x.detector === detector && x.evidence.barrierId === barrierId);
    assert.ok(f, `fixture has no ${detector} finding on barrier ${barrierId}`);
    return f.id;
  };
  const ids = { trap: idOf('trap', 'T4'), pointerOnly: idOf('pointer-only', 'T5'), toast: idOf('unannounced', 'T2') };
  edit(report);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
  return { name, dir, steps: report.timeline.length, ids };
}
const argOf = (argv, k) => argv[argv.indexOf(k) + 1];

test('POST fix: 202 + same runDir; progress is fixing (audit timeline kept) before the response; child argv', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post }) => {
    const run = finishedRun(runsDir);
    const r = await post(`/api/runs/${run.name}/fix`, { findingIds: [run.ids.trap, run.ids.pointerOnly], rerun: true });
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { runDir: run.name });
    const p = readProgress(run.dir);
    assert.ok(validateProgress(p), JSON.stringify(validateProgress.errors));
    assert.equal(p.state, 'fixing');
    assert.equal(p.timeline.length, run.steps);
    assert.equal(p.rerunDir, null);
    const { argv, runDir } = fake.calls[0];
    assert.equal(runDir, run.dir);
    assert.equal(argv[0], 'fix');
    assert.equal(argOf(argv, '--run'), run.dir);
    assert.equal(argOf(argv, '--out'), runsDir, 'the rerun must land where the API serves runs from');
    assert.equal(argOf(argv, '--findings'), `${run.ids.trap},${run.ids.pointerOnly}`);
    assert.ok(argv.includes('--rerun') && argv.includes('--progress'));
    assert.ok(argv.includes('--no-judge'), 'the audit ran without the judge, so the rerun does too');
  }, fake);
});

test('POST fix: no findingIds → all block findings (no --findings); rerun defaults to false; judge follows the audit', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post }) => {
    const run = finishedRun(runsDir, undefined, (r) => { r.meta.judge = true; });
    assert.equal((await post(`/api/runs/${run.name}/fix`, {})).status, 202);
    const { argv } = fake.calls[0];
    assert.ok(!argv.includes('--findings') && !argv.includes('--rerun') && !argv.includes('--no-judge'));
  }, fake);
});

test('POST fix: findingIds / rerun validation → 400', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post }) => {
    const run = finishedRun(runsDir);
    const cases = [
      [{ findingIds: ['NOPE'] }, 'invalid_findings'],
      [{ findingIds: [run.ids.trap, 'NOPE'] }, 'invalid_findings'],
      [{ findingIds: [] }, 'invalid_findings'],
      [{ findingIds: run.ids.trap }, 'invalid_findings'],
      [{ findingIds: [4] }, 'invalid_findings'],
      [{ findingIds: [run.ids.trap, run.ids.trap] }, 'invalid_findings'],
      [{ rerun: 'yes' }, 'invalid_rerun'],
      [[1], 'invalid_body'],
    ];
    for (const [body, code] of cases) {
      const r = await post(`/api/runs/${run.name}/fix`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error.code, code, JSON.stringify(body));
      assert.ok(r.body.error.message.length > 0);
    }
    assert.equal(fake.calls.length, 0);
    assert.ok(!fs.existsSync(path.join(run.dir, 'progress.json')), 'a rejected request leaves the run untouched');
  }, fake);
});

test('POST fix: runs that cannot be fixed → 409 (real site, no site source, patched copy, no report, nothing to fix)', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post }) => {
    const cases = [
      ['real', (r) => { r.meta.mode = 'real'; r.meta.site = null; }, 'real_site_no_fix'],
      ['nosite', (r) => { r.meta.site = null; }, 'not_fixable'],
      ['patched', (r) => { r.meta.site = 'sites/testpage/patched'; }, 'not_fixable'],
      ['noblock', (r) => { for (const f of r.findings) f.impact = 'degrade'; }, 'nothing_to_fix'],
    ];
    const runs = {};
    for (const [name, edit, code] of cases) {
      runs[name] = finishedRun(runsDir, name, edit);
      const r = await post(`/api/runs/${name}/fix`, {});
      assert.equal(r.status, 409, name);
      assert.equal(r.body.error.code, code, name);
    }
    assert.match((await post('/api/runs/real/fix', {})).body.error.message, /not fixed/i);
    assert.equal((await post('/api/runs/noblock/fix', { rerun: 'x' })).body.error.code, 'invalid_rerun', 'a bad body is a 400 before any 409');
    const noblock = await post('/api/runs/noblock/fix', { findingIds: [runs.noblock.ids.toast] });
    assert.equal(noblock.status, 202, 'explicit findingIds may name degrade findings');
    fake.calls[0].exit({ code: 0, signal: null, stderr: '' });
    await tick();
    fs.mkdirSync(path.join(runsDir, 'unfinished'));
    const unfinished = await post('/api/runs/unfinished/fix', {});
    assert.equal(unfinished.status, 409);
    assert.equal(unfinished.body.error.code, 'run_not_finished');
  }, fake);
});

test('fix and audit share the one-run-at-a-time lock', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post, site }) => {
    const run = finishedRun(runsDir);
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL })).status, 202);
    assert.equal((await post(`/api/runs/${run.name}/fix`, {})).body.error.code, 'run_in_progress');
    fake.calls[0].exit({ code: 0, signal: null, stderr: '' });
    await tick();
    assert.equal((await post(`/api/runs/${run.name}/fix`, {})).status, 202);
    assert.equal((await post('/api/runs', { url: site(), goal: GOAL })).body.error.code, 'run_in_progress');
  }, fake);
});

test('fix child crashes while rerunning → the run and its rerun are both marked failed', async () => {
  const fake = fakeSpawner();
  await withApi(async ({ runsDir, post }) => {
    const run = finishedRun(runsDir);
    await post(`/api/runs/${run.name}/fix`, { rerun: true });
    const rerunDir = path.join(runsDir, '2026-09-26T21-30-00-rerun');
    fs.mkdirSync(rerunDir);
    createProgressWriter(rerunDir)({ state: 'running', trace: [] });
    createProgressWriter(run.dir)({ state: 'rerunning', rerunDir: path.basename(rerunDir) });
    fake.calls[0].exit({ code: null, signal: 'SIGKILL', stderr: '' });
    await tick();
    const p = readProgress(run.dir);
    assert.ok(validateProgress(p));
    assert.equal(p.state, 'failed');
    assert.equal(p.error, 'The fix stopped unexpectedly: killed by SIGKILL');
    assert.equal(p.rerunDir, path.basename(rerunDir));
    const q = readProgress(rerunDir);
    assert.equal(q.state, 'failed');
    assert.match(q.error, /^The rerun stopped unexpectedly/);
  }, fake);
});

test('fix endpoint: wrong method → 405', async () => {
  await withApi(async ({ port, runsDir }) => {
    const run = finishedRun(runsDir);
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${run.name}/fix`);
    assert.equal(res.status, 405);
    assert.equal((await res.json()).error.code, 'method_not_allowed');
  });
});

// ---- P2: GET /api/runs ----

const LIST_FIELDS = ['runDir', 'url', 'goal', 'generatedAt', 'screenReaderUserCanComplete', 'state'].sort();

test('GET /api/runs: finished, fixing, running, runs/real/ entries newest first; broken dirs are counted in skipped', async () => {
  await withApi(async ({ port, runsDir }) => {
    const old = finishedRun(runsDir, '2026-09-26T20-00-00-audit');                         // report only (before progress.json existed)
    const fixing = finishedRun(runsDir, '2026-09-26T21-00-00-audit');
    createProgressWriter(fixing.dir)({ state: 'fixing', trace: [] });
    const running = path.join(runsDir, '2026-09-26T22-00-00-audit');
    fs.mkdirSync(running);
    createProgressWriter(running)({ state: 'running', trace: [], url: 'http://localhost:8080/shop/original/', goal: 'Buy socks' });
    const corrupt = path.join(runsDir, '2026-09-26T23-00-00-audit');
    fs.mkdirSync(corrupt);
    fs.writeFileSync(path.join(corrupt, 'report.json'), '{"meta": ');
    fs.mkdirSync(path.join(runsDir, '2026-09-26T23-30-00-replay'));                       // no report, no progress
    fs.writeFileSync(path.join(runsDir, 'notes.txt'), 'not a run');                         // plain files are not runs
    fs.mkdirSync(path.join(runsDir, 'real'));
    finishedRun(path.join(runsDir, 'real'), '2026-09-26T21-30-00-audit', (r) => { r.meta.mode = 'real'; r.meta.url = 'https://example.com/'; });
    fs.mkdirSync(path.join(runsDir, 'real', '2026-09-26T21-40-00-audit'));                 // broken real run

    const res = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.skipped, 3);
    assert.deepEqual(body.runs.map((r) => r.runDir), ['2026-09-26T22-00-00-audit', 'real/2026-09-26T21-30-00-audit', '2026-09-26T21-00-00-audit', '2026-09-26T20-00-00-audit']);
    for (const r of body.runs) assert.deepEqual(Object.keys(r).sort(), LIST_FIELDS, `${r.runDir}: only the list fields`);
    const [run, real, fix, done] = body.runs;
    assert.deepEqual(run, { runDir: '2026-09-26T22-00-00-audit', url: 'http://localhost:8080/shop/original/', goal: 'Buy socks', generatedAt: null, screenReaderUserCanComplete: null, state: 'running' });
    const report = readJSON('fixtures/testpage-original/report.json');
    assert.deepEqual(done, { runDir: old.name, url: report.meta.url, goal: report.meta.goal, generatedAt: report.meta.generatedAt,
      screenReaderUserCanComplete: report.verdicts.screenReaderUserCanComplete, state: 'done' });
    assert.equal(fix.state, 'fixing', 'a run being fixed keeps its audit verdict but shows the live state');
    assert.equal(fix.screenReaderUserCanComplete, report.verdicts.screenReaderUserCanComplete);
    assert.equal(real.url, 'https://example.com/');
    const shot = await fetch(`http://127.0.0.1:${port}/runs/${real.runDir}/report.json`);
    assert.equal(shot.status, 200, 'runDir of a real run is a path under /runs');
  });
});

test('GET /api/runs: a failed run with no report is listed as failed; a missing runs dir is an empty list', async () => {
  await withApi(async ({ port, runsDir }) => {
    const dir = path.join(runsDir, '2026-09-26T22-00-00-audit');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify({ state: 'failed', step: null, maxSteps: 25, timeline: [], rerunDir: null, error: 'boom', updatedAt: new Date().toISOString() }));
    const body = await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
    assert.deepEqual(body, { runs: [{ runDir: path.basename(dir), url: null, goal: null, generatedAt: null, screenReaderUserCanComplete: null, state: 'failed' }], skipped: 0 });
    fs.rmSync(runsDir, { recursive: true, force: true });
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json(), { runs: [], skipped: 0 });
    fs.mkdirSync(runsDir); // withApi removes it again
  });
});
