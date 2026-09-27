// `fix` and `rerun` commands: patch a site from a run's findings, then re-audit the patched site.
// cli.mjs parses arguments and prints; everything here returns data.
import fs from 'node:fs';
import path from 'node:path';
import { audit, newRunDir } from '../audit.mjs';
import { fixSite } from './fixer.mjs';
import { compareRuns } from '../report/compare.mjs';
import { buildReport, writeReport } from '../report/build.mjs';
import { readTrace } from '../contracts.mjs';
import { ROOT } from '../paths.mjs';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// exitCode 2 = usage error, same as cli.mjs's own missing-argument check
const usageError = (k) => Object.assign(new Error(`missing --${k}`), { exitCode: 2 });
const need = (args, k) => { if (!args[k]) throw usageError(k); return args[k]; };
const repoRel = (p) => path.relative(ROOT, p).split(path.sep).join('/'); // '/' paths: report.json must not leak the local machine

/** {originalDir, patchedDir} of a run: site paths are repo-relative (audit --site sites/shop/original), never cwd-relative. */
export function siteDirs(args, meta) {
  const originalDir = path.resolve(ROOT, args.site || meta.site || need(args, 'site'));
  const patchedDir = args.patched ? path.resolve(ROOT, args.patched) : path.join(path.dirname(originalDir), 'patched');
  return { originalDir, patchedDir };
}

// --findings F2,F4 → ['F2','F4'] (every one must be a finding of this run); absent → null = all block findings
function chosenIds(args, findings) {
  if (args.findings === undefined) return null;
  const ids = typeof args.findings === 'string' ? args.findings.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (!ids.length) throw usageError('findings');
  const unknown = ids.filter((id) => !findings.some((f) => f.id === id));
  if (unknown.length) throw Object.assign(new Error(`unknown finding id(s) ${unknown.join(', ')} (this run has ${findings.map((f) => f.id).join(', ')})`), { exitCode: 2 });
  return ids;
}

/**
 * Patch the run's site. args: {run, site?, patched?, findings?: "F2,F4"}; opts.client replaces the LLM client (tests only).
 * Returns {fixes, patchedDir}; writes fixes.json, updates findings.json and rebuilds report.json with the fixes.
 */
export async function runFix(args, { client } = {}) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const findings = readJSON(path.join(runDir, 'findings.json'));
  const ids = chosenIds(args, findings);
  const { originalDir, patchedDir } = siteDirs(args, meta);
  const fixes = await fixSite({ findings, ids, originalDir, patchedDir, client });
  fs.writeFileSync(path.join(runDir, 'fixes.json'), JSON.stringify(fixes, null, 2));
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings, null, 2)); // now with .fix
  writeReport(runDir, reportWithFixes(runDir, findings, fixes));
  return { fixes, patchedDir };
}

/** Rebuild the run's report so findings[].fix and fixes reach the viewer. A previous rerun no longer matches the patch: dropped. */
function reportWithFixes(runDir, findings, fixes) {
  const old = readJSON(path.join(runDir, 'report.json')); // keeps meta.judge and the audit's LLM stats
  const trace = readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8'));
  const axePath = path.join(runDir, 'axe.json');
  // `replay` runs have no axe.json; their report already said axe: null (not run), so null is not a new degradation
  const axe = fs.existsSync(axePath) ? readJSON(axePath) : null;
  return buildReport({ meta: old.meta, trace, findings, axe, fixes, stats: old.stats });
}

// The original run's URL with the site folder swapped for the patched one: /testpage/original/ → /testpage/patched/
function patchedUrl(meta, { originalDir, patchedDir }) {
  const from = `/${path.basename(originalDir)}/`;
  if (!meta.url.includes(from)) throw Object.assign(new Error(`cannot tell the patched site's URL from ${meta.url}; pass --url`), { exitCode: 2 });
  return meta.url.replace(from, `/${path.basename(patchedDir)}/`);
}

/**
 * Re-audit the patched site with the run's goal. args: {run, url?, out?, site?, patched?, 'no-judge'?}.
 * opts: log; runDir (an existing dir for the rerun) and onProgress, as for audit(); script and openSession as for audit().
 * Returns report.rerun (the before/after comparison), which is also written into the run's report.json.
 */
export async function runRerun(args, { log = () => {}, runDir: rerunDir, onProgress, script, openSession } = {}) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const dirs = args.url ? null : siteDirs(args, meta);
  const url = args.url || patchedUrl(meta, dirs);
  const after = await audit({ url, goal: meta.goal, out: args.out || undefined, runDir: rerunDir, label: 'rerun', judgeEnabled: !args['no-judge'],
    site: dirs ? repoRel(dirs.patchedDir) : undefined, script, openSession, onProgress, log });
  const before = readJSON(path.join(runDir, 'report.json'));
  const cmp = compareRuns(before, after.report);
  before.rerun = { runDir: repoRel(after.runDir), ...cmp };
  writeReport(runDir, before);
  return before.rerun;
}

/**
 * `fix [--rerun]`: patch, then optionally re-audit the patch, reporting progress on the ORIGINAL run:
 * fixing → rerunning (rerunDir) → done | failed. progressFor(dir) returns an onProgress for a run dir (default: none);
 * the rerun's own dir gets one too, and its first progress exists before rerunDir is published.
 * opts.client/script/openSession are passed to runFix/runRerun. Returns {fixes, patchedDir, rerun (null without --rerun)}.
 */
export async function runFixFlow(args, { progressFor = () => () => {}, log = () => {}, client, script, openSession } = {}) {
  const runDir = need(args, 'run');
  const onProgress = progressFor(runDir);
  onProgress({ state: 'fixing', trace: readTrace(fs.readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8')) }); // keep the audit's steps on screen
  try {
    const fixed = await runFix(args, { client });
    let rerun = null;
    if (args.rerun) {
      const rerunDir = newRunDir(args.out || undefined, 'rerun');
      const rerunProgress = progressFor(rerunDir);
      rerunProgress({ state: 'running', trace: [] }); // the client switches to it as soon as it sees rerunDir
      onProgress({ state: 'rerunning', rerunDir: path.basename(rerunDir) });
      rerun = await runRerun(args, { log, runDir: rerunDir, onProgress: rerunProgress, script, openSession });
    }
    onProgress({ state: 'done' }); // after runFix/runRerun wrote report.json
    return { ...fixed, rerun };
  } catch (e) {
    onProgress({ state: 'failed', error: e.message.split('\n')[0] });
    throw e;
  }
}
