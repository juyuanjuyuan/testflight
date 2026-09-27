// Orchestration: execute (AI acts, rules record) -> analyze (rules propose, AI judges) -> report.
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './runner/session.mjs';
import { blockAction, forceReplace, reachedBoundary } from './runner/guard.mjs';
import { nextAction } from './agent/planner.mjs';
import { runDetectors } from './detect/index.mjs';
import { judge } from './agent/judge.mjs';
import { buildReport, writeReport } from './report/build.mjs';
import { MAX_STEPS, MAX_STEPS_REAL, validateStep } from './contracts.mjs';
import { RUNS_DIR } from './paths.mjs';

const describeAction = (a) => `${a.kind}${a.replace ? ' (replace)' : ''}${a.key ? ' ' + a.key : ''}${a.text ? ` "${a.text}"` : ''}`;

/** Create and return a fresh runs/<timestamp>-<label> dir; a second run in the same second gets -2, -3… (never shares a dir). */
export function newRunDir(out = RUNS_DIR, label = 'run') {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${label}`;
  fs.mkdirSync(out, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = path.join(out, n === 1 ? id : `${id}-${n}`);
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

/** Deterministic analysis of an existing trace (no browser). Used by audit, `replay`, and eval ablations. */
export async function analyze({ trace, goal, meta, runDir, judgeEnabled = true, axe = null, stats = {}, log = () => {} }) {
  const candidates = runDetectors(trace);
  const findings = await judge({ goal, trace, candidates, enabled: judgeEnabled, stats, log });
  fs.writeFileSync(path.join(runDir, 'candidates.json'), JSON.stringify(candidates, null, 2));
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings, null, 2));
  const report = buildReport({ meta: { ...meta, goal, judge: judgeEnabled }, trace, findings, axe, stats });
  writeReport(runDir, report);
  return { candidates, findings, report };
}

/**
 * url is optional in real mode (the tab the human has open is audited; meta.url records where it actually started).
 * @param {{url?:string, goal:string, out?:string, runDir?:string, mode?:'local'|'real', cdp?:string, script?:object[],
 *          judgeEnabled?:boolean, headless?:boolean, label?:string, site?:string, log?:(msg:string)=>void,
 *          onProgress?:(p:{state:string, trace?:object[], error?:string, maxSteps:number})=>void, openSession?:Function,
 *          waitForUser?:()=>Promise<void>}} o
 * runDir: an existing dir to use (the HTTP API creates it first); default a new one under `out`.
 * onProgress: called with state running (after each step, screenshot on disk) → analyzing → done (after report.json) | failed.
 * openSession: replaces the browser session (tests only).
 * waitForUser (real mode): resolved once the human has cleared captcha/login; the agent loop starts after it.
 */
export async function audit(o) {
  if (o.mode !== 'real' && !o.url) throw new Error('audit needs a url (only real mode can take over the open tab)');
  const log = o.log || (() => {});
  const maxSteps = o.mode === 'real' ? MAX_STEPS_REAL : MAX_STEPS;
  const onProgress = (u) => o.onProgress?.({ ...u, maxSteps });
  if (o.runDir && !fs.statSync(o.runDir).isDirectory()) throw new Error(`run dir is not a directory: ${o.runDir}`);
  const runDir = o.runDir || newRunDir(o.out, o.label || 'audit');
  const trace = [];
  try {
    const res = await execute(o, runDir, trace, log, onProgress, maxSteps);
    onProgress({ state: 'done', trace });
    return { runDir, ...res };
  } catch (e) {
    onProgress({ state: 'failed', trace, error: e.message.split('\n')[0] });
    throw e;
  }
}

async function execute(o, runDir, trace, log, onProgress, maxSteps) {
  const tracePath = path.join(runDir, 'trace.jsonl');
  const stats = {};
  const s = await (o.openSession || openSession)({ url: o.url, runDir, mode: o.mode, cdp: o.cdp, headless: o.headless !== false, waitForUser: o.waitForUser });
  let axe = null;
  const push = (step) => {
    const err = validateStep(step);
    if (err) throw new Error(`runner produced invalid step ${step.i}: ${err}`);
    trace.push(step);
    fs.appendFileSync(tracePath, JSON.stringify(step) + '\n');
    log(`[${step.i}] ${describeAction(step.action)} → ${step.focusAfter.role} "${step.focusAfter.name}"  · ${step.action.reason}`);
    onProgress({ state: 'running', trace });
  };
  try {
    push(await s.start());
    for (let n = 0; n < maxSteps; n++) {
      const cur = trace[trace.length - 1];
      // boundary first: once at checkout neither the planner nor the script gets another action
      let action = o.mode === 'real' && reachedBoundary(cur.url, cur.title) ? { kind: 'done', reason: 'reached checkout boundary (real-site safety stop)' }
        : o.script ? o.script[n] : await nextAction({ goal: o.goal, trace, stats, maxSteps });
      if (!action) action = { kind: 'stuck', reason: 'script exhausted' };
      if (o.mode === 'real') { const why = blockAction(action, cur.focusAfter); action = why ? { kind: 'stuck', reason: why } : forceReplace(action); }
      push(await s.step(action)); // done/stuck steps are recorded too (no key pressed) so the trace ends with the outcome
      if (action.kind === 'done' || action.kind === 'stuck') break;
    }
  } finally {
    axe = s.axeResults();
    await s.close();
  }
  fs.writeFileSync(path.join(runDir, 'axe.json'), JSON.stringify(axe, null, 2));
  const meta = { url: o.mode === 'real' ? trace[0].url : o.url, mode: o.mode || 'local', site: o.site || null, script: !!o.script };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, goal: o.goal }, null, 2));
  onProgress({ state: 'analyzing', trace });
  return analyze({ trace, goal: o.goal, meta, runDir, judgeEnabled: o.judgeEnabled !== false, axe, stats, log });
}
