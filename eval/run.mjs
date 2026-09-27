#!/usr/bin/env node
// Plan 10: one command → detection table (ours vs axe) and impact-accuracy table (judge on vs off).
// Each flow is audited once with its recorded key script and --no-judge, so every tool sees the same page states;
// the judge then runs over that same trace (analyze()), which is the ablation. Output: runs/eval/<time>-eval/.
// Detection = the detectors found the barrier (judge off; barriers expected to be irrelevant count too).
// Impact accuracy = the level given to each detected barrier (none = irrelevant) matches the ground truth's expectedImpact:
// the judge's job is to rate impact on the task, not to find more barriers.
//   node eval/run.mjs                          record every flow in a real browser, then score
//   node eval/run.mjs --replay <dir>           score flows recorded earlier (eval/traces, or a runs/eval/<id> dir), no browser
//   node eval/run.mjs --save-traces <dir>      also copy each flow's trace.jsonl/axe.json/meta.json to <dir>/<flow>/
// Why replay exists: the demo pages rotate a promo banner on a timer, so a fresh recording lands it in different steps;
// the judge prompt then differs, the LLM cache misses and the model answers afresh. Replaying one recording gives the
// judge the identical prompt, so its cached verdicts (LLM_CACHE=readwrite) give the same numbers on this machine.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { audit, analyze, newRunDir } from '../src/audit.mjs';
import { readTrace } from '../src/contracts.mjs';
import { createStaticServer, listen } from '../src/server.mjs';
import { ROOT, RUNS_DIR } from '../src/paths.mjs';
import { scoreRun, gradeRun } from './score.mjs';

process.env.LLM_CACHE = 'readwrite';
const PORT = Number(process.env.EVAL_PORT || 8092); // fixed: URLs are part of the judge prompt
const TRACE_FILES = ['trace.jsonl', 'axe.json', 'meta.json'];

const GT_DIR = path.join(ROOT, 'eval', 'groundtruth');
// url is relative to the local server; goal comes from `gt`, or from `goalFrom` when gt (a fixed variant) has none
const DATASETS = [
  { name: 'shop-main', url: '/shop/original/', keys: 'keys.shop.main.json', gt: 'shop-main.yaml' },
  { name: 'shop-main', url: '/shop/fixed/', keys: 'keys.shop.main.json', gt: 'shop-fixed.yaml', goalFrom: 'shop-main.yaml' },
  { name: 'shop-second', url: '/shop/original/', keys: 'keys.shop.second.json', gt: 'shop-second.yaml' },
  { name: 'shop-second', url: '/shop/fixed/', keys: 'keys.shop.second.fixed.json', gt: 'shop-fixed.yaml', goalFrom: 'shop-second.yaml' },
  { name: 'shop-popup', url: '/shop/original/?from=newsletter', keys: 'keys.shop.popup.json', gt: 'shop-popup.yaml' },
  { name: 'shop-popup', url: '/shop/fixed/?from=newsletter', keys: 'keys.shop.popup.fixed.json', gt: 'shop-fixed.yaml', goalFrom: 'shop-popup.yaml' },
  { name: 'testpage', url: '/testpage/original/', keys: 'keys.testpage.json', gt: 'testpage.yaml' },
  { name: 'testpage', url: '/testpage/fixed/', keys: 'keys.testpage.fixed.json', gt: 'testpage-fixed.yaml' },
  { name: 'w3c-bad', url: '/bad/after/home.html', keys: 'keys.bad.after.json', gt: 'bad-after.yaml' },
];
const TOOLS = ['ours (judge off)', 'axe (WCAG rules)'];

const readYaml = (f) => YAML.parse(fs.readFileSync(path.join(GT_DIR, f), 'utf8'));
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readRunTrace = (dir) => readTrace(fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8'));
const hasJudgeKey = () => !!(process.env.SCIFORIUM_API_KEY && process.env.MODEL_JUDGE);

function parseArgs(argv) {
  const o = {};
  for (let k = 0; k < argv.length; k++) {
    const key = { '--replay': 'replay', '--save-traces': 'save' }[argv[k]];
    if (!key || !argv[k + 1] || argv[k + 1].startsWith('--')) throw new Error(`usage: node eval/run.mjs [--replay <dir>] [--save-traces <dir>] (got ${argv[k]})`);
    o[key] = path.resolve(argv[++k]);
  }
  return o;
}

/** The one dir under `dir` holding the recording of flow `label` (<label>, or runs' <time>-<label>). */
function recordedDir(dir, label) {
  const hits = fs.readdirSync(dir).filter((n) => n === label || n.endsWith(`-${label}`));
  if (hits.length !== 1) throw new Error(`${dir}: expected one recording of ${label}, found ${hits.length}`);
  return path.join(dir, hits[0]);
}

// record: audit with the key script, judge off. replay: copy the recording and re-run the detectors on it (judge off).
async function judgeOffRun(d, { goal, gt, label }, ctx) {
  if (!ctx.replay) {
    const script = readJSON(path.join(ROOT, 'eval', d.keys));
    return (await audit({ url: ctx.base + d.url, goal, script, judgeEnabled: false, site: gt.site, out: ctx.evalDir, label })).runDir;
  }
  const src = recordedDir(ctx.replay, label);
  const runDir = path.join(ctx.evalDir, label);
  fs.mkdirSync(runDir);
  for (const f of TRACE_FILES) fs.copyFileSync(path.join(src, f), path.join(runDir, f));
  const { goal: _recorded, ...meta } = readJSON(path.join(runDir, 'meta.json'));
  await analyze({ trace: readRunTrace(runDir), goal, meta: { ...meta, replayOf: path.relative(ROOT, src) }, runDir,
    judgeEnabled: false, axe: readJSON(path.join(runDir, 'axe.json')) });
  return runDir;
}

/** Judge-off run (recorded or replayed), then the judge over that same trace; detection for ours/axe, impact grading off/on. */
async function runDataset(d, ctx) {
  const gt = readYaml(d.gt);
  const goal = gt.goal || readYaml(d.goalFrom).goal;
  const variant = gt.variant || 'original';
  const label = `${d.name}-${variant}`;
  const runDir = await judgeOffRun(d, { goal, gt, label }, ctx);
  const groundtruth = path.join(GT_DIR, d.gt);
  const row = (tool, dir, t) => ({ ...scoreRun({ runDir: dir, groundtruth, tool: t }), dataset: d.name, tool });
  const rows = [row(TOOLS[0], runDir, 'ours'), row(TOOLS[1], runDir, 'axe')];
  const ablation = { dataset: d.name, variant, off: { ...rows[0], ...gradeRun({ runDir, groundtruth }) },
    candidates: readJSON(path.join(runDir, 'candidates.json')).length };
  if (ctx.judgeOn) {
    const judgeDir = path.join(runDir, 'judge');
    fs.mkdirSync(judgeDir);
    const { goal: _recorded, ...meta } = readJSON(path.join(runDir, 'meta.json'));
    const stats = {};
    const { findings } = await analyze({ trace: readRunTrace(runDir), goal, meta: { ...meta, ablationOf: path.relative(ROOT, runDir) },
      runDir: judgeDir, judgeEnabled: true, axe: readJSON(path.join(runDir, 'axe.json')), stats });
    Object.assign(ablation, { on: { ...row('ours (judge on)', judgeDir, 'ours'), ...gradeRun({ runDir: judgeDir, groundtruth }) }, dropped: findings.filter((f) => f.impact === 'none').length,
      judgeErrors: stats.judgeErrors?.length || 0, llmCalls: stats.calls || 0, cacheHits: stats.cacheHits || 0 });
  }
  if (ctx.save) {
    fs.mkdirSync(path.join(ctx.save, label), { recursive: true });
    for (const f of TRACE_FILES) fs.copyFileSync(path.join(runDir, f), path.join(ctx.save, label, f));
  }
  return { rows, ablation, runDir, visionOnly: (gt.barriers || []).filter((b) => b.detectable === 'vision-only').map((b) => b.id),
    bestPractice: bestPracticeNodes(runDir) };
}

// axe rules without a WCAG tag (region, landmark-*…) are listed apart so the comparison stays fair (ARCHITECTURE §9)
function bestPracticeNodes(runDir) {
  const axe = readJSON(path.join(runDir, 'axe.json'));
  if (axe.error) return null;
  return axe.violations.filter((v) => !v.tags.some((t) => /^wcag\d/.test(t))).reduce((n, v) => n + v.nodes.length, 0);
}

const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : '–');

function detectionTable(results) {
  const mark = (ids, vision) => ids.map((id) => (vision.includes(id) ? `${id}†` : id)).join(' ') || '–';
  const lines = ['| dataset | variant | tool | planted | detected | missed | false positives |', '|---|---|---|---|---|---|---|'];
  for (const r of results) {
    for (const s of r.rows) lines.push(`| ${s.dataset} | ${s.variant} | ${s.tool} | ${s.planted} | ${s.hits} | ${mark(s.misses, r.visionOnly)} | ${s.falsePositives} |`);
  }
  for (const tool of TOOLS) {
    const rows = results.flatMap((r) => r.rows).filter((s) => s.tool === tool);
    const sum = (k) => rows.reduce((n, s) => n + (Array.isArray(s[k]) ? s[k].length : s[k]), 0);
    lines.push(`| **total** | | ${tool} | ${sum('planted')} | ${pct(sum('hits'), sum('planted'))} | ${sum('misses')} | ${sum('falsePositives')} |`);
  }
  return lines.join('\n');
}

const disagreements = (g) => g.graded.filter((x) => x.given !== x.expected).map((x) => `${x.id} ${x.expected}→${x.given}`).join(', ') || '–';

// judge off = the deterministic default level per detector (judge.mjs DEFAULT_IMPACT), the baseline the judge must beat
function impactTable(results, judgeOn) {
  const on = (a, f) => (judgeOn ? f(a.on) : 'skipped');
  const lines = ['| dataset | variant | detected barriers | agree, judge off (defaults) | agree, judge on | judge off: expected→given | judge on: expected→given | FP judge off → on | judge errors |',
    '|---|---|---|---|---|---|---|---|---|'];
  for (const { ablation: a } of results) {
    const n = a.off.graded.length;
    lines.push(`| ${a.dataset} | ${a.variant} | ${n} | ${pct(a.off.agree, n)} | ${on(a, (g) => pct(g.agree, n))} | ${disagreements(a.off)} | ${on(a, disagreements)} | ${a.off.falsePositives} → ${on(a, (g) => g.falsePositives)} | ${judgeOn ? a.judgeErrors : '–'} |`);
  }
  const sum = (f) => results.reduce((n, r) => n + f(r.ablation), 0);
  const n = sum((a) => a.off.graded.length);
  lines.push(`| **total** | | ${n} | ${pct(sum((a) => a.off.agree), n)} | ${judgeOn ? pct(sum((a) => a.on.agree), n) : 'skipped'} | | | ${sum((a) => a.off.falsePositives)} → ${judgeOn ? sum((a) => a.on.falsePositives) : 'skipped'} | ${judgeOn ? sum((a) => a.judgeErrors) : '–'} |`);
  return lines.join('\n');
}

function render(results, { judgeOn, replay }) {
  const vision = [...new Set(results.flatMap((r) => r.visionOnly))];
  const bp = results.map((r) => `${r.rows[0].dataset}/${r.rows[0].variant} ${r.bestPractice ?? 'n/a'}`).join(', ');
  const out = ['### Detection rate: planted barriers vs tools (judge off)', '', detectionTable(results), '',
    `† vision-only barrier (${vision.join(', ') || 'none'}): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.`,
    'Detection counts every planted barrier, including those expected to be irrelevant to the task (expectedImpact none): finding them is the detectors\' job; whether they matter is the judge\'s.',
    'Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.',
    `axe best-practice rule nodes, not counted above: ${bp}.`,
    'w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.',
    'keyboard-a11y-tester: not included in this comparison.', '',
    '### Impact accuracy: same trace, judge on vs off', '', impactTable(results, judgeOn), '',
    'For every barrier the detectors found, the impact level we report for it (block / degrade / none = irrelevant to this task; the most severe if several findings hit it) is compared with `expectedImpact` in `eval/groundtruth/`, i.e. what the barrier does to that flow\'s task. Judge off = each detector\'s fixed default level, shown as the baseline.',
    'expectedImpact is scored on the recorded route: e.g. the testpage script types a short card number on purpose, a user\'s typo; recovering from it is part of the task, and a user who never hears the error cannot correct it and pay, so T3 (unannounced error) and T4 (dialog trap) are block.',
    'The judge never adds findings and does not raise the detection count: its job is to rate each finding\'s impact on the task (including marking task-irrelevant ones as none). False positives are counted as in the detection table; a finding the judge rates none is not counted as reported.'];
  if (judgeOn) {
    out.push('', `Judge-on numbers depend on the model (\`MODEL_JUDGE\`); verdicts are cached in \`.cache/llm\`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.`);
  } else {
    out.push('', 'No judge key in `.env` (SCIFORIUM_API_KEY + MODEL_JUDGE): the judge-on columns were skipped.');
  }
  out.push('', replay ? `Reproduce: \`node eval/run.mjs --replay ${path.relative(ROOT, replay)}\` (no browser; the judge columns need \`.env\`).`
    : `Reproduce: \`node eval/run.mjs\` (records in Chromium, serving \`sites/\` on port ${PORT}; the judge columns need \`.env\`).`);
  return out.join('\n');
}

async function main() {
  const ctx = { ...parseArgs(process.argv.slice(2)), judgeOn: hasJudgeKey() };
  if (!ctx.judgeOn) console.error('note: no SCIFORIUM_API_KEY/MODEL_JUDGE in .env — skipping the judge-on columns');
  ctx.evalDir = newRunDir(path.join(RUNS_DIR, 'eval'), ctx.replay ? 'eval-replay' : 'eval');
  const server = ctx.replay ? null : await listen(createStaticServer(), PORT);
  ctx.base = `http://localhost:${PORT}`;
  const results = [];
  try {
    for (const d of DATASETS) {
      if (!fs.existsSync(path.join(GT_DIR, d.gt))) throw new Error(`missing ground truth eval/groundtruth/${d.gt}`);
      const r = await runDataset(d, ctx);
      console.error(`${d.name}/${r.rows[0].variant}: ${r.rows.map((s) => `${s.tool} ${s.hits}/${s.planted} fp ${s.falsePositives}`).join(' · ')}  → ${path.relative(ROOT, r.runDir)}`);
      results.push(r);
    }
  } finally {
    server?.close();
  }
  const md = render(results, ctx);
  fs.writeFileSync(path.join(ctx.evalDir, 'results.md'), md + '\n');
  fs.writeFileSync(path.join(ctx.evalDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(md);
  console.error(`→ ${path.relative(ROOT, ctx.evalDir)}/results.md`);
}

main().catch((e) => { console.error(process.env.DEBUG ? e : `error: ${e.message.split('\n')[0]} (DEBUG=1 for details)`); process.exit(1); });
