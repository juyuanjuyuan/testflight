// `fix` and `rerun` commands: patch a site from a run's findings, then re-audit the patched site.
// cli.mjs parses arguments and prints; everything here returns data.
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.mjs';
import { fixSite } from './fixer.mjs';
import { compareRuns } from '../report/compare.mjs';
import { writeReport } from '../report/build.mjs';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// exitCode 2 = usage error, same as cli.mjs's own missing-argument check
const usageError = (k) => Object.assign(new Error(`missing --${k}`), { exitCode: 2 });
const need = (args, k) => { if (!args[k]) throw usageError(k); return args[k]; };

/** Patch the run's site. args: {run, site?, patched?}. Returns {fixes, patchedDir}; writes fixes.json and updates findings.json. */
export async function runFix(args) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const findings = readJSON(path.join(runDir, 'findings.json'));
  const originalDir = args.site || meta.site || need(args, 'site');
  const patchedDir = args.patched || path.join(path.dirname(originalDir), 'patched');
  const fixes = await fixSite({ findings, originalDir, patchedDir });
  fs.writeFileSync(path.join(runDir, 'fixes.json'), JSON.stringify(fixes, null, 2));
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings, null, 2)); // now with .fix
  return { fixes, patchedDir };
}

/** Re-audit the patched site with the run's goal. args: {run, url?, out?, 'no-judge'?}. Returns the before/after comparison. */
export async function runRerun(args, log = () => {}) {
  const runDir = need(args, 'run');
  const meta = readJSON(path.join(runDir, 'meta.json'));
  const url = args.url || meta.url.replace('/original/', '/patched/');
  const after = await audit({ url, goal: meta.goal, out: args.out || undefined, label: 'rerun', judgeEnabled: !args['no-judge'], log });
  const before = readJSON(path.join(runDir, 'report.json'));
  const cmp = compareRuns(before, after.report);
  before.rerun = { runDir: after.runDir, ...cmp };
  writeReport(runDir, before);
  return cmp;
}
