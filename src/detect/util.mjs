import { CHANGE_WINDOW_MS, NOISE_REPEAT, INTERACTIVE_ROLES } from '../contracts.mjs';
import { focusChanged } from '../agent/observation.mjs';

export { CHANGE_WINDOW_MS, NOISE_REPEAT, INTERACTIVE_ROLES, focusChanged };

export const ERROR_RE = /invalid|error|required|incorrect|failed|declined|must|not valid|无效|错误|必填|失败|不正确/i;
export const CLOSE_RE = /close|cancel|dismiss|back|×|✕|✖|关闭|取消|返回/i;
// a sighted helper's mouse click (runner/assist.mjs): what follows it is not feedback on anything the keyboard user did
export const byHelper = (s) => s.action.kind === 'assist';
export const SYMBOL_ONLY_RE =/^[\p{Extended_Pictographic}\p{S}\p{P}\s\u200d\ufe0f]+$/u;

/** Merge candidates that point at the same element + detector, keeping all step indices. */
export function dedupe(cands) {
  const byKey = new Map();
  for (const c of cands) {
    const k = `${c.detector}|${c.evidence.barrierId || c.evidence.selector}`;
    const prev = byKey.get(k);
    if (prev) prev.steps = [...new Set([...prev.steps, ...c.steps])].sort((a, b) => a - b);
    else byKey.set(k, { ...c, steps: [...c.steps] });
  }
  return [...byKey.values()];
}

export const ev = (step, sel, barrierId, text) => ({ selector: sel, barrierId: barrierId ?? null, text, screenshot: step.screenshot ?? null });
