// INFORMATION BARRIER.
// The planner simulates a user who only has keyboard + assistive technology.
// It must NEVER see raw `step.changes` text unless assistive tech would actually convey it,
// otherwise an unannounced "Card number is invalid" leaks to the agent and the demo proves nothing.

import { SPOKEN_SOURCE } from '../contracts.mjs';

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

// What a facilitator would say after an assist (runner/assist.mjs). Fixed words, no page content: nothing about what was
// clicked leaks. Self-explanatory, so the planner prompt (and its LLM cache) stays unchanged.
export const ASSIST_NOTE = 'You could not leave a dialog with the keyboard. A sighted helper closed it for you with the mouse; '
  + 'you did not press anything. Continue with the goal from where focus is now.';
const didOf = (a) => (a.kind === 'press' ? `press ${a.key}` : a.kind === 'type' ? `${a.replace ? 'replace with' : 'type'} "${clip(a.text, 40)}"`
  : a.kind === 'assist' ? 'nothing (a sighted helper closed a dialog with the mouse)' : a.kind);

export function focusChanged(step) {
  const b = step.focusBefore, a = step.focusAfter;
  if (!b) return true;
  return b.selector !== a.selector;
}

export function describeFocus(f) {
  if (!f || f.isBody) return '(focus on page body)';
  const name = f.name ? `"${f.name}"` : '(no name)';
  const desc = f.description ? `, ${f.description}` : '';
  return `${f.role} ${name}${desc}`;
}

/** Rules: is this new on-screen text conveyed by assistive tech? Detectors (D1) apply the same idea. */
function ruleAnnounces(step, c, moved) {
  if (!c.visible) return false;
  return c.inLiveRegion || c.focusMovedInto || (moved && !!c.referencedBy?.includes(step.focusAfter?.selector));
}

/** What assistive tech conveys in this step, inferred by rules from focus and changes (never reads step.spoken). */
export function ruleHeard(step) {
  const moved = focusChanged(step);
  return [...(moved ? [describeFocus(step.focusAfter)] : []), ...(step.changes || []).filter((c) => ruleAnnounces(step, c, moved)).map((c) => c.text)];
}

/**
 * What assistive tech conveys in this step. Single source of truth for the planner and the report.
 * The virtual screen reader's own output when it ran on this step; otherwise (old trace, it failed to start) the rules.
 */
export function heardInStep(step) {
  const heard = step.spokenSource === SPOKEN_SOURCE ? step.spoken : ruleHeard(step);
  return [...new Set(heard.map((h) => clip(h, 300)))];
}

const squash = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Cross-check of the rules against the virtual screen reader: for every step it ran on that has new visible text,
 * does it say each text exactly when the rules say the text is heard? Disagreements are listed for a human to read,
 * never fed back into the detectors. null when no step ran the screen reader.
 */
export function spokenAgreement(trace) {
  const ran = trace.filter((s) => s.spokenSource === SPOKEN_SOURCE);
  if (!ran.length) return null;
  let compared = 0, agreed = 0;
  const disagreements = [];
  for (const s of ran) {
    const visible = s.changes.filter((c) => c.visible);
    if (!visible.length) continue;
    const moved = focusChanged(s);
    const said = s.spoken.map(squash);
    const differ = visible.map((c) => ({ step: s.i, text: c.text, rules: ruleAnnounces(s, c, moved), virtualScreenReader: said.some((p) => p.includes(squash(c.text))) }))
      .filter((d) => d.rules !== d.virtualScreenReader);
    compared++;
    if (!differ.length) agreed++;
    disagreements.push(...differ);
  }
  return { compared, agreed, fallbackSteps: trace.length - ran.length, disagreements };
}

/**
 * Build the planner's observation from the trace so far.
 * @param {string} goal
 * @param {import('../contracts.mjs').Step[]} trace
 */
export function buildObservation(goal, trace) {
  const cur = trace[trace.length - 1];
  const lastLoad = [...trace].reverse().find((s) => s.pageLoad && s.pageText);
  const history = trace.slice(-6, -1).map((s) => ({
    did: didOf(s.action),
    focus: describeFocus(s.focusAfter),
    // a dialog announces all its lines at once; keeping only a few made the planner forget the cart held the tote
    heard: heardInStep(s).slice(0, 12),
  }));
  return {
    goal,
    step: cur.i,
    stepsLeft: undefined, // filled by caller
    url: cur.url,
    pageTitle: cur.title,
    focus: describeFocus(cur.focusAfter),
    // the field's content as the screen reader reads it (AX value; passwords masked); null when not a field
    focusValue: cur.focusAfter?.value ?? null,
    heardThisStep: heardInStep(cur),
    // page content a screen-reader user could read after a navigation (AX tree only, no pixels)
    pageText: lastLoad ? clip(lastLoad.pageText, 2500) : null,
    pageTextFromStep: lastLoad ? lastLoad.i : null,
    history,
    ...(cur.action.kind === 'assist' ? { helper: ASSIST_NOTE } : {}),
  };
}
