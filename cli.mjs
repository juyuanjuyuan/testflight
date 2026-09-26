#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { audit, analyze, newRunDir } from './src/audit.mjs';
import { readTrace } from './src/contracts.mjs';
import { fixSite } from './src/fix/fixer.mjs';
import { compareRuns } from './src/report/compare.mjs';
import { writeReport } from './src/report/build.mjs';
import { scoreRun, scoreTable } from './eval/score.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let k = 0; k < rest.length; k++) {
  if (!rest[k].startsWith('--')) continue;
  const key = rest[k].slice(2), next = rest[k + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; k++; }
}
const need = (k) => { if (!args[k]) { console.error(`missing --${k}`); process.exit(2); } return args[k]; };
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const summary = (r) => console.log(`\nSR user can complete: ${r.verdicts.screenReaderUserCanComplete} · agent can complete: ${r.verdicts.agentCanComplete} · block ${r.counts.block} · degrade ${r.counts.degrade} · axe ${r.counts.axeViolations}`);

const USAGE = `usage:
  node cli.mjs audit  --url <url> --goal "<task>" [--out runs/] [--script keys.json] [--no-judge] [--headed] [--site sites/shop/original]
                      [--mode real --cdp http://localhost:9222] [--fail-on block]
  node cli.mjs replay --trace <trace.jsonl> --goal "<task>" [--out runs/] [--no-judge]     # detectors+judge+report, no browser
  node cli.mjs fix    --run <runDir> [--site sites/shop/original] [--patched sites/shop/patched]
  node cli.mjs rerun  --run <runDir> [--url <patched url>]                                  # same goal on the patched site
  node cli.mjs score  --run <runDir> --groundtruth eval/groundtruth/shop.yaml [--tool ours|axe]`;

async function main() {
  const out = args.out || 'runs';
  if (cmd === 'audit') {
    const script = args.script ? readJSON(args.script) : null;
    const { runDir, report } = await audit({ url: need('url'), goal: need('goal'), out, script, mode: args.mode, cdp: args.cdp,
      judgeEnabled: !args['no-judge'], headless: !args.headed, site: args.site, label: args.label });
    summary(report); console.log(`→ ${runDir}/report.json`);
    if (args['fail-on'] === 'block' && report.counts.block > 0) process.exit(1);
  } else if (cmd === 'replay') {
    const trace = readTrace(fs.readFileSync(need('trace'), 'utf8'));
    const runDir = newRunDir(out, 'replay');
    fs.copyFileSync(args.trace, path.join(runDir, 'trace.jsonl'));
    const { report } = await analyze({ trace, goal: need('goal'), meta: { replayOf: args.trace }, runDir, judgeEnabled: !args['no-judge'] });
    summary(report); console.log(`→ ${runDir}/report.json`);
  } else if (cmd === 'fix') {
    const runDir = need('run');
    const meta = readJSON(path.join(runDir, 'meta.json'));
    const findings = readJSON(path.join(runDir, 'findings.json'));
    const originalDir = args.site || meta.site || need('site');
    const patchedDir = args.patched || path.join(path.dirname(originalDir), 'patched');
    const fixes = await fixSite({ findings, originalDir, patchedDir });
    fs.writeFileSync(path.join(runDir, 'fixes.json'), JSON.stringify(fixes, null, 2));
    fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings, null, 2)); // now with .fix
    for (const f of fixes) console.log(`${f.finding}: applied ${f.applied}${f.errors.length ? ' · errors: ' + f.errors.join('; ') : ''}`);
    console.log(`→ patched site in ${patchedDir}`);
  } else if (cmd === 'rerun') {
    const runDir = need('run');
    const meta = readJSON(path.join(runDir, 'meta.json'));
    const url = args.url || meta.url.replace('/original/', '/patched/');
    const after = await audit({ url, goal: meta.goal, out, label: 'rerun', judgeEnabled: !args['no-judge'] });
    const before = readJSON(path.join(runDir, 'report.json'));
    const cmp = compareRuns(before, after.report);
    before.rerun = { runDir: after.runDir, ...cmp };
    writeReport(runDir, before);
    console.log(JSON.stringify(cmp, null, 2));
  } else if (cmd === 'score') {
    const res = scoreRun({ runDir: need('run'), groundtruth: need('groundtruth'), tool: args.tool || 'ours' });
    console.log(scoreTable([res]));
  } else {
    console.log(USAGE);
    process.exit(cmd ? 2 : 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
