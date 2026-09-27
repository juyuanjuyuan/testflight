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
export function reachedBoundary(url, title) {
  return STOP.test(url) || STOP.test(title || '');
}
