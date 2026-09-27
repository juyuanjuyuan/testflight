import fs from 'node:fs';
import { chatJSON } from './llm.mjs';
import { buildObservation, heardInStep } from './observation.mjs';
import { validateAction, MAX_STEPS, NO_PROGRESS_STEPS, FABRICATED_REASON } from '../contracts.mjs';

const SYSTEM = fs.readFileSync(new URL('./prompts/planner.md', import.meta.url), 'utf8');

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** A typed value must appear verbatim in the goal (trimmed, case- and whitespace-insensitive): no completing or inventing. */
export function typedValueInGoal(text, goal) {
  return norm(goal).includes(norm(text));
}

/**
 * Consecutive steps at the end of the trace that made no progress: nothing heard that was not heard before,
 * and focus landed on an element (same page, same field content) that was already visited.
 */
export function noProgressSteps(trace) {
  const heard = new Set();
  const visited = new Set();
  let run = 0;
  for (const s of trace) {
    const f = s.focusAfter;
    const where = `${s.url}\n${f.isBody ? 'body' : f.selector}\n${f.value ?? ''}`;
    const news = heardInStep(s).filter((h) => !heard.has(h));
    const progress = news.length > 0 || !visited.has(where);
    news.forEach((h) => heard.add(h));
    visited.add(where);
    run = s.action.kind === 'start' || progress ? 0 : run + 1;
  }
  return run;
}

/** @returns {Promise<import('../contracts.mjs').Action>} client: fake LLM client (tests only). */
export async function nextAction({ goal, trace, stats, maxSteps = MAX_STEPS, client }) {
  const stalled = noProgressSteps(trace);
  if (stalled >= NO_PROGRESS_STEPS) {
    return { kind: 'stuck', reason: `runner: no progress in ${stalled} steps (nothing new heard, focus only revisited known elements)` };
  }
  const obs = buildObservation(goal, trace);
  obs.stepsLeft = maxSteps - trace.length;
  let user = JSON.stringify(obs);
  let fabricated = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await chatJSON({ role: 'planner', system: SYSTEM, user, stats, client });
      let err = validateAction(data, { plannerOnly: true });
      fabricated = !err && data.kind === 'type' && !typedValueInGoal(data.text, goal);
      if (fabricated) err = `"${data.text}" is not given in the goal: type only values that appear verbatim in the goal`;
      if (!err) return { kind: data.kind, key: data.key, text: data.text, ...(data.replace ? { replace: true } : {}), reason: String(data.reason).slice(0, 200) };
      user = JSON.stringify({ ...obs, previousReplyWasInvalid: err });
    } catch (e) {
      if (attempt === 1) return { kind: 'stuck', reason: `planner error: ${e.message}`, plannerError: true };
    }
  }
  return { kind: 'stuck', reason: fabricated ? FABRICATED_REASON : 'planner kept producing invalid actions', plannerError: true };
}
