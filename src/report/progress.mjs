// progress.json: the live view of a run the frontend polls (docs/API.md). report.json stays the only final result.
import fs from 'node:fs';
import path from 'node:path';
import { MAX_STEPS } from '../contracts.mjs';
import { timelineEntry } from './build.mjs';
import { writeJsonAtomic } from './atomic.mjs';

export const PROGRESS_FILE = 'progress.json';
const FINAL = ['done', 'failed'];

function progressDoc({ state, trace, error = null, rerunDir = null, maxSteps = MAX_STEPS }) {
  return {
    state, step: trace.length ? trace[trace.length - 1].i : null, maxSteps, // audit() passes its limit (real mode: MAX_STEPS_REAL)
    timeline: trace.map((s) => timelineEntry(s, [])), // findings don't exist until analysis: findingIds stay []
    rerunDir, error, updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns onProgress({state, trace?, rerunDir?, error?}) for audit() and the fix flow: assembles progress.json and writes it atomically.
 * An update without `trace` keeps the previous one, so `failed` still shows the steps done so far; likewise rerunDir,
 * so done/failed after a rerun still point at it.
 */
export function createProgressWriter(runDir) {
  let trace = [], rerunDir = null;
  return (update) => {
    if (update.trace) trace = update.trace.slice();
    if (update.rerunDir) rerunDir = update.rerunDir;
    writeJsonAtomic(path.join(runDir, PROGRESS_FILE), progressDoc({ ...update, trace, rerunDir }));
  };
}

/** Parsed progress.json of runDir (throws if missing or unparseable). */
export function readProgress(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, PROGRESS_FILE), 'utf8'));
}

/**
 * The run's process is gone: if progress.json is not done/failed, rewrite it as failed with `error` (keeping its timeline).
 * Returns true if it wrote. A missing or corrupt progress.json is replaced by a failed one with an empty timeline.
 */
export function markFailedIfUnfinished(runDir, error) {
  let prev = null;
  try { prev = readProgress(runDir); } catch { /* missing/corrupt: the failed doc below replaces it, that is the record */ }
  if (prev && FINAL.includes(prev.state)) return false;
  const doc = { ...progressDoc({ state: 'failed', trace: [], error }), ...(prev ? { step: prev.step, maxSteps: prev.maxSteps, timeline: prev.timeline, rerunDir: prev.rerunDir } : {}) };
  writeJsonAtomic(path.join(runDir, PROGRESS_FILE), doc);
  return true;
}
