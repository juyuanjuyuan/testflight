import fs from 'node:fs';
import { chatJSON } from './llm.mjs';
import { buildObservation } from './observation.mjs';
import { validateAction, MAX_STEPS } from '../contracts.mjs';

const SYSTEM = fs.readFileSync(new URL('./prompts/planner.md', import.meta.url), 'utf8');

/** @returns {Promise<import('../contracts.mjs').Action>} */
export async function nextAction({ goal, trace, stats }) {
  const obs = buildObservation(goal, trace);
  obs.stepsLeft = MAX_STEPS - trace.length;
  let user = JSON.stringify(obs);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await chatJSON({ role: 'planner', system: SYSTEM, user, stats });
      const err = validateAction(data, { plannerOnly: true });
      if (!err) return { kind: data.kind, key: data.key, text: data.text, ...(data.replace ? { replace: true } : {}), reason: String(data.reason).slice(0, 200) };
      user = JSON.stringify({ ...obs, previousReplyWasInvalid: err });
    } catch (e) {
      if (attempt === 1) return { kind: 'stuck', reason: `planner error: ${e.message}`, plannerError: true };
    }
  }
  return { kind: 'stuck', reason: 'planner kept producing invalid actions', plannerError: true };
}
