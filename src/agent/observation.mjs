// INFORMATION BARRIER.
// The planner simulates a user who only has keyboard + assistive technology.
// It must NEVER see raw `step.changes` text unless assistive tech would actually convey it,
// otherwise an unannounced "Card number is invalid" leaks to the agent and the demo proves nothing.

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

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

/** What assistive tech conveys in this step. Single source of truth — detectors reuse the same idea. */
export function heardInStep(step) {
  const heard = [];
  const moved = focusChanged(step);
  if (moved) heard.push(describeFocus(step.focusAfter));
  for (const c of step.changes || []) {
    if (!c.visible) continue;
    if (c.inLiveRegion) heard.push(c.text);
    else if (c.focusMovedInto) heard.push(c.text);
    else if (moved && c.referencedBy?.includes(step.focusAfter?.selector)) heard.push(c.text);
  }
  for (const s of step.spoken || []) heard.push(s);
  return [...new Set(heard.map((h) => clip(h, 300)))];
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
    did: s.action.kind === 'press' ? `press ${s.action.key}` : s.action.kind === 'type' ? `${s.action.replace ? 'replace with' : 'type'} "${clip(s.action.text, 40)}"` : s.action.kind,
    focus: describeFocus(s.focusAfter),
    heard: heardInStep(s).slice(0, 3),
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
  };
}
