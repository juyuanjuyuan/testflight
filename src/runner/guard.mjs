// Real-site safety limits. Enforced in code, never trusted to the prompt.
const SENSITIVE = /\bcc-|card|cvv|cvc|csc|expir|password|passwd|\bpin\b|ssn/i;
const STOP = /checkout|payment|\/pay\b|billing|结算|支付/i;

export function blockType(focus) {
  return SENSITIVE.test(`${focus.inputHints || ''} ${focus.name || ''}`) ? `refusing to type into sensitive field "${focus.name}"` : null;
}
/** Reason to refuse this action on the current focus, or null. Covers every type, including replace. */
export function blockAction(action, focus) {
  return action.kind === 'type' ? blockType(focus) : null;
}
/**
 * Real mode: keep a field's AX value only if the planner typed into that field during this run and it is not
 * sensitive; anything the user entered or the browser autofilled becomes null + valueRedacted. Local mode: unchanged.
 */
export function redactFocusValue(focus, { mode, typedSelectors }) {
  if (mode !== 'real' || focus.value === undefined) return focus;
  if (!blockType(focus) && typedSelectors.has(focus.selector)) return focus;
  return { ...focus, value: null, valueRedacted: true };
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The virtual screen reader reads field values from the DOM, so unlike the AX tree it would say a password in clear.
 * Password values are masked in every mode (as the AX tree masks them). Real mode, like redactFocusValue: a value is kept
 * only if the planner typed into that field this run. Values are replaced where they form a whole ', '-separated segment
 * of a phrase (how the screen reader joins role, name, value, state), so a short value never blanks out other words.
 * @param {string[]} spoken  @param {{selector:string, value:string, password:boolean}[]} fields  current non-empty field values
 */
export function redactSpoken(spoken, fields, { mode, typedSelectors }) {
  const hide = fields.filter((f) => f.value && (f.password || (mode === 'real' && !typedSelectors.has(f.selector))));
  return spoken.map((p) => hide.reduce((out, f) => out.replace(new RegExp(`(^|, )${escapeRe(f.value)}(?=, |$)`, 'g'),
    (m, sep) => sep + (f.password ? '•'.repeat(f.value.length) : '(redacted)')), p));
}
/**
 * Real mode: every type overwrites the field, so a value the user entered or the browser autofilled is never kept
 * alongside the agent's text (that would defeat redactFocusValue). Marked forcedReplace so the trace stays honest.
 */
export function forceReplace(action) {
  return action.kind === 'type' && !action.replace ? { ...action, replace: true, forcedReplace: true } : action;
}
export function reachedBoundary(url, title) {
  return STOP.test(url) || STOP.test(title || '');
}
