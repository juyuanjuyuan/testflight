// All LLM calls go through here: model routing, JSON-only parsing, retry, cross-model fallback, disk cache.
// LLM_CACHE=readonly makes the live demo fully replayable even if Sciforium or wifi dies.
import 'dotenv/config';
import OpenAI from 'openai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve('.cache/llm');
const TIMEOUTS = { planner: 20_000, judge: 60_000, fixer: 60_000, vision: 60_000 };

function routes() {
  const p = process.env.MODEL_PLANNER, j = process.env.MODEL_JUDGE;
  return {
    planner: [p, j],   // DeepSeek first (fast), GLM as fallback
    judge: [j, p],     // GLM first (smarter)
    fixer: [j, p],
    vision: [process.env.MODEL_VISION],
  };
}

let _client, _vision;
function client(role) {
  if (role === 'vision' && process.env.VISION_API_KEY) {
    return (_vision ??= new OpenAI({ baseURL: process.env.VISION_BASE_URL, apiKey: process.env.VISION_API_KEY }));
  }
  if (!process.env.SCIFORIUM_API_KEY) throw new Error('SCIFORIUM_API_KEY missing (copy .env.example to .env)');
  return (_client ??= new OpenAI({
    baseURL: process.env.SCIFORIUM_BASE_URL || 'https://api.sciforium.com/v1', // must stop at /v1
    apiKey: process.env.SCIFORIUM_API_KEY,
  }));
}

export function parseJSON(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no JSON object in model output');
}

const cacheMode = () => process.env.LLM_CACHE || 'readwrite';
const keyOf = (model, messages) => crypto.createHash('sha256').update(JSON.stringify({ model, messages })).digest('hex');

function cacheGet(k) {
  const f = path.join(CACHE_DIR, `${k}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function cachePut(k, v) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${k}.json`), JSON.stringify(v));
}

/**
 * @param {{role:'planner'|'judge'|'fixer'|'vision', system:string, user:string|object[], stats?:object}} args
 * @returns {Promise<{data:any, model:string, cached:boolean, ms:number}>}
 */
export async function chatJSON({ role, system, user, stats }) {
  const models = (routes()[role] || []).filter(Boolean);
  if (!models.length) throw new Error(`no model configured for role "${role}" (see .env.example)`);
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const mode = cacheMode();
  let lastErr;

  for (const model of models) {
    const k = keyOf(model, messages);
    if (mode !== 'off') {
      const hit = cacheGet(k);
      if (hit) { stats && (stats.cacheHits = (stats.cacheHits || 0) + 1); return { data: hit.data, model, cached: true, ms: 0 }; }
      if (mode === 'readonly') { lastErr = new Error(`cache miss (readonly) for ${role}/${model}`); continue; }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const r = await client(role).chat.completions.create(
          { model, messages, temperature: 0 },
          { timeout: TIMEOUTS[role] ?? 60_000 },
        );
        const data = parseJSON(r.choices?.[0]?.message?.content);
        const ms = Date.now() - t0;
        if (stats) { stats.calls = (stats.calls || 0) + 1; stats.ms = (stats.ms || 0) + ms; }
        if (mode === 'readwrite') cachePut(k, { data, model, role });
        return { data, model, cached: false, ms };
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}
