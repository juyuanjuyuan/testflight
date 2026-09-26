// FROZEN DATA CONTRACTS — every module talks to every other module only through these shapes.
// Changing a field: tell the whole team, update fixtures/, update docs/ARCHITECTURE.md §3, run `npm test`.

export const MAX_STEPS = 25;
export const CHANGE_WINDOW_MS = 1500;   // changes later than this after an action are not attributed to it
export const SETTLE_MS = 300;           // minimum quiet time before we observe
export const NOISE_REPEAT = 3;         // same element changing >= this often without input = carousel/countdown
export const BASELINE_MS = 2000;        // watch the page idle after load so carousels/countdowns reveal themselves
export const LOAD_TIMEOUT_MS = 10_000;   // max wait for 'load' after a navigation; exceeding it is recorded as loadTimeout

export const ALLOWED_KEYS = [
  'Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
];
// 'start' = initial page load (runner), planner may only emit press|type|done|stuck
export const ACTION_KINDS = ['start', 'press', 'type', 'done', 'stuck'];
export const PLANNER_KINDS = ['press', 'type', 'done', 'stuck'];

export const IMPACTS = ['block', 'degrade', 'none'];
// Perception-parity layers from the direction doc + 'operation' for keyboard operability
export const LAYERS = ['presence', 'association', 'announcement', 'operation'];

export const INTERACTIVE_ROLES = [
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'switch', 'menuitem', 'tab', 'option', 'spinbutton', 'slider', 'listbox',
];

/**
 * @typedef {Object} FocusInfo  — resolved via CDP accessibility tree, NOT from the DOM directly
 * @property {string}   role
 * @property {string}   name          accessible name
 * @property {string}   description   accessible description (aria-describedby etc.)
 * @property {string}   selector      stable-ish CSS selector
 * @property {string|null} barrierId  nearest ancestor-or-self [data-barrier] (eval only; null on real sites)
 * @property {boolean}  isBody        focus is on <body>/document root
 * @property {boolean}  inModal       focus is inside an open dialog
 * @property {Rect|null=} rect         viewport box of the focused element (viewer draws it); null on body
 * @property {string|null=} inputHints type/name/id/autocomplete of the element (guard.mjs checks sensitive fields)
 * @property {string=}  axError       CDP could not resolve the AX node; role is 'unknown' (degradation, kept for diagnosis)
 */

/** @typedef {{x:number, y:number, w:number, h:number}} Rect */

/**
 * @typedef {Object} Change  — new visible text that appeared after an action (recorder.js)
 * @property {string}   text
 * @property {string}   selector
 * @property {string|null} barrierId
 * @property {number}   dtMs          ms after the action
 * @property {boolean}  visible
 * @property {boolean}  inLiveRegion  inside aria-live!=off or role=alert|status|log
 * @property {string|null} liveRegion 'polite'|'assertive'|null
 * @property {string[]} referencedBy  selectors of elements whose aria-describedby/aria-errormessage points here
 * @property {boolean}  focusMovedInto focus moved into this element (or its ancestor) during this step
 * @property {number}   repeatCount   times this element changed with NO user input (noise signal)
 * @property {Rect=}    rect          viewport box of the changed element (viewer draws it)
 */

/**
 * @typedef {Object} Action
 * @property {'start'|'press'|'type'|'done'|'stuck'} kind
 * @property {string=}  key     for press, one of ALLOWED_KEYS
 * @property {string=}  text    for type
 * @property {string}   reason  planner's rationale (shown in the viewer's left column)
 * @property {boolean=} probe   inserted by the runner (e.g. Escape after a Tab cycle), not by the planner
 * @property {boolean=} plannerError  stuck because the planner failed or kept producing invalid actions
 */

/**
 * @typedef {Object} Step  — one line of trace.jsonl. runner WRITES, everyone else READS.
 * @property {number}   i
 * @property {number}   t            epoch ms
 * @property {string}   url
 * @property {string}   title
 * @property {Action}   action
 * @property {FocusInfo|null} focusBefore
 * @property {FocusInfo} focusAfter
 * @property {Change[]} changes
 * @property {string[]} spoken       virtual screen reader output (optional, [] if not wired)
 * @property {boolean}  pageLoad     a navigation happened during this step
 * @property {string|null} pageText  AX-tree text snapshot (headings/landmarks/static text), only when pageLoad; truncated
 * @property {boolean}  modalOpen
 * @property {boolean|null} focusVisible  null = not checked
 * @property {string|null} screenshot relative path inside the run dir; null if the screenshot failed
 * @property {boolean=} loadTimeout  a navigation started but 'load' did not fire in time; observed anyway
 * @property {{selector:string, barrierId:string|null, text:string}[]=} unreachableClickables
 *                                   only on a 'stuck' step: visible clickables keyboard can never reach (D6)
 */

/**
 * @typedef {Object} Candidate — detector output, BEFORE the judge. Judge may only filter/label these.
 * @property {string}   id           C1, C2 ...
 * @property {string}   detector     unannounced|association|trap|unnamed|weak-name|focus-lost|focus-visible|pointer-only
 * @property {string}   layer        one of LAYERS
 * @property {number[]} steps
 * @property {string[]} wcag
 * @property {string}   hint         deterministic explanation of why it fired
 * @property {{selector:string, barrierId:string|null, text?:string, screenshot?:string|null}} evidence
 */

/**
 * @typedef {Candidate & {
 *   impact: 'block'|'degrade'|'none',
 *   summary: string,
 *   userImpact: string,
 *   judged: boolean,          // false when judge disabled / failed (defaults used)
 *   axeAlsoFound: boolean,
 *   fix: null | { edits: {file:string, old:string, new:string}[], rationale: string },
 *   rerunStatus?: 'resolved'|'persists'|'new'
 * }} Finding
 */

// ---------------------------------------------------------------- validators (no deps)

const isStr = (x) => typeof x === 'string';

export function validateAction(a, { plannerOnly = false } = {}) {
  if (!a || typeof a !== 'object') return 'action is not an object';
  const kinds = plannerOnly ? PLANNER_KINDS : ACTION_KINDS;
  if (!kinds.includes(a.kind)) return `kind must be one of ${kinds.join('|')}`;
  if (a.kind === 'press' && !ALLOWED_KEYS.includes(a.key)) return `key must be one of ${ALLOWED_KEYS.join(', ')}`;
  if (a.kind === 'type' && (!isStr(a.text) || a.text.length === 0)) return 'type needs non-empty text';
  if (!isStr(a.reason)) return 'reason must be a string';
  return null;
}

export function validateStep(s) {
  if (!Number.isInteger(s?.i)) return 'i must be an integer';
  const e = validateAction(s.action);
  if (e) return `action: ${e}`;
  if (!s.focusAfter || !isStr(s.focusAfter.role)) return 'focusAfter.role missing';
  if (!Array.isArray(s.changes)) return 'changes must be an array';
  for (const c of s.changes) {
    if (!isStr(c.text) || !isStr(c.selector)) return 'change needs text and selector';
    if (!Array.isArray(c.referencedBy)) return 'change.referencedBy must be an array';
  }
  return null;
}

export function validateFinding(f) {
  if (!isStr(f?.id) || !isStr(f.detector)) return 'id and detector required';
  if (!Array.isArray(f.steps) || f.steps.length === 0) return 'steps required (traceability)';
  if (!IMPACTS.includes(f.impact)) return `impact must be ${IMPACTS.join('|')}`;
  if (!LAYERS.includes(f.layer)) return `layer must be ${LAYERS.join('|')}`;
  return null;
}

export function readTrace(text) {
  return text.split('\n').filter((l) => l.trim()).map((l, n) => {
    const s = JSON.parse(l);
    const err = validateStep(s);
    if (err) throw new Error(`trace line ${n + 1}: ${err}`);
    return s;
  });
}
