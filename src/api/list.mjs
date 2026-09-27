// GET /api/runs: the run history list (docs/API.md §4). Only the fields the list needs, never whole reports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROGRESS_FILE, PROGRESS_STATES } from '../report/progress.mjs';

const REAL = 'real'; // real-site runs live in runs/real/<runDir> (cli.mjs --out runs/real), listed as "real/<runDir>"

// {value} | {missing: true} | {corrupt: true} (unreadable or not JSON: recorded as `progress: "corrupt"` or a skippedReason)
async function readJson(file) {
  try { return { value: JSON.parse(await fs.readFile(file, 'utf8')) }; } catch (e) { return e.code === 'ENOENT' ? { missing: true } : { corrupt: true }; }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringOrNull = (v) => typeof v === 'string' || v === null;

// The report fields the list shows, strictly typed (never coerced): anything else makes the report invalid.
function validReport(r) {
  return isObject(r) && isObject(r.meta) && isObject(r.verdicts) && typeof r.meta.goal === 'string'
    && typeof r.verdicts.screenReaderUserCanComplete === 'boolean' && isStringOrNull(r.meta.generatedAt)
    && (r.meta.url === undefined || isStringOrNull(r.meta.url));
}

// url/goal are optional in progress.json (absent before plan 17 P2) but typed when present.
function validProgress(p) {
  return isObject(p) && PROGRESS_STATES.includes(p.state)
    && (p.url === undefined || isStringOrNull(p.url)) && (p.goal === undefined || isStringOrNull(p.goal));
}

// {entry} or {skip: reason}. report.json is the audit's result; progress.json the live state (e.g. `fixing` a finished
// run). A valid report without progress.json is a run from before progress.json existed (`done`, progress "missing");
// with an unreadable one the state is `unknown` (progress "corrupt"), the verdict still shows.
async function entry(dir, runDir) {
  const [report, progress] = await Promise.all([readJson(path.join(dir, 'report.json')), readJson(path.join(dir, PROGRESS_FILE))]);
  const p = !progress.missing && validProgress(progress.value) ? progress.value : null;
  if (!report.missing) {
    const r = report.value;
    if (!validReport(r)) return { skip: 'report_invalid' }; // a broken report.json must not pass as a run still in progress
    const [state, prog] = p ? [p.state, 'ok'] : progress.missing ? ['done', 'missing'] : ['unknown', 'corrupt'];
    return { entry: { runDir, url: r.meta.url ?? null, goal: r.meta.goal, generatedAt: r.meta.generatedAt,
      screenReaderUserCanComplete: r.verdicts.screenReaderUserCanComplete, state, progress: prog } };
  }
  if (progress.missing) return { skip: 'no_report_or_progress' };
  if (!p) return { skip: 'progress_corrupt' };
  if (p.state === 'done') return { skip: 'done_without_report' }; // done is written only after report.json
  return { entry: { runDir, url: p.url ?? null, goal: p.goal ?? null, generatedAt: null, screenReaderUserCanComplete: null, state: p.state, progress: 'ok' } };
}

async function subdirs(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) {
    if (e.code === 'ENOENT') return []; // no runs yet
    throw e;
  }
}

// Run dir names are <UTC start 2026-09-26T21-00-00>-<label>[-<n>] (newRunDir: n = 2, 3… within the same second).
const NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-.*?(?:-(\d+))?$/;
function sortKey(name) {
  const m = NAME.exec(name);
  return m ? { time: m[1], n: m[2] ? Number(m[2]) : 1 } : { time: '', n: 0 };
}
// Newest first: start time, then the numeric suffix (-10 before -9), then the name (both descending).
function newestFirst(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  if (ka.time !== kb.time) return ka.time < kb.time ? 1 : -1;
  if (ka.n !== kb.n) return kb.n - ka.n;
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * { runs: [{runDir, url, goal, generatedAt, screenReaderUserCanComplete, state, progress}], skipped, skippedReasons }
 * for runsDir and runsDir/real/, newest first. skipped = dirs that are not listable runs; skippedReasons counts them by
 * reason (report_invalid, progress_corrupt, done_without_report, no_report_or_progress).
 */
export async function listRuns(runsDir) {
  const names = [
    ...(await subdirs(runsDir)).filter((n) => n !== REAL).map((n) => ({ runDir: n, dir: path.join(runsDir, n), name: n })),
    ...(await subdirs(path.join(runsDir, REAL))).map((n) => ({ runDir: `${REAL}/${n}`, dir: path.join(runsDir, REAL, n), name: n })),
  ];
  const results = await Promise.all(names.map(async (n) => ({ name: n.name, ...(await entry(n.dir, n.runDir)) })));
  const runs = results.filter((x) => x.entry).sort((a, b) => newestFirst(a.name, b.name)).map((x) => x.entry);
  const skippedReasons = {};
  for (const { skip } of results) if (skip) skippedReasons[skip] = (skippedReasons[skip] || 0) + 1;
  return { runs, skipped: results.length - runs.length, skippedReasons };
}
