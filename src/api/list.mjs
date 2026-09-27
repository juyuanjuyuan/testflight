// GET /api/runs: the run history list (docs/API.md §4). Only the fields the list needs, never whole reports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROGRESS_FILE } from '../report/progress.mjs';

const REAL = 'real'; // real-site runs live in runs/real/<runDir> (cli.mjs --out runs/real), listed as "real/<runDir>"

// {value} | {missing: true} | {} (unreadable or not JSON: the run is counted in `skipped`, which is the record)
async function readJson(file) {
  try { return { value: JSON.parse(await fs.readFile(file, 'utf8')) }; } catch (e) { return e.code === 'ENOENT' ? { missing: true } : {}; }
}

// One list entry, or null if the dir is not a readable run. report.json is the audit's result; progress.json (when
// present) the live state, e.g. `fixing` a finished run; a run from before progress.json existed is `done`.
async function entry(dir, runDir) {
  const [report, progress] = await Promise.all([readJson(path.join(dir, 'report.json')), readJson(path.join(dir, PROGRESS_FILE))]);
  const state = typeof progress.value?.state === 'string' ? progress.value.state : null;
  const r = report.value;
  if (r?.meta && typeof r.meta.goal === 'string' && r.verdicts) {
    return { runDir, url: r.meta.url ?? null, goal: r.meta.goal, generatedAt: r.meta.generatedAt ?? null,
      screenReaderUserCanComplete: r.verdicts.screenReaderUserCanComplete ?? null, state: state || 'done' };
  }
  if (!report.missing || !state) return null; // a broken report.json must not pass as a run still in progress
  const p = progress.value;
  return { runDir, url: p.url ?? null, goal: p.goal ?? null, generatedAt: null, screenReaderUserCanComplete: null, state };
}

async function subdirs(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) {
    if (e.code === 'ENOENT') return []; // no runs yet
    throw e;
  }
}

/**
 * { runs: [{runDir, url, goal, generatedAt, screenReaderUserCanComplete, state}], skipped } for runsDir and runsDir/real/,
 * newest first (run dir names start with their UTC start time). skipped = dirs that are not readable runs.
 */
export async function listRuns(runsDir) {
  const names = [
    ...(await subdirs(runsDir)).filter((n) => n !== REAL).map((n) => ({ runDir: n, dir: path.join(runsDir, n), name: n })),
    ...(await subdirs(path.join(runsDir, REAL))).map((n) => ({ runDir: `${REAL}/${n}`, dir: path.join(runsDir, REAL, n), name: n })),
  ];
  const entries = await Promise.all(names.map(async (n) => ({ name: n.name, e: await entry(n.dir, n.runDir) })));
  const runs = entries.filter((x) => x.e).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)).map((x) => x.e);
  return { runs, skipped: entries.length - runs.length };
}
