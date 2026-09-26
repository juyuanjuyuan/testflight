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
export function reachedBoundary(url, title) {
  return STOP.test(url) || STOP.test(title || '');
}
