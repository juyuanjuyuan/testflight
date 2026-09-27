// Orchestration: execute (AI acts, rules record) -> analyze (rules propose, AI judges) -> report.
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from './runner/session.mjs';
import { blockAction, forceReplace, reachedBoundary } from './runner/guard.mjs';
import { runnerAction } from './runner/assist.mjs';
import { nextAction } from './agent/planner.mjs';
import { suggestTasks, appendTestData, siteKeyFromUrl } from './agent/tasker.mjs';
import { runDetectors } from './detect/index.mjs';
import { judge } from './agent/judge.mjs';
import { buildReport, writeReport } from './report/build.mjs';
import { MAX_STEPS, MAX_STEPS_REAL, ASSIST_EXTRA_STEPS, validateStep } from './contracts.mjs';
import { RUNS_DIR } from './paths.mjs';

const NO_TASK = 'Could not work out a task for this page. Please describe one.';
const describeAction = (a) => `${a.kind}${a.replace ? ' (replace)' : ''}${a.key ? ' ' + a.key : ''}${a.text ? ` "${a.text}"` : ''}${a.target ? ` ${a.target}` : ''}`;

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
  // a live run (meta.startedAt) ends when its analysis does; a replay has no run of its own to time
  const finished = meta.startedAt ? { finishedAt: new Date().toISOString() } : {};
  const report = buildReport({ meta: { ...meta, goal, judge: judgeEnabled, ...finished }, trace, findings, axe, stats });
  writeReport(runDir, report);
  return { candidates, findings, report };
}

/**
 * url is optional in real mode (the tab the human has open is audited; meta.url records where it actually started).
 * goal is optional: without it the task is picked after step 0 from what the planner sees then (agent/tasker.mjs);
 * progress shows planning_task until it is known, and meta.goalSource/goalReason/testDataProfile record where it came from.
 * A user goal may get test values appended (userGoal); progress and meta.goal then carry the full goal, meta.goalInput the input.
 * @param {{url?:string, goal?:string, out?:string, runDir?:string, mode?:'local'|'real', cdp?:string, script?:object[],
 *          judgeEnabled?:boolean, headless?:boolean, trace?:boolean, label?:string, site?:string, log?:(msg:string)=>void,
 *          onProgress?:(p:{state:string, trace?:object[], error?:string, maxSteps:number, url:string|null, goal:string})=>void, openSession?:Function,
 *          waitForUser?:()=>Promise<void>}} o
 * runDir: an existing dir to use (the HTTP API creates it first); default a new one under `out`.
 * Local planner runs: a confirmed keyboard trap is closed by a sighted helper's mouse click (runner/assist.mjs); the session
 * must then offer mouseExit(fromSelector). Each assist raises the step limit by ASSIST_EXTRA_STEPS (meta.maxSteps is the final one).
 * onProgress: called with state [waiting_for_user (real mode, before the session opens, until Enter) →] [planning_task (no goal yet) →] running (after each step, screenshot on disk) → analyzing → done (after report.json) | failed.
 * trace: Playwright trace to <runDir>/trace.zip (debugging); meta.json records trace or traceError.
 * openSession, llmClient: replace the browser session and the tasker's and planner's LLM client (tests only).
 * waitForUser (real mode): resolved once the human has cleared captcha/login; the agent loop starts after it.
 */
/** The state a run starts in: real mode waits for the human (captcha/login, Enter) first; without a goal the task is picked next. */
export function firstState({ mode, goal }) {
  return mode === 'real' ? 'waiting_for_user' : goal ? 'running' : 'planning_task';
}

export async function audit(o) {
  if (o.mode !== 'real' && !o.url) throw new Error('audit needs a url (only real mode can take over the open tab)');
  const log = o.log || (() => {});
  const limit = { maxSteps: o.mode === 'real' ? MAX_STEPS_REAL : MAX_STEPS }; // grows by ASSIST_EXTRA_STEPS per assist
  const startedAt = new Date().toISOString();
  const trace = [];
  const task = o.goal ? userTask(o, log) : { goal: null };
  // same url as meta.url: real mode records where the human's tab actually was (known once step 0 is recorded)
  const onProgress = (u) => o.onProgress?.({ ...u, maxSteps: limit.maxSteps, url: (o.mode === 'real' ? trace[0]?.url : o.url) ?? null, goal: task.goal });
  if (o.runDir && !fs.statSync(o.runDir).isDirectory()) throw new Error(`run dir is not a directory: ${o.runDir}`);
  const runDir = o.runDir || newRunDir(o.out, o.label || 'audit');
  try {
    onProgress({ state: firstState(o), trace }); // before the session opens: the run is visible while Chrome attaches
    const res = await execute(o, task, runDir, trace, log, onProgress, { limit, startedAt });
    onProgress({ state: 'done', trace });
    return { runDir, ...res };
  } catch (e) {
    onProgress({ state: 'failed', trace, error: e.message.split('\n')[0] });
    throw e;
  }
}

/**
 * A user goal as the planner gets it: local demo sites with a test-data config get their values appended when the goal
 * has no digits ("buy one thing" would otherwise stop at the card field). goalInput/testDataAppended only when appended.
 */
export function userGoal({ goal, url, site, mode }) {
  const r = appendTestData({ goal, siteKey: site || siteKeyFromUrl(url), mode: mode || 'local' });
  return r.appended ? { goal: r.goal, goalInput: goal, testDataAppended: true, testDataProfile: r.profile } : { goal, testDataProfile: null };
}

function userTask(o, log) {
  const t = userGoal(o);
  if (t.testDataAppended) log(`test data appended to the goal (config/test-data/${t.testDataProfile}.json): ${t.goal}`);
  return { goalSource: 'user', goalReason: null, ...t };
}

// The tasker sees step 0 exactly as the planner would: url, title and AX page text.
async function pickTask(o, start, stats, log) {
  let res;
  try {
    res = await suggestTasks({ url: start.url, title: start.title, pageText: start.pageText, mode: o.mode || 'local', siteKey: o.site || null, stats, client: o.llmClient });
  } catch (e) {
    throw new Error(`${NO_TASK} (${e.message.split('\n')[0]})`, { cause: e });
  }
  const [s] = res.suggestions;
  log(`task (${s.source}): ${s.goal} · ${s.reason}`);
  return { goal: s.goal, goalSource: s.source, goalReason: s.reason, testDataProfile: res.testDataProfile };
}

/**
 * Local planner runs only (runner/assist.mjs): a scripted route must replay exactly, and real sites are never clicked.
 * An assist whose dialog has no close control to click ends the run: the trap is the reason, and it is reported.
 */
async function runnerMove(o, session, trace) {
  if (o.script || o.mode === 'real') return null;
  const a = runnerAction(trace);
  if (a?.kind !== 'assist') return a;
  const exit = await session.mouseExit(trace[trace.length - 1].focusAfter.selector);
  return exit ? { ...a, target: exit.selector, reason: `${a.reason}; a sighted helper clicked "${exit.text}" with the mouse` }
    : { kind: 'stuck', reason: `${a.reason}, and the dialog has no close control a mouse user could click either` };
}

async function execute(o, task, runDir, trace, log, onProgress, { limit, startedAt }) {
  const tracePath = path.join(runDir, 'trace.jsonl');
  const stats = {};
  let state = firstState(o);
  // real mode: waiting_for_user until the human presses Enter; then the state the run would have started in locally
  const waitForUser = async () => {
    await o.waitForUser?.();
    state = task.goal ? 'running' : 'planning_task';
    onProgress({ state, trace });
  };
  const s = await (o.openSession || openSession)({ url: o.url, runDir, mode: o.mode, cdp: o.cdp, headless: o.headless !== false, trace: !!o.trace,
    waitForUser: o.mode === 'real' ? waitForUser : o.waitForUser });
  if (state === 'waiting_for_user') state = task.goal ? 'running' : 'planning_task'; // a session that never waited (tests)
  let axe = null, traced = {};
  const push = (step) => {
    const err = validateStep(step);
    if (err) throw new Error(`runner produced invalid step ${step.i}: ${err}`);
    trace.push(step);
    fs.appendFileSync(tracePath, JSON.stringify(step) + '\n');
    log(`[${step.i}] ${describeAction(step.action)} → ${step.focusAfter.role} "${step.focusAfter.name}"  · ${step.action.reason}`);
    onProgress({ state, trace });
  };
  try {
    push(await s.start());
    if (!task.goal) {
      Object.assign(task, await pickTask(o, trace[0], stats, log));
      state = 'running';
      onProgress({ state, trace });
    }
    for (let n = 0; n < limit.maxSteps; n++) {
      const cur = trace[trace.length - 1];
      // boundary first: once at checkout neither the planner nor the script gets another action
      let action = o.mode === 'real' && reachedBoundary(cur.url, cur.title) ? { kind: 'done', reason: 'reached checkout boundary (real-site safety stop)' }
        : o.script ? o.script[n] : (await runnerMove(o, s, trace)) ?? await nextAction({ goal: task.goal, trace, stats, maxSteps: limit.maxSteps, client: o.llmClient });
      if (!action) action = { kind: 'stuck', reason: 'script exhausted' };
      if (o.mode === 'real') { const why = blockAction(action, cur.focusAfter); action = why ? { kind: 'stuck', reason: why } : forceReplace(action); }
      if (action.kind === 'assist') limit.maxSteps += ASSIST_EXTRA_STEPS; // before push: progress shows the new limit
      push(await s.step(action)); // done/stuck steps are recorded too (no key pressed) so the trace ends with the outcome
      if (action.kind === 'done' || action.kind === 'stuck') break;
    }
  } finally {
    axe = s.axeResults();
    traced = (await s.close()) ?? {}; // a replacement session may return nothing
  }
  if (traced.trace) log(`playwright trace → ${path.join(runDir, traced.trace)}  (npx playwright show-trace <file>)`);
  if (traced.traceError) log(`playwright trace: ${traced.traceError}`);
  fs.writeFileSync(path.join(runDir, 'axe.json'), JSON.stringify(axe, null, 2));
  const meta = { url: o.mode === 'real' ? trace[0].url : o.url, mode: o.mode || 'local', site: o.site || null, script: !!o.script, startedAt, maxSteps: limit.maxSteps,
    goalSource: task.goalSource, goalReason: task.goalReason, testDataProfile: task.testDataProfile,
    ...(task.testDataAppended ? { goalInput: task.goalInput, testDataAppended: true } : {}) };
  // trace/traceError stay in meta.json: report.json (built from meta) is the frontend contract
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, goal: task.goal, ...traced }, null, 2));
  onProgress({ state: 'analyzing', trace });
  return analyze({ trace, goal: task.goal, meta, runDir, judgeEnabled: o.judgeEnabled !== false, axe, stats, log });
}
