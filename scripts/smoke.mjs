// End-to-end smoke test with a real browser, no LLM: serve sites/, audit testpage original + fixed, score both.
// Uses its own port (default 8090, override with PORT) so it doesn't collide with a dev `npm run serve` on 8080.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../src/audit.mjs';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';
import { heardInStep } from '../src/agent/observation.mjs';
import { scoreRun } from '../eval/score.mjs';

const port = Number(process.env.PORT || 8090);
const SERVER_READY_MS = 10_000;
const GOAL = 'Buy the canvas tote bag';
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

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

const CASES = [
  { name: 'testpage/original', script: 'eval/keys.testpage.json', groundtruth: 'eval/groundtruth/testpage.yaml',
    check: (s) => [s.hits === s.planted && s.planted === 4 || `detected ${s.hits}/${s.planted}, expected 4/4 (missed: ${s.misses.join(' ')})`,
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
];

async function runCase(c) {
  const name = c.label ? `${c.name} (${c.label})` : c.name;
  const { runDir, report } = await audit({ url: c.url || `http://localhost:${port}/${c.name}/`, goal: c.goal || GOAL,
    script: Array.isArray(c.script) ? c.script : readJSON(c.script), judgeEnabled: false, site: c.url ? null : `sites/${c.name}`,
    label: `smoke-${[c.name, c.label].filter(Boolean).join('-').replace('/', '-')}` });
  const trace = readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8'));
  const score = c.groundtruth ? scoreRun({ runDir, groundtruth: path.join(ROOT, c.groundtruth) }) : null;
  const failures = c.check(score, report, trace).filter((x) => x !== true);
  const detail = score ? `detected ${score.hits}/${score.planted} · false positives ${score.falsePositives} · ` : '';
  console.log(`${failures.length ? 'FAIL' : 'ok  '} ${name}: ${detail}SR user can complete ${report.verdicts.screenReaderUserCanComplete} · ${path.relative(ROOT, runDir)}`);
  for (const f of failures) console.log(`       ✗ ${f}`);
  return failures.length === 0;
}

const server = startServer();
let passed = false;
try {
  await server.ready;
  const results = [];
  for (const c of CASES) results.push(await runCase(c));
  passed = results.every(Boolean);
} catch (e) {
  console.error(process.env.DEBUG ? e : `smoke error: ${e.message.split('\n')[0]} (DEBUG=1 for details)`);
} finally {
  server.child.kill();
}
process.exit(passed ? 0 : 1);
