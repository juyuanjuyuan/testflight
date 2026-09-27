// Picks the task when the user gives only a URL. Demo sites use their verified preset tasks (eval/groundtruth);
// elsewhere the model proposes WHAT to do from what a screen reader user could read, and code appends the test values.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { chatJSON } from './llm.mjs';
import { ROOT, SITES_DIR, insideDir } from '../paths.mjs';
import { MAX_GOAL_CHARS, MAX_SUGGESTIONS } from '../contracts.mjs';

const SYSTEM = fs.readFileSync(new URL('./prompts/tasker.md', import.meta.url), 'utf8');
const GROUNDTRUTH_DIR = path.join(ROOT, 'eval', 'groundtruth');
const TEST_DATA_DIR = path.join(ROOT, 'config', 'test-data');
const NAME = /^[\w.-]+$/;
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Kinds of test data a goal may need; each has a sentence in config/test-data/default.json. */
export const DATA_KINDS = ['payment_card', 'email', 'name', 'address', 'phone'];
/** Words that describe HOW (UI steps) rather than WHAT: they would leak page structure to the planner. */
export const STEP_WORDS = ['click', 'tap', 'press', 'tab', 'scroll', 'button', 'link', 'menu', 'icon', 'hover', 'swipe'];
const STEP_RE = new RegExp(`\\b(?:${STEP_WORDS.join('|')}|tabbing|tabbed|tapping|tapped)(?:s|es|ed|ing)?\\b`, 'i');
// real sites: same stop rule as guard.mjs, and no payment or personal values at all
const REAL_STOP = 'Stop before paying or entering any personal details.';

/** sites/<a>/<b> for an http URL of a demo site on this machine (localhost/127.0.0.1, folder exists); else null. */
export function siteKeyFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' || !LOCAL_HOSTS.includes(u.hostname)) return null;
  const [a, b] = u.pathname.split('/').filter(Boolean);
  if (![a, b].every((s) => s && NAME.test(s) && !s.startsWith('.'))) return null;
  return fs.existsSync(insideDir(SITES_DIR, path.join(a, b))) ? `sites/${a}/${b}` : null;
}

/**
 * Preset tasks of eval/groundtruth/*.yaml whose `site` is siteKey and that have a goal. A preset bound to a start URL
 * (e.g. ?from=newsletter) only applies when url has that path+query, and then comes first.
 * @returns {{goal:string, source:'curated', reason:string, needs:string[]}[]}
 */
export function curatedTasks(siteKey, url) {
  if (!siteKey) return [];
  let here = null;
  try { const u = new URL(url); here = u.pathname + u.search; } catch { /* no usable url: only presets without a url apply */ }
  const presets = fs.readdirSync(GROUNDTRUTH_DIR).filter((f) => f.endsWith('.yaml')).sort()
    .map((f) => ({ file: f, gt: YAML.parse(fs.readFileSync(path.join(GROUNDTRUTH_DIR, f), 'utf8')) }))
    .filter(({ gt }) => gt?.site === siteKey && typeof gt.goal === 'string' && (!gt.url || gt.url === here));
  presets.sort((x, y) => Number(!!y.gt.url) - Number(!!x.gt.url));
  return presets.slice(0, MAX_SUGGESTIONS).map(({ file, gt }) => ({
    goal: gt.goal, source: 'curated', reason: `Preset task of this demo site (${gt.flow || gt.variant || 'main'} flow, eval/groundtruth/${file}).`, needs: [],
  }));
}

/**
 * Sentences per data kind: config/test-data/default.json, overridden by config/test-data/<a>.json for siteKey sites/<a>/….
 * needs: the kinds the site asks for (its file's `needs`), or null when it does not say (any kind may be appended).
 * @returns {{profile:string, sentences:Record<string,string>, needs:string[]|null}}
 */
export function loadTestData(siteKey) {
  const read = (name) => JSON.parse(fs.readFileSync(insideDir(TEST_DATA_DIR, `${name}.json`), 'utf8'));
  const sentences = read('default').sentences;
  const missing = DATA_KINDS.filter((k) => typeof sentences?.[k] !== 'string');
  if (missing.length) throw new Error(`config/test-data/default.json has no sentence for ${missing.join(', ')}`);
  const site = siteKey?.split('/')[1];
  if (site && NAME.test(site) && fs.existsSync(path.join(TEST_DATA_DIR, `${site}.json`))) {
    const own = read(site);
    const needs = Array.isArray(own.needs) ? own.needs : null;
    const unknown = (needs ?? []).filter((k) => !DATA_KINDS.includes(k));
    if (unknown.length) throw new Error(`config/test-data/${site}.json: unknown data kind ${unknown.join(', ')} in needs`);
    return { profile: site, sentences: { ...sentences, ...own.sentences }, needs };
  }
  return { profile: 'default', sentences, needs: null };
}

/**
 * A user goal with test values appended, for a local site that has its own config/test-data/<a>.json: when the goal has
 * no digit at all (so it carries no values of its own), the sentences of the site's `needs` (default: the kinds the site
 * file overrides) are appended, as for a generated goal. Real mode and sites without their own file: goal unchanged.
 * @returns {{goal:string, appended:boolean, profile:string|null}}
 */
export function appendTestData({ goal, siteKey, mode = 'local' }) {
  const same = { goal, appended: false, profile: null };
  const site = siteKey?.split('/')[1];
  if (mode === 'real' || /\d/.test(goal) || !site || !NAME.test(site)) return same;
  const file = path.join(TEST_DATA_DIR, `${site}.json`);
  if (!fs.existsSync(file)) return same;
  const own = JSON.parse(fs.readFileSync(insideDir(TEST_DATA_DIR, `${site}.json`), 'utf8'));
  const { profile, sentences, needs: siteNeeds } = loadTestData(siteKey);
  const needs = siteNeeds ?? Object.keys(own.sentences ?? {});
  return needs.length ? { goal: buildGoal({ goal, needs }, sentences, mode), appended: true, profile } : same;
}

const withStop = (goal) => (/[.!?]$/.test(goal) ? goal : `${goal}.`);

function buildGoal({ goal, needs }, sentences, mode) {
  const extra = mode === 'real' ? [REAL_STOP] : [...new Set(needs)].map((k) => sentences[k]);
  return [withStop(goal.trim()), ...extra].join(' ');
}

/** Why a model suggestion is unusable, or null. Checks the model's own text only; values are appended later. */
export function checkSuggestion(s) {
  if (!s || typeof s !== 'object') return 'suggestion is not an object';
  if (typeof s.goal !== 'string' || !s.goal.trim()) return 'goal must be a non-empty string';
  if (typeof s.reason !== 'string') return 'reason must be a string';
  if (!Array.isArray(s.needs)) return 'needs must be an array';
  if (s.goal.length > MAX_GOAL_CHARS) return `goal is too long (at most ${MAX_GOAL_CHARS} characters)`;
  const step = s.goal.match(STEP_RE);
  if (step) return `goal describes a UI step ("${step[0]}"): say what to achieve, not how`;
  if (/\d/.test(s.goal)) return 'goal contains a digit: list the data kind in needs instead of writing values';
  const unknown = s.needs.filter((k) => !DATA_KINDS.includes(k));
  if (unknown.length) return `unknown data kind ${unknown.join(', ')} (use ${DATA_KINDS.join(', ')})`;
  return null;
}

// One model reply → usable suggestions (goal built with test values) and the reasons the others were dropped.
// siteNeeds (the site config's needs, or null): only those kinds are appended, whatever else the model asked for.
function usable(data, { sentences, needs: siteNeeds }, mode) {
  const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
  if (!list.length) return { ok: [], errors: ['reply must be {"suggestions":[…]} with at least one suggestion'] };
  const ok = [], errors = [];
  for (const s of list) {
    let err = checkSuggestion(s);
    const needs = err ? [] : [...new Set(s.needs)].filter((k) => !siteNeeds || siteNeeds.includes(k));
    const goal = err ? null : buildGoal({ goal: s.goal, needs }, sentences, mode);
    if (!err && goal.length > MAX_GOAL_CHARS) err = `goal with its test data is too long (at most ${MAX_GOAL_CHARS} characters)`;
    if (err) errors.push(`"${String(s?.goal).slice(0, 80)}": ${err}`);
    else ok.push({ goal, source: 'generated', reason: s.reason.slice(0, 200), needs });
  }
  return { ok, errors };
}

/**
 * Tasks for a start page. Curated (siteKey has presets, generate false) → no model call; otherwise the judge's model route
 * proposes up to MAX_SUGGESTIONS from url/title/pageText only (what the planner sees at step 0), checked in code, one retry.
 * generate: skip the presets even on a demo site (live demo of generated tasks). Throws when no usable task comes back.
 * client: fake LLM client (tests only).
 * @param {{url:string, title?:string, pageText?:string|null, mode?:'local'|'real', siteKey?:string|null, generate?:boolean, stats?:object, client?:object}} o
 * @returns {Promise<{suggestions:{goal:string, source:'curated'|'generated', reason:string, needs:string[]}[], testDataProfile:string|null}>}
 */
export async function suggestTasks({ url, title = '', pageText = null, mode = 'local', siteKey = null, generate = false, stats, client }) {
  const curated = mode === 'real' || generate ? [] : curatedTasks(siteKey, url);
  if (curated.length) return { suggestions: curated, testDataProfile: null };
  const data = loadTestData(siteKey);
  const obs = { url, title, pageText, mode, dataKinds: DATA_KINDS, maxSuggestions: MAX_SUGGESTIONS };
  let user = JSON.stringify(obs), errors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: reply } = await chatJSON({ role: 'judge', system: SYSTEM, user, stats, client });
    const r = usable(reply, data, mode);
    if (r.ok.length) return { suggestions: r.ok.slice(0, MAX_SUGGESTIONS), testDataProfile: mode === 'real' ? null : data.profile };
    errors = r.errors;
    user = JSON.stringify({ ...obs, previousReplyWasInvalid: errors.join('; ').slice(0, 1000) });
  }
  throw new Error(`tasker: no usable task after a retry (${errors.join('; ').slice(0, 300)})`);
}
