#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { audit, analyze, newRunDir } from './src/audit.mjs';
import { readTrace } from './src/contracts.mjs';
import { runFix, runRerun } from './src/fix/commands.mjs';
import { createProgressWriter } from './src/report/progress.mjs';
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
// Real mode: the human clears captcha/login in Chrome first. Resolves on Enter, or when stdin closes (piped / no TTY).
const waitForEnter = () => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.once('close', resolve);
  rl.question('Chrome attached. Solve any captcha/login in that window, then press Enter to start.\n'
    + '(Cookie banners are left as they are: the agent does not close them for you, they are part of the test.) ', () => rl.close());
});
const summary = (r) => console.log(`\nSR user can complete: ${r.verdicts.screenReaderUserCanComplete} · agent can complete: ${r.verdicts.agentCanComplete} · block ${r.counts.block} · degrade ${r.counts.degrade} · axe ${r.counts.axeViolations}`);

const USAGE = `usage:
  node cli.mjs audit  --url <url> --goal "<task>" [--out runs/] [--script keys.json] [--no-judge] [--headed] [--site sites/shop/original]
                      [--fail-on block] [--run-dir <existing dir>] [--progress]            # --progress: keep <runDir>/progress.json live
  node cli.mjs audit  --mode real --cdp http://localhost:9222 --goal "<task>" [--url <url>] [--out runs/real]
                      # takes over the visible tab of scripts/real-chrome.sh; waits for Enter; stops at checkout
  node cli.mjs replay --trace <trace.jsonl> --goal "<task>" [--out runs/] [--no-judge]     # detectors+judge+report, no browser
  node cli.mjs fix    --run <runDir> [--site sites/shop/original] [--patched sites/shop/patched]
  node cli.mjs rerun  --run <runDir> [--url <patched url>]                                  # same goal on the patched site
  node cli.mjs score  --run <runDir> --groundtruth eval/groundtruth/shop-main.yaml [--tool ours|axe]`;

async function main() {
  const out = args.out || undefined; // default: <repo>/runs
  if (cmd === 'audit') {
    const script = args.script ? readJSON(args.script) : null;
    // --progress needs the dir before audit() starts; --run-dir is one the API already created
    const dir = args['run-dir'] ? path.resolve(args['run-dir']) : args.progress ? newRunDir(out, args.label || 'audit') : undefined;
    const real = args.mode === 'real';
    const { runDir, report } = await audit({ url: real ? args.url : need('url'), goal: need('goal'), out, runDir: dir, script, mode: args.mode, cdp: args.cdp,
      judgeEnabled: !args['no-judge'], headless: !args.headed, site: args.site, label: args.label, log: console.log,
      onProgress: args.progress ? createProgressWriter(dir) : undefined, waitForUser: real ? waitForEnter : undefined });
    summary(report); console.log(`→ ${runDir}/report.json`);
    if (args['fail-on'] === 'block' && report.counts.block > 0) process.exit(1);
  } else if (cmd === 'replay') {
    const trace = readTrace(fs.readFileSync(need('trace'), 'utf8'));
    const runDir = newRunDir(out, 'replay');
    fs.copyFileSync(args.trace, path.join(runDir, 'trace.jsonl'));
    const { report } = await analyze({ trace, goal: need('goal'), meta: { replayOf: args.trace }, runDir, judgeEnabled: !args['no-judge'], log: console.error });
    summary(report); console.log(`→ ${runDir}/report.json`);
  } else if (cmd === 'fix') {
    const { fixes, patchedDir } = await runFix(args);
    for (const f of fixes) console.log(`${f.finding}: applied ${f.applied}${f.errors.length ? ' · errors: ' + f.errors.join('; ') : ''}`);
    console.log(`→ patched site in ${patchedDir}`);
  } else if (cmd === 'rerun') {
    console.log(JSON.stringify(await runRerun(args, console.log), null, 2));
  } else if (cmd === 'score') {
    const res = scoreRun({ runDir: need('run'), groundtruth: need('groundtruth'), tool: args.tool || 'ours' });
    console.log(scoreTable([res]));
  } else {
    console.log(USAGE);
    process.exit(cmd ? 2 : 0);
  }
}
main().catch((e) => { console.error(process.env.DEBUG ? e : `error: ${e.message.split('\n')[0]}` + ' (DEBUG=1 for details)'); process.exit(e.exitCode || 1); });
