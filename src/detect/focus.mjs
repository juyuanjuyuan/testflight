// D4 focus lost, D5 focus not visible, D6 pointer-only — OPERATION layer.
import { dedupe, ev } from './util.mjs';

// Enter on a same-page fragment link ("Skip to content") whose target is not focusable leaves activeElement on <body>,
// but the sequential focus start point moved to the target, so the next Tab continues from there: a jump, not a loss.
// FocusInfo has no href; a link whose activation changed only the URL's fragment necessarily pointed into this page.
function jumpedInPage(prev, s) {
  if (!prev || s.action.key !== 'Enter' || s.focusBefore.role !== 'link') return false;
  const [a, b] = [new URL(prev.url), new URL(s.url)];
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && b.hash !== '' && a.hash !== b.hash;
}

export function detectFocusLost(trace) {
  const out = [];
  for (const [k, s] of trace.entries()) {
    const a = s.action;
    if (a.kind !== 'press' || !['Enter', 'Space', 'Escape'].includes(a.key) || s.pageLoad) continue;
    if (s.focusAfter.isBody && s.focusBefore && !s.focusBefore.isBody && !jumpedInPage(trace[k - 1], s)) {
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
