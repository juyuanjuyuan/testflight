// Orchestration: execute (AI acts, rules record) -> analyze (rules propose, AI judges) -> report.
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './runner/session.mjs';
import { blockType, reachedBoundary } from './runner/guard.mjs';
import { nextAction } from './agent/planner.mjs';
import { runDetectors } from './detect/index.mjs';
import { judge } from './agent/judge.mjs';
import { buildReport, writeReport } from './report/build.mjs';
import { MAX_STEPS, validateStep } from './contracts.mjs';
import { RUNS_DIR } from './paths.mjs';

const describeAction = (a) => `${a.kind}${a.key ? ' ' + a.key : ''}${a.text ? ` "${a.text}"` : ''}`;

export function newRunDir(out = RUNS_DIR, label = 'run') {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${label}`;
  const dir = path.join(out, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
 * @param {{url:string, goal:string, out:string, mode?:'local'|'real', cdp?:string, script?:object[],
 *          judgeEnabled?:boolean, headless?:boolean, label?:string, site?:string, log?:(msg:string)=>void}} o
 */
export async function audit(o) {
  const log = o.log || (() => {});
  const runDir = newRunDir(o.out, o.label || 'audit');
  const tracePath = path.join(runDir, 'trace.jsonl');
  const stats = {};
  const s = await openSession({ url: o.url, runDir, mode: o.mode, cdp: o.cdp, headless: o.headless !== false });
  const trace = [];
  let axe = null;
  const push = (step) => {
    const err = validateStep(step);
    if (err) throw new Error(`runner produced invalid step ${step.i}: ${err}`);
    trace.push(step);
    fs.appendFileSync(tracePath, JSON.stringify(step) + '\n');
    log(`[${step.i}] ${describeAction(step.action)} → ${step.focusAfter.role} "${step.focusAfter.name}"  · ${step.action.reason}`);
  };
  try {
    push(await s.start());
    for (let n = 0; n < MAX_STEPS; n++) {
      let action = o.script ? o.script[n] : await nextAction({ goal: o.goal, trace, stats });
      if (!action) action = { kind: 'stuck', reason: 'script exhausted' };
      const cur = trace[trace.length - 1];
      if (o.mode === 'real') {
        if (reachedBoundary(cur.url, cur.title)) action = { kind: 'done', reason: 'reached checkout boundary (real-site safety stop)' };
        else if (action.kind === 'type') { const why = blockType(cur.focusAfter); if (why) action = { kind: 'stuck', reason: why }; }
      }
      push(await s.step(action)); // done/stuck steps are recorded too (no key pressed) so the trace ends with the outcome
      if (action.kind === 'done' || action.kind === 'stuck') break;
    }
  } finally {
    axe = s.axeResults();
    await s.close();
  }
  fs.writeFileSync(path.join(runDir, 'axe.json'), JSON.stringify(axe, null, 2));
  const meta = { url: o.url, mode: o.mode || 'local', site: o.site || null, script: !!o.script };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, goal: o.goal }, null, 2));
  const res = await analyze({ trace, goal: o.goal, meta, runDir, judgeEnabled: o.judgeEnabled !== false, axe, stats, log });
  return { runDir, ...res };
}
