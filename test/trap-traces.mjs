// Shared test traces for keyboard traps (not a test file: node --test only runs *.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/paths.mjs';
import { readTrace } from '../src/contracts.mjs';

const original = readTrace(fs.readFileSync(path.join(ROOT, 'fixtures/testpage-original/trace.jsonl'), 'utf8'));

/**
 * The shop's "Members only" popup as the planner probed it (run of 2026-09-27, steps 28–40), on the testpage's payment
 * dialog: Tab into it, Escape twice, then Tab and Shift+Tab mixed between its two fields, Escape twice.
 * Never four same-direction Tabs in a row. Step k has i = k.
 */
export function probedPopupTrap() {
  const A = original[4].focusAfter; // #card, inside the payment dialog (the popup's Email)
  const B = original[6].focusAfter; // #pay (the popup's Join)
  const P = original[3].focusAfter; // #checkout, outside the dialog (the checkout's Pay)
  let prev = P;
  const step = (i, key, focus) => {
    const s = { ...original[6], i, action: { kind: 'press', key, reason: 'probe' }, focusBefore: prev, focusAfter: focus, modalOpen: true, changes: [], spoken: [] };
    prev = focus;
    return s;
  };
  return [original[0], { ...original[3], i: 1, changes: [], spoken: [] },
    step(2, 'Tab', A), step(3, 'Escape', A), step(4, 'Escape', A), step(5, 'Tab', B), step(6, 'Tab', A),
    step(7, 'Shift+Tab', B), step(8, 'Shift+Tab', A), step(9, 'Tab', B), step(10, 'Tab', A), step(11, 'Tab', B),
    step(12, 'Escape', B), step(13, 'Escape', B)];
}
