// D1 — ANNOUNCEMENT layer. New visible text after an action that assistive tech has no programmatic way to convey.
// Change vs original doc: aria-describedby only counts as "announced" if focus MOVED to the referencing element
// in this very step. A description that silently changes on an already-focused element is not re-read.
import { CHANGE_WINDOW_MS, NOISE_REPEAT, focusChanged, dedupe, ev } from './util.mjs';

export function detectUnannounced(trace) {
  const out = [];
  for (const s of trace) {
    if (s.action.kind === 'start' || s.pageLoad) continue; // a new page is not a state change
    const moved = focusChanged(s);
    for (const c of s.changes) {
      if (!c.visible || c.dtMs > CHANGE_WINDOW_MS || c.repeatCount >= NOISE_REPEAT) continue;
      if (c.inLiveRegion || c.focusMovedInto) continue;
      if (moved && c.referencedBy.includes(s.focusAfter.selector)) continue;
      out.push({
        detector: 'unannounced', layer: 'announcement', steps: [s.i], wcag: ['4.1.3'],
        hint: `"${c.text}" appeared ${c.dtMs}ms after ${s.action.key || s.action.kind}; not in a live region, focus not moved to it, not described by newly focused element`,
        evidence: ev(s, c.selector, c.barrierId, c.text),
      });
    }
  }
  return dedupe(out);
}
