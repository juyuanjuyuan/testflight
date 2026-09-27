import { MISSING_DATA_PREFIX, FABRICATED_REASON, INCONCLUSIVE_MISSING_DATA } from './contracts.mjs';

// The two headline verdicts, defined so they can't be confused:
//  agent  = did our structure-only planner (keyboard + AT info, no pixels) finish? -> "structure-only AI agent can order?"
//  srUser = agent finished AND no block-level finding on the path.  An LLM can guess that "🛒" means add-to-cart;
//           a person hearing "button" cannot rely on that, so a block finding overrides the agent's luck.
// A run that stopped because the goal lacked a value (card number, email…) says nothing about the site: both are null
// (inconclusiveReason says why); its findings still count.
// A run a sighted helper had to rescue (assist steps, runner/assist.mjs) is not completed even if it reached done:
// as in a moderated usability test, "completed with assistance" is a failure. assistedSteps lists them (only when any).
export function runOutcome(trace) {
  const k = trace[trace.length - 1]?.action.kind;
  return k === 'done' || k === 'stuck' ? k : 'max-steps';
}

/** Stuck for missing test data: the planner said so ("missing data: …") or kept trying to type a value the goal lacks. */
export function missingDataStuck(action) {
  if (action?.kind !== 'stuck') return false;
  const reason = String(action.reason ?? '').trim();
  return reason.toLowerCase().startsWith(MISSING_DATA_PREFIX) || reason === FABRICATED_REASON;
}

export function computeVerdicts(trace, findings) {
  const outcome = runOutcome(trace);
  const blocks = findings.filter((f) => f.impact === 'block').map((f) => f.id);
  const assistedSteps = trace.filter((s) => s.action.kind === 'assist').map((s) => s.i);
  const agentOk = outcome === 'done' && assistedSteps.length === 0;
  const inconclusive = missingDataStuck(trace[trace.length - 1]?.action);
  return {
    outcome,
    agentCanComplete: inconclusive ? null : agentOk,
    screenReaderUserCanComplete: inconclusive ? null : agentOk && blocks.length === 0,
    blockingFindings: blocks,
    unexplainedStuck: !inconclusive && !agentOk && blocks.length === 0, // stuck but no detector explains it -> look manually / D6
    ...(inconclusive ? { inconclusiveReason: INCONCLUSIVE_MISSING_DATA } : {}),
    ...(assistedSteps.length ? { assistedSteps } : {}),
  };
}
