// D2 — OPERATION layer. Keyboard trap = Tab cycle that you cannot leave.
// Changes vs original doc:
//  * cycle detection instead of "<=3 elements in last 6 Tabs" (real payment modals have 5-8 focusables)
//  * WCAG 2.1.2 is only violated if there is NO keyboard way out. A cycle containing a reachable
//    Close/Cancel button where only Escape fails is an APG best-practice gap -> hint 'esc-only' (judge: degrade).
//  * only presses of the SAME key form a run: alternating Tab / Shift+Tab walks back and forth between
//    two neighbours by choice, and forward Tab might still have left.
import { CLOSE_RE, ev } from './util.mjs';

const tabKey = (s) => (s.action.kind === 'press' && (s.action.key === 'Tab' || s.action.key === 'Shift+Tab') ? s.action.key : null);

function findCycle(seq, maxPeriod = 12) {
  // seq: selectors of consecutive same-direction Tab presses. Smallest period p with >= 2 full repetitions at the tail.
  for (let p = 1; p <= Math.min(maxPeriod, Math.floor(seq.length / 2)); p++) {
    const tail = seq.slice(-2 * p);
    if (tail.slice(0, p).every((x, k) => x === tail[p + k])) return tail.slice(p);
  }
  return null;
}

export function detectTrap(trace) {
  const out = [];
  const seen = new Set();
  let run = [];
  for (let n = 0; n < trace.length; n++) {
    const s = trace[n];
    const dir = tabKey(s);
    if (!dir) { run = []; continue; }
    if (run.length && run[0].action.key !== dir) run = [];
    run.push(s);
    const cycle = findCycle(run.map((x) => x.focusAfter.selector));
    if (!cycle || run.some((x) => x.focusAfter.isBody)) continue; // wrapping through <body> = focus can leave
    const key = [...new Set(cycle)].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const members = run.slice(-cycle.length);
    const hasClose = members.some((x) => CLOSE_RE.test(x.focusAfter.name || ''));
    // look for a later Escape (planner or runner probe)
    const esc = trace.slice(n + 1).find((x) => x.action.kind === 'press' && x.action.key === 'Escape');
    const escFails = esc ? cycle.includes(esc.focusAfter.selector) && esc.modalOpen : null;
    if (escFails === false) continue; // Escape leaves the cycle: correct modal behaviour
    const hint = escFails === null ? 'esc-untested' : hasClose ? 'esc-only' : 'trap';
    out.push({
      detector: 'trap', layer: 'operation',
      steps: [...members.map((x) => x.i), ...(esc ? [esc.i] : [])],
      wcag: hint === 'trap' ? ['2.1.2'] : [],
      hint: `${hint}: Tab cycles among ${new Set(cycle).size} elements [${members.map((x) => x.focusAfter.name || x.focusAfter.role).join(' → ')}]` +
        (esc ? `; Escape ${escFails ? 'does not' : 'does'} leave` : '; Escape not tried'),
      evidence: ev(members[0], members[0].focusAfter.selector, members[0].focusAfter.barrierId, null),
    });
  }
  return out;
}
