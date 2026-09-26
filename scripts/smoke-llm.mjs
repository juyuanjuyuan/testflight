// LLM connectivity smoke test (plan 02): latency, JSON stability and image support per model, via chatJSON.
// Always live: forces LLM_CACHE=off. Prints model names and results only, never keys.
import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../src/agent/llm.mjs';
import { buildObservation } from '../src/agent/observation.mjs';
import { readTrace, validateAction, MAX_STEPS } from '../src/contracts.mjs';
import { ROOT } from '../src/paths.mjs';

process.env.LLM_CACHE = 'off';
const N = Number(process.env.N || 10);
const GOAL = 'Buy the canvas tote bag';
const FIXTURE = path.join(ROOT, 'fixtures/testpage-original');
const SYSTEM = fs.readFileSync(path.join(ROOT, 'src/agent/prompts/planner.md'), 'utf8');
// chatJSON retries once internally; a gap this large between wall time and the successful attempt means a retry happened.
const RETRY_GAP_MS = 300;

const MODELS = { planner: process.env.MODEL_PLANNER, judge: process.env.MODEL_JUDGE };
for (const [k, v] of Object.entries(MODELS)) if (!v) { console.error(`MODEL_${k.toUpperCase()} missing in .env`); process.exit(1); }

// Route every role to exactly one model so a failure can't be hidden by the cross-model fallback.
function only(model, fn) {
  const saved = { p: process.env.MODEL_PLANNER, j: process.env.MODEL_JUDGE };
  process.env.MODEL_PLANNER = model; process.env.MODEL_JUDGE = '';
  return fn().finally(() => { process.env.MODEL_PLANNER = saved.p; process.env.MODEL_JUDGE = saved.j; });
}

const trace = readTrace(fs.readFileSync(path.join(FIXTURE, 'trace.jsonl'), 'utf8'));
// Different trace prefixes → N distinct, realistic planner observations.
const observations = Array.from({ length: N }, (_, i) => {
  const obs = buildObservation(GOAL, trace.slice(0, 1 + (i % trace.length)));
  return JSON.stringify({ ...obs, stepsLeft: MAX_STEPS - 1 - (i % trace.length) });
});

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
// Some providers echo (part of) the key in auth errors; never let it reach the terminal.
const redact = (s) => String(s).replaceAll(process.env.SCIFORIUM_API_KEY || '\0', '[key]').replace(/\b(sk|key)[-_][A-Za-z0-9*._-]{6,}/g, '[key]');
const isTimeout = (e) => /timeout|timed out/i.test(`${e?.name} ${e?.message}`);

async function bench(label, model) {
  const r = { label, model, wall: [], ok: 0, invalid: 0, retried: 0, parseFail: 0, timeout: 0, otherErr: 0, errors: [] };
  for (const user of observations) {
    const t0 = Date.now();
    try {
      const { data, ms } = await only(model, () => chatJSON({ role: 'planner', system: SYSTEM, user }));
      const wall = Date.now() - t0;
      r.wall.push(wall);
      if (wall - ms > RETRY_GAP_MS) r.retried++;
      const err = validateAction(data, { plannerOnly: true });
      if (err) { r.invalid++; r.errors.push(`invalid action: ${err} — ${JSON.stringify(data).slice(0, 160)}`); } else r.ok++;
    } catch (e) {
      r.wall.push(Date.now() - t0);
      if (isTimeout(e)) r.timeout++; else if (/JSON/i.test(e.message)) r.parseFail++; else r.otherErr++;
      r.errors.push(redact(`${e.name}: ${e.message}`).slice(0, 200));
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return r;
}

async function imageCheck(model) {
  const b64 = fs.readFileSync(path.join(FIXTURE, 'shots/0001.png')).toString('base64');
  const user = [
    { type: 'text', text: 'List the visible text on every button in this screenshot. Reply with JSON only: {"buttons": ["..."]}' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
  ];
  const t0 = Date.now();
  try {
    const { data } = await only(model, () => chatJSON({ role: 'planner', system: 'You read screenshots. Reply with a single JSON object and nothing else.', user }));
    const answer = JSON.stringify(data);
    // Ground truth for 0001.png: a cart-emoji button and a "Checkout" button.
    return { model, ms: Date.now() - t0, answer, correct: /checkout/i.test(answer) };
  } catch (e) {
    return { model, ms: Date.now() - t0, answer: redact(`${e.name}: ${e.message}`).slice(0, 200), correct: false };
  }
}

console.log(`LLM smoke: ${N} planner-style calls per model, LLM_CACHE=off`);
const results = [];
const distinct = Object.entries(MODELS).filter(([label, model], i, all) => {
  const dup = all.findIndex(([, m]) => m === model) < i;
  if (dup) console.log(`${label}: same model string as ${all.find(([, m]) => m === model)[0]}, skipped`);
  return !dup;
});
for (const [label, model] of distinct) { process.stdout.write(`${label} (${model}) `); results.push(await bench(label, model)); }

console.log('\n| role | model | median ms | p90 ms | valid | invalid action | JSON fail | timeout | other err | retried |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.label} | ${r.model} | ${pct(r.wall, 0.5)} | ${pct(r.wall, 0.9)} | ${r.ok}/${N} | ${r.invalid} | ${r.parseFail} | ${r.timeout} | ${r.otherErr} | ${r.retried} |`);
}
for (const r of results) for (const e of r.errors) console.log(`  ${r.label}: ${e}`);

console.log('\nImage input (shots/0001.png, expected buttons: 🛒, Checkout)');
for (const [, model] of distinct) {
  const im = await imageCheck(model);
  console.log(`  ${im.model}: ${im.correct ? 'OK' : 'NO'} in ${im.ms} ms — ${im.answer}`);
}
