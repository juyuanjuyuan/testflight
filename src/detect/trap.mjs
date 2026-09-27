// D2 — OPERATION layer. Keyboard trap = a set of elements Tab never leaves.
// Focus-transition graph instead of "the same Tab cycle repeated twice": probing a trap the way planner rule 6 asks
// (Tab, Shift+Tab and Escape mixed) never repeats one cycle, and a real two-field popup trap went unreported.
//  * Tab A→B records "after A comes B"; Shift+Tab A→B records "after B comes A". The latest observation wins and a
//    page load starts a new graph. Moving back and forth between two neighbours (Tab A→B, Shift+Tab B→A) only shows
//    "after A comes B", so it is not a loop.
//  * trap = a loop in the graph that never passes <body> (wrapping through <body> = focus can leave).
//  * WCAG 2.1.2 is only violated if there is NO keyboard way out. A loop containing a reachable Close/Cancel button where
//    only Escape fails is an APG best-practice gap -> hint 'esc-only' (judge: degrade). An Escape pressed inside the
//    loop that leaves it or closes the dialog = correct modal behaviour: not reported.
import { CLOSE_RE, ev } from './util.mjs';

const tabKey = (s) => (s.action.kind === 'press' && (s.action.key === 'Tab' || s.action.key === 'Shift+Tab') ? s.action.key : null);

/** The loop reached by following "after X comes Y" from start (Set of selectors); null if it reaches body or an unknown next. */
function loopFrom(next, start) {
  const path = [];
  for (let sel = start; sel !== null; sel = next.get(sel)?.to ?? null) {
    const k = path.indexOf(sel);
    if (k >= 0) return new Set(path.slice(k));
    path.push(sel);
  }
  return null;
}

/** The steps that show each member's next element, if every member still leads into the loop; else null. */
function edgeSteps(next, members) {
  const edges = [...members].map((m) => next.get(m));
  return edges.every((e) => e && members.has(e.to)) ? edges.map((e) => e.step).sort((a, b) => a.i - b.i) : null;
}

/**
 * Keyboard-trap loops, first occurrence per page load and element set, with what Escape did.
 * members: selectors; steps: Tab/Shift+Tab steps showing each member's next element (latest ones that still show the loop);
 * esc: first Escape pressed inside the loop (null = never tried); from: trace index of the page load the loop is on;
 * closedAt: step i at which the loop was first complete.
 * @returns {{members:Set<string>, steps:object[], esc:object|null, hint:'trap'|'esc-only'|'esc-untested', from:number, closedAt:number}[]}
 */
export function findTraps(trace) {
  const loops = [];
  const seen = new Set();
  let next = new Map(), from = 0;
  trace.forEach((s, k) => {
    if (s.pageLoad) { next = new Map(); from = k; }
    const dir = tabKey(s);
    if (!dir || !s.focusBefore) return;
    const [a, b] = dir === 'Tab' ? [s.focusBefore, s.focusAfter] : [s.focusAfter, s.focusBefore];
    if (a.isBody) return;
    next.set(a.selector, { to: b.isBody ? null : b.selector, step: s });
    const members = loopFrom(next, a.selector);
    const key = members && `${from}|${[...members].sort().join(',')}`;
    if (!members || seen.has(key)) return;
    seen.add(key);
    loops.push({ members, graph: next, closedSteps: edgeSteps(next, members), from, closedAt: s.i });
  });
  return loops.flatMap(({ members, graph, closedSteps, from, closedAt }) => {
    const end = trace.findIndex((s, k) => k > from && s.pageLoad);
    const escs = trace.slice(from, end < 0 ? undefined : end).filter((s) => s.action.kind === 'press' && s.action.key === 'Escape' &&
      s.focusBefore && members.has(s.focusBefore.selector));
    if (escs.some((s) => !members.has(s.focusAfter.selector) || !s.modalOpen)) return []; // Escape leaves: correct modal behaviour
    const steps = edgeSteps(graph, members) ?? closedSteps;
    const names = steps.flatMap((s) => [s.focusBefore, s.focusAfter]).filter((f) => members.has(f.selector)).map((f) => f.name || '');
    const esc = escs[0] ?? null;
    const hint = !esc ? 'esc-untested' : names.some((n) => CLOSE_RE.test(n)) ? 'esc-only' : 'trap';
    return [{ members, steps, esc, hint, from, closedAt }];
  });
}

export function detectTrap(trace) {
  const reported = new Set();
  return findTraps(trace).flatMap(({ members, steps, esc, hint }) => {
    const key = [...members].sort().join(',');
    if (reported.has(key)) return []; // the same trap after a reload is one problem
    reported.add(key);
    const first = steps[0];
    return [{
      detector: 'trap', layer: 'operation',
      steps: [...steps.map((x) => x.i), ...(esc ? [esc.i] : [])].sort((a, b) => a - b),
      wcag: hint === 'trap' ? ['2.1.2'] : [],
      hint: `${hint}: Tab cycles among ${members.size} elements [${steps.map((x) => x.focusAfter.name || x.focusAfter.role).join(' → ')}]` +
        (esc ? '; Escape does not leave' : '; Escape not tried'),
      evidence: ev(first, first.focusAfter.selector, first.focusAfter.barrierId, null),
    }];
  });
}
