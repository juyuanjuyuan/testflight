import { detectUnannounced } from './unannounced.mjs';
import { detectAssociation } from './association.mjs';
import { detectTrap } from './trap.mjs';
import { detectNaming } from './naming.mjs';
import { detectFocusLost, detectFocusVisible, detectPointerOnly } from './focus.mjs';

export const DETECTORS = [detectUnannounced, detectAssociation, detectTrap, detectNaming, detectFocusLost, detectFocusVisible, detectPointerOnly];

/** Deterministic. Over-report here; the judge filters. Never let the judge invent candidates. */
export function runDetectors(trace) {
  return DETECTORS.flatMap((d) => d(trace)).map((c, k) => ({ id: `C${k + 1}`, ...c }));
}
