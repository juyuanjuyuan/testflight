// End-to-end smoke test with a real browser, no LLM: serve sites/, audit testpage original + fixed, score both.
// Uses its own port (default 8090, override with PORT) so it doesn't collide with a dev `npm run serve` on 8080.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../src/audit.mjs';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';
import { heardInStep } from '../src/agent/observation.mjs';
import { scoreRun } from '../eval/score.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const port = Number(process.env.PORT || 8090);
const SERVER_READY_MS = 10_000;
const GOAL = 'Buy the canvas tote bag';
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const API_RUN_TIMEOUT_MS = 120_000;
const POLL_MS = 250;

// Resolve only on the server's own "serving" line: polling the URL could hit some other process already on the port.
function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start on port ${port} within ${SERVER_READY_MS}ms`)), SERVER_READY_MS);
    child.stdout.on('data', (d) => { if (String(d).includes('serving sites/')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (code ${code}) before listening on port ${port}: ${stderr.split('\n').find((l) => /Error/.test(l)) || stderr.trim().split('\n').pop() || 'no output'}`)); });
  });
  return { child, ready };
}

// "Email" stands in for a value the user typed or the browser autofilled; "Search" is what the script types into.
// value set by script (like autofill) and split so the full string never appears in the data: URL itself
const FORM = `data:text/html,<title>Form</title><label>Email <input id=email></label> <label>Search <input id=q></label><script>email.value='me@'+'example.com'</script>`;
const FORM_SCRIPT = [{ kind: 'press', key: 'Tab', reason: 'to Email' }, { kind: 'press', key: 'Tab', reason: 'to Search' },
  { kind: 'type', text: 'tote', reason: 'search' }, { kind: 'press', key: 'Shift+Tab', reason: 'back to Email' },
  // Tab selects a field's content (typing would overwrite it anyway); End puts the caret after it so typing appends
  { kind: 'press', key: 'End', reason: 'caret after the prefilled Email' },
  { kind: 'type', text: 'agent@test.dev', reason: 'append to the prefilled Email' }, { kind: 'stuck', reason: 'end' }];
const valueAt = (trace, i) => trace[i].focusAfter.value;

// D5 probe: one control per focus-style pattern, visited in Tab order. Expected focusVisible per step 1..6.
// Block buttons: the recorder diffs text by line, so the js button's class change must not share a line with the others.
const FOCUS = `data:text/html,${encodeURIComponent(`<title>Focus</title><style>
  button{display:block} .none:focus{outline:none} .ring:focus{outline:none;box-shadow:0 0 0 3px blue}
  .after{position:relative;outline:none} .after:focus::after{content:'';position:absolute;inset:-3px;border:2px solid red}
  .js{outline:none} .js.is-focus{background:yellow}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)} .sr:focus + span{outline:2px solid}
</style><button>default</button><button class=none>none</button><button class=ring>ring</button><button class=after>after</button>
<button class=js onfocus="this.classList.add('is-focus')">js</button><input class=sr type=checkbox><span>sr-only</span>`)}`;
const FOCUS_EXPECT = [true, false, true, true, true, null]; // js: page adds the class on focus; sr-only: ring is on the sibling

// D6 probe: a clickable wrapper around a real control (common on big shops: <span class=button><input type=submit>)
// is reachable through that control; a bare clickable div, or one holding only a hidden input, is not.
const POINTER = `data:text/html,${encodeURIComponent(`<title>Pointer</title><style>.c{cursor:pointer;display:block;margin:8px}</style>
<span class=c onclick="0" id=wrap><input type=submit aria-label="Add to cart" style="opacity:0;position:absolute"><span>Add to cart</span></span>
<div class=c onclick="0" id=coupon>Apply coupon</div><div class=c onclick="0" id=hid><input type=hidden><span>Hidden only</span></div>`)}`;

const CASES = [
  { name: 'testpage/original', script: 'eval/keys.testpage.json', groundtruth: 'eval/groundtruth/testpage.yaml',
    check: (s) => [s.hits === s.planted && s.planted === 6 || `detected ${s.hits}/${s.planted}, expected 6/6 (missed: ${s.misses.join(' ')})`,
      s.falsePositives === 0 || `${s.falsePositives} false positives, expected 0`] },
  { name: 'testpage/fixed', script: 'eval/keys.testpage.fixed.json', groundtruth: 'eval/groundtruth/testpage-fixed.yaml',
    check: (s, r) => [s.falsePositives === 0 || `${s.falsePositives} false positives, expected 0`,
      r.verdicts.screenReaderUserCanComplete === true || `screenReaderUserCanComplete is ${r.verdicts.screenReaderUserCanComplete}, expected true`] },
  // type with replace:true overwrites the rejected short card; the AX value the screen reader reads is recorded
  { name: 'testpage/fixed', label: 'replace', script: 'eval/keys.testpage.replace.json', groundtruth: 'eval/groundtruth/testpage-fixed.yaml',
    check: (s, r, trace) => [heardInStep(trace[11]).includes('Order confirmed') || `after Pay heard ${JSON.stringify(heardInStep(trace[11]))}, expected "Order confirmed"`,
      trace[5].focusAfter.value === '4242 4242' || `AX value after first type is ${JSON.stringify(trace[5].focusAfter.value)}, expected "4242 4242"`,
      trace[9].focusAfter.value === '4242 4242 4242 4242' || `AX value after replace is ${JSON.stringify(trace[9].focusAfter.value)}, expected the 16-digit number only`] },
  // a password field's AX value is masked, so the planner never hears the secret
  { name: 'password', url: `data:text/html,<label>Password <input type=password></label>`, goal: 'log in',
    script: [{ kind: 'press', key: 'Tab', reason: 'find field' }, { kind: 'type', text: 'hunter2', reason: 'type' }, { kind: 'stuck', reason: 'end' }],
    check: (s, r, trace) => [typeof trace[2].focusAfter.value === 'string' || 'no AX value recorded for the password field',
      !String(trace[2].focusAfter.value).includes('hunter2') || 'password value leaked into focusAfter.value'] },
  // local mode records every field value (our own test sites) ...
  { name: 'form', label: 'local', url: FORM, goal: 'search', script: FORM_SCRIPT,
    check: (s, r, trace) => [valueAt(trace, 1) === 'me@example.com' || `local Email value is ${JSON.stringify(valueAt(trace, 1))}, expected it recorded`,
      valueAt(trace, 3) === 'tote' || `local Search value is ${JSON.stringify(valueAt(trace, 3))}, expected "tote"`,
      valueAt(trace, 6) === 'me@example.comagent@test.dev' || `local Email after appending is ${JSON.stringify(valueAt(trace, 6))}, expected type to append`,
      !trace[6].action.replace && !trace[6].action.forcedReplace || 'local mode must not force replace'] },
  // ... real mode records only what the planner typed itself
  { name: 'form', label: 'real', url: FORM, goal: 'search', script: FORM_SCRIPT, mode: 'real',
    check: (s, r, trace, runDir) => [valueAt(trace, 1) === null && trace[1].focusAfter.valueRedacted === true || `real Email value is ${JSON.stringify(valueAt(trace, 1))}, expected null + valueRedacted`,
      valueAt(trace, 3) === 'tote' || `real Search value is ${JSON.stringify(valueAt(trace, 3))}, expected "tote"`,
      valueAt(trace, 4) === null || `real Email value after returning is ${JSON.stringify(valueAt(trace, 4))}, expected null`,
      valueAt(trace, 6) === 'agent@test.dev' || `real Email after the agent typed is ${JSON.stringify(valueAt(trace, 6))}, expected only "agent@test.dev"`,
      trace[6].action.replace === true && trace[6].action.forcedReplace === true || `real type action recorded as ${JSON.stringify(trace[6].action)}, expected replace + forcedReplace`,
      !fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8').includes('me@example.com') || 'autofilled value leaked into trace.jsonl',
      !fs.readFileSync(path.join(runDir, 'report.json'), 'utf8').includes('me@example.com') || 'autofilled value leaked into report.json'] },
  { name: 'pointer-only', url: POINTER, goal: 'add to cart', script: [{ kind: 'stuck', reason: 'scan' }],
    check: (s, r, trace) => [JSON.stringify(trace[1].unreachableClickables.map((u) => u.selector)) === '["#coupon","#hid"]'
      || `unreachable ${JSON.stringify(trace[1].unreachableClickables.map((u) => u.selector))}, expected ["#coupon","#hid"] (the wrapper holds a focusable input)`] },
  // default ring, outline:none, box-shadow ring, ::after ring, class added by a focus handler, sr-only input (not judged)
  { name: 'focus-visible', url: FOCUS, goal: 'look around', script: [...FOCUS_EXPECT.map(() => ({ kind: 'press', key: 'Tab', reason: 'next' })), { kind: 'stuck', reason: 'end' }],
    check: (s, r, trace) => [...FOCUS_EXPECT.map((want, k) => trace[k + 1].focusVisible === want || `step ${k + 1} (${trace[k + 1].focusAfter.name}): focusVisible ${trace[k + 1].focusVisible}, expected ${want}`),
      trace.every((st) => st.changes.length === 0) || 'the D5 probe copy was recorded as a page change',
      r.findings.filter((f) => f.detector === 'focus-visible').length === 1 || 'expected exactly one focus-visible finding (the outline:none button)'] },
];

// Real mode attaches to a browser the human already opened; stand one up with a CDP port and the page loaded.
async function withRealBrowser(url, fn) {
  const cdpPort = port + 1;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-real-'));
  const ctx = await chromium.launchPersistentContext(profile,
    { headless: true, args: [`--remote-debugging-port=${cdpPort}`], executablePath: process.env.CHROME_BIN || undefined });
  try {
    await (ctx.pages()[0] || await ctx.newPage()).goto(url);
    return await fn(`http://127.0.0.1:${cdpPort}`);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function runCase(c) {
  const name = c.label ? `${c.name} (${c.label})` : c.name;
  const url = c.url || `http://localhost:${port}/${c.name}/`;
  const run = (cdp) => audit({ url, goal: c.goal || GOAL, mode: c.mode, cdp,
    script: Array.isArray(c.script) ? c.script : readJSON(c.script), judgeEnabled: false, site: c.url ? null : `sites/${c.name}`,
    label: `smoke-${[c.name, c.label].filter(Boolean).join('-').replace('/', '-')}` });
  const { runDir, report } = c.mode === 'real' ? await withRealBrowser(url, run) : await run();
  if (!c.label && c.name === 'testpage/original') cliReport = report; // the API case must reproduce this
  const trace = readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8'));
  const score = c.groundtruth ? scoreRun({ runDir, groundtruth: path.join(ROOT, c.groundtruth) }) : null;
  const failures = c.check(score, report, trace, runDir).filter((x) => x !== true);
  const detail = score ? `detected ${score.hits}/${score.planted} · false positives ${score.falsePositives} · ` : '';
  console.log(`${failures.length ? 'FAIL' : 'ok  '} ${name}: ${detail}SR user can complete ${report.verdicts.screenReaderUserCanComplete} · ${path.relative(ROOT, runDir)}`);
  for (const f of failures) console.log(`       ✗ ${f}`);
  return failures.length === 0;
}

// The frontend's flow (docs/API.md): POST /api/runs with a key script, poll progress.json to done, then read report.json.
let cliReport = null;
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(readJSON('docs/report.schema.json'));
const validProgress = ajv.compile(readJSON('docs/progress.schema.json'));
const validReport = ajv.getSchema(readJSON('docs/report.schema.json').$id);
const STATE_ORDER = ['running', 'analyzing', 'done'];
// carousel noise, "appeared Nms after" and timings vary run to run; everything the verdict rests on must match
const stable = (r) => ({ meta: { ...r.meta, generatedAt: null, startedAt: null, finishedAt: null }, verdicts: r.verdicts, counts: r.counts, axe: r.axe,
  findings: r.findings.map((f) => [f.id, f.impact, f.detector, f.layer, f.wcag, f.steps, f.evidence.text]),
  timeline: r.timeline.map((t) => [t.i, t.action, t.url, t.focus, t.heard, t.seen.map((x) => x.text), t.findingIds]) });

async function runApiCase() {
  const base = `http://localhost:${port}`;
  const post = (body) => fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post({ url: `${base}/testpage/original/`, goal: GOAL, script: 'keys.testpage.json' });
  const { runDir } = await res.json();
  const failures = [res.status === 202 || `POST /api/runs → ${res.status}, expected 202`];
  const busy = await post({ url: `${base}/testpage/original/`, goal: GOAL });
  failures.push(busy.status === 409 || `second POST while running → ${busy.status}, expected 409`);
  const states = [];
  const t0 = Date.now();
  let p;
  for (;;) {
    const r = await fetch(`${base}/runs/${runDir}/progress.json`);
    if (r.status !== 200) { failures.push(`progress.json → ${r.status} after ${Date.now() - t0}ms`); break; }
    p = await r.json();
    if (!validProgress(p)) failures.push(`progress.json (${p.state}) does not match the schema: ${ajv.errorsText(validProgress.errors)}`);
    if (states.at(-1) !== p.state) states.push(p.state);
    if (p.state === 'done' || p.state === 'failed' || Date.now() - t0 > API_RUN_TIMEOUT_MS) break;
    await new Promise((r2) => setTimeout(r2, POLL_MS));
  }
  failures.push(p?.state === 'done' || `run ended in ${p?.state}${p?.error ? ': ' + p.error : ''}, expected done`);
  failures.push(states.every((st, k) => k === 0 || STATE_ORDER.indexOf(st) > STATE_ORDER.indexOf(states[k - 1])) || `states out of order: ${states.join(' → ')}`);
  if (p?.state === 'done') {
    const report = await (await fetch(`${base}/runs/${runDir}/report.json`)).json();
    failures.push(validReport(report) || `report.json does not match the schema: ${ajv.errorsText(validReport.errors)}`);
    const shots = await Promise.all(report.timeline.filter((t) => t.screenshot).map((t) => fetch(`${base}/runs/${runDir}/${t.screenshot}`).then((r) => r.status)));
    failures.push(shots.length > 0 && shots.every((st) => st === 200) || `screenshots not all served: ${shots.join(',')}`);
    failures.push(p.timeline.length === report.timeline.length || `progress has ${p.timeline.length} steps, report ${report.timeline.length}`);
    failures.push(!cliReport || JSON.stringify(stable(report)) === JSON.stringify(stable(cliReport)) || 'report.json differs from the same audit run directly');
    const { startedAt, finishedAt, maxSteps } = report.meta;
    failures.push(startedAt < finishedAt && finishedAt <= report.meta.generatedAt && maxSteps === p.maxSteps || `meta timing/limit wrong: ${startedAt} ${finishedAt} ${maxSteps}`);
    failures.push(report.timeline.every((t, k) => (k === 0 ? t.t === 0 : t.t >= report.timeline[k - 1].t)) || 'timeline[].t does not start at 0 and grow');
    const listed = (await (await fetch(`${base}/api/runs`)).json()).runs.find((r) => r.runDir === runDir);
    failures.push(listed?.state === 'done' && listed.screenReaderUserCanComplete === report.verdicts.screenReaderUserCanComplete || `GET /api/runs entry: ${JSON.stringify(listed)}`);
  }
  const failed = failures.filter((x) => x !== true);
  console.log(`${failed.length ? 'FAIL' : 'ok  '} api: POST /api/runs → ${states.join(' → ')} · runs/${runDir}`);
  for (const f of failed) console.log(`       ✗ ${f}`);
  return failed.length === 0;
}

const server = startServer();
let passed = false;
try {
  await server.ready;
  const results = [];
  for (const c of CASES) results.push(await runCase(c));
  results.push(await runApiCase());
  passed = results.every(Boolean);
} catch (e) {
  console.error(process.env.DEBUG ? e : `smoke error: ${e.message.split('\n')[0]} (DEBUG=1 for details)`);
} finally {
  server.child.kill();
}
process.exit(passed ? 0 : 1);
