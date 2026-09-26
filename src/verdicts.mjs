// The two headline verdicts, defined so they can't be confused:
//  agent  = did our structure-only planner (keyboard + AT info, no pixels) finish? -> "structure-only AI agent can order?"
//  srUser = agent finished AND no block-level finding on the path.  An LLM can guess that "🛒" means add-to-cart;
//           a person hearing "button" cannot rely on that, so a block finding overrides the agent's luck.
export function runOutcome(trace) {
  const k = trace[trace.length - 1]?.action.kind;
  return k === 'done' || k === 'stuck' ? k : 'max-steps';
}

export function computeVerdicts(trace, findings) {
  const outcome = runOutcome(trace);
  const blocks = findings.filter((f) => f.impact === 'block').map((f) => f.id);
  const agentOk = outcome === 'done';
  return {
    outcome,
    agentCanComplete: agentOk,
    screenReaderUserCanComplete: agentOk && blocks.length === 0,
    blockingFindings: blocks,
    unexplainedStuck: !agentOk && blocks.length === 0, // stuck but no detector explains it -> look manually / D6
  };
}
