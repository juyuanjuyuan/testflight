// D3 (unnamed) + D3b (weak name) — PRESENCE layer for control names. D3b always goes to the judge.
import { INTERACTIVE_ROLES, SYMBOL_ONLY_RE, dedupe, ev } from './util.mjs';

export function detectNaming(trace) {
  const out = [];
  const nameToSel = new Map();
  for (const s of trace) {
    const f = s.focusAfter;
    if (!f || f.isBody || !INTERACTIVE_ROLES.includes(f.role)) continue;
    const name = (f.name || '').trim();
    if (!name) {
      out.push({ detector: 'unnamed', layer: 'presence', steps: [s.i], wcag: ['4.1.2'],
        hint: `${f.role} has no accessible name`, evidence: ev(s, f.selector, f.barrierId) });
      continue;
    }
    if (name.length < 3 || SYMBOL_ONLY_RE.test(name)) {
      out.push({ detector: 'weak-name', layer: 'presence', steps: [s.i], wcag: ['2.4.6', '4.1.2'],
        hint: `${f.role} name "${name}" is very short or symbols/emoji only`, evidence: ev(s, f.selector, f.barrierId, name) });
    }
    const k = `${f.role}|${name.toLowerCase()}`;
    const sels = nameToSel.get(k) || new Map();
    sels.set(f.selector, s);
    nameToSel.set(k, sels);
  }
  for (const [k, sels] of nameToSel) {
    if (sels.size < 2) continue;
    const steps = [...sels.values()];
    out.push({ detector: 'weak-name', layer: 'presence', steps: steps.map((s) => s.i), wcag: ['2.4.6'],
      hint: `${sels.size} different controls share the name "${k.split('|')[1]}"`,
      evidence: ev(steps[0], steps[0].focusAfter.selector, steps[0].focusAfter.barrierId, k.split('|')[1]) });
  }
  return dedupe(out);
}
