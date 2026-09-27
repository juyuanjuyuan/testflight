// `fix` and `rerun` commands: patch a site from a run's findings, then re-audit the patched site.
// cli.mjs parses arguments and prints; everything here returns data.
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.mjs';
import { fixSite } from './fixer.mjs';
import { compareRuns } from '../report/compare.mjs';
import { buildReport, writeReport } from '../report/build.mjs';
import { readTrace } from '../contracts.mjs';
import { ROOT } from '../paths.mjs';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// exitCode 2 = usage error, same as cli.mjs's own missing-argument check
const usageError = (k) => Object.assign(new Error(`missing --${k}`), { exitCode: 2 });
const need = (args, k) => { if (!args[k]) throw usageError(k); return args[k]; };

/**
 * Patch the run's site. args: {run, site?, patched?}; opts.client replaces the LLM client (tests only).
 * Returns {fixes, patchedDir}; writes fixes.json, updates findings.json and rebuilds report.json with the fixes.
 */
export async function runFix(args, { client } = {}) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const findings = readJSON(path.join(runDir, 'findings.json'));
  // site paths are repo-relative (audit --site sites/shop/original), never relative to the cwd
  const originalDir = path.resolve(ROOT, args.site || meta.site || need(args, 'site'));
  const patchedDir = args.patched ? path.resolve(ROOT, args.patched) : path.join(path.dirname(originalDir), 'patched');
  const fixes = await fixSite({ findings, originalDir, patchedDir, client });
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

/** Re-audit the patched site with the run's goal. args: {run, url?, out?, 'no-judge'?}. Returns report.rerun (the before/after comparison). */
export async function runRerun(args, log = () => {}) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const url = args.url || meta.url.replace('/original/', '/patched/');
  const after = await audit({ url, goal: meta.goal, out: args.out || undefined, label: 'rerun', judgeEnabled: !args['no-judge'], log });
  const before = readJSON(path.join(runDir, 'report.json'));
  const cmp = compareRuns(before, after.report);
  // repo-relative with '/' (served as /runs/<id>/): an absolute path would leak the local machine into report.json
  before.rerun = { runDir: path.relative(ROOT, after.runDir).split(path.sep).join('/'), ...cmp };
  writeReport(runDir, before);
  return before.rerun;
}
