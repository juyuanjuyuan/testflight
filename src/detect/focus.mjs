// D4 focus lost, D5 focus not visible, D6 pointer-only — OPERATION layer.
import { dedupe, ev } from './util.mjs';

export function detectFocusLost(trace) {
  const out = [];
  for (const s of trace) {
    const a = s.action;
    if (a.kind !== 'press' || !['Enter', 'Space', 'Escape'].includes(a.key) || s.pageLoad) continue;
    if (s.focusAfter.isBody && s.focusBefore && !s.focusBefore.isBody) {
      out.push({ detector: 'focus-lost', layer: 'operation', steps: [s.i], wcag: ['2.4.3'],
        hint: `after ${a.key} on "${s.focusBefore.name}", focus fell back to <body>`,
        evidence: ev(s, s.focusBefore.selector, s.focusBefore.barrierId) });
    }
  }
  return dedupe(out);
}

export function detectFocusVisible(trace) {
  const out = [];
  for (const s of trace) {
    if (s.focusVisible !== false || s.focusAfter.isBody) continue;
    out.push({ detector: 'focus-visible', layer: 'operation', steps: [s.i], wcag: ['2.4.7'],
      hint: `no visible focus indicator on "${s.focusAfter.name}"`, evidence: ev(s, s.focusAfter.selector, s.focusAfter.barrierId) });
  }
  return dedupe(out);
}

export function detectPointerOnly(trace) {
  const last = trace[trace.length - 1];
  if (!last || last.action.kind !== 'stuck' || !Array.isArray(last.unreachableClickables)) return [];
  return last.unreachableClickables.map((u) => ({
    detector: 'pointer-only', layer: 'operation', steps: [last.i], wcag: ['2.1.1'],
    hint: `clickable "${u.text}" never received keyboard focus`, evidence: ev(last, u.selector, u.barrierId ?? null, u.text),
  }));
}
