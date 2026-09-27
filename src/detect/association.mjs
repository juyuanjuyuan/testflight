// D1b — ASSOCIATION layer. Error-like text that no input references via aria-describedby/aria-errormessage.
// Separate from D1: an error can be announced but still unassociated (user hears it once, can't find it again from the field).
import { ERROR_RE, dedupe, ev, byHelper } from './util.mjs';

export function detectAssociation(trace) {
  const out = [];
  for (const s of trace) {
    if (byHelper(s)) continue;
    for (const c of s.changes) {
      if (!c.visible || !ERROR_RE.test(c.text)) continue;
      if (c.referencedBy.length > 0) continue;
      out.push({
        detector: 'association', layer: 'association', steps: [s.i], wcag: ['3.3.1', '1.3.1'],
        hint: `error-like text "${c.text}" is not referenced by any field's aria-describedby/aria-errormessage`,
        evidence: ev(s, c.selector, c.barrierId, c.text),
      });
    }
  }
  return dedupe(out);
}
