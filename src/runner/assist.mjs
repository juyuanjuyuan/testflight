// Facilitator assist, as in a moderated usability test: once a rule (not the planner) has confirmed a keyboard trap
// (Tab only cycles, Escape does not leave, no Close button in the cycle), a sighted helper closes the dialog with the
// mouse and the run goes on, so the barriers behind it are found in the same run. The trap is still reported, and an
// assisted run never counts as completed (verdicts.mjs). The planner cannot ask for help. Deterministic: no LLM here.
import { findTraps } from '../detect/trap.mjs';
import { MAX_ASSISTS } from '../contracts.mjs';

/**
 * The runner's own next action, or null to ask the planner.
 * {kind:'assist'} has no target yet: the audit loop looks up the dialog's close control in the page (session.mouseExit).
 * {kind:'stuck'}: still trapped after a helper already tried, or no assists left.
 * @param {import('../contracts.mjs').Step[]} trace
 */
export function runnerAction(trace) {
  const cur = trace[trace.length - 1];
  if (!cur?.modalOpen || cur.focusAfter.isBody) return null;
  const page = trace.findLastIndex((s) => s.pageLoad);
  const trap = findTraps(trace).find((t) => t.hint === 'trap' && t.from === page && t.members.has(cur.focusAfter.selector));
  if (!trap) return null;
  const why = `runner: keyboard trap, Tab only cycles among ${trap.members.size} elements and Escape does not leave`;
  const assists = trace.filter((s) => s.action.kind === 'assist');
  if (assists.some((s) => s.i > trap.closedAt)) return { kind: 'stuck', reason: `${why}, even after a sighted helper tried to close it` };
  if (assists.length >= MAX_ASSISTS) return { kind: 'stuck', reason: `${why}; no assists left (${MAX_ASSISTS} per run)` };
  return { kind: 'assist', reason: why };
}
