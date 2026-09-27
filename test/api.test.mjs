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
