import fs from 'node:fs';
import { chatJSON } from './llm.mjs';
import { IMPACTS } from '../contracts.mjs';
import { heardInStep, describeFocus } from './observation.mjs';

const SYSTEM = fs.readFileSync(new URL('./prompts/judge.md', import.meta.url), 'utf8');

// Used when the judge is disabled (ablation) or fails: conservative, deterministic.
const DEFAULT_IMPACT = {
  unannounced: 'degrade', association: 'degrade', unnamed: 'block', 'weak-name': 'degrade',
  'focus-lost': 'degrade', 'focus-visible': 'degrade', 'pointer-only': 'block',
};
const defaultImpact = (c) => (c.detector === 'trap' ? (c.hint.startsWith('trap') ? 'block' : 'degrade') : DEFAULT_IMPACT[c.detector] || 'degrade');

export function toFinding(c, v = null) {
  return {
    ...c,
    impact: v && IMPACTS.includes(v.impact) ? (v.relevant === false ? 'none' : v.impact) : defaultImpact(c),
    summary: v?.summary || c.hint,
    userImpact: v?.userImpact || '',
    judged: !!v,
    axeAlsoFound: false,
    fix: null,
  };
}

const withoutHash = (u) => (u || '').split('#')[0];

// focusBefore = the control the key was pressed on. newView = a page load OR an SPA route change (URL changed, no load):
// text that appears then is the new page's content, not feedback on the action (real SPAs produce 100+ such candidates)
function compactStep(s, prev) {
  return {
    action: s.action, focusBefore: describeFocus(s.focusBefore), focus: describeFocus(s.focusAfter), heard: heardInStep(s),
    visibleChanges: s.changes.map((c) => ({ text: c.text, selector: c.selector, dtMs: c.dtMs, repeatCount: c.repeatCount })),
    url: s.url, newView: s.pageLoad || (!!prev && withoutHash(prev.url) !== withoutHash(s.url)), modalOpen: s.modalOpen,
  };
}

function outcomeOf(trace) {
  const k = trace[trace.length - 1]?.action.kind;
  return k === 'done' || k === 'stuck' ? k : 'max-steps';
}

/** The judge's input for one batch of candidates: goal, outcome, the batch, and only the steps it points at. */
export function judgeInput({ goal, trace, batch }) {
  const steps = {};
  for (const c of batch) {
    for (const i of c.steps) {
      const n = trace.findIndex((s) => s.i === i);
      steps[i] ??= compactStep(trace[n], trace[n - 1]);
    }
  }
  return { goal, outcome: outcomeOf(trace), candidates: batch, steps };
}

/** Labels candidates. Can never add a finding that no detector produced. */
export async function judge({ goal, trace, candidates, enabled = true, stats = {}, log = () => {} }) {
  const withIds = (fs) => fs.map((f, n) => ({ ...f, id: `F${n + 1}`, candidateId: f.id }));
  if (!enabled || candidates.length === 0) return withIds(candidates.map((c) => toFinding(c)));
  const findings = [];
  for (let k = 0; k < candidates.length; k += 12) { // batch to keep prompts small
    const batch = candidates.slice(k, k + 12);
    let verdicts = [];
    try {
      const { data } = await chatJSON({ role: 'judge', system: SYSTEM, stats, user: JSON.stringify(judgeInput({ goal, trace, batch })) });
      verdicts = Array.isArray(data?.verdicts) ? data.verdicts : [];
    } catch (e) {
      stats.judgeErrors = [...(stats.judgeErrors || []), e.message]; // findings keep judged:false
      log(`[judge] failed, using defaults: ${e.message}`);
    }
    const byId = new Map(verdicts.map((v) => [v.id, v]));
    for (const c of batch) findings.push(toFinding(c, byId.get(c.id) || null));
  }
  return withIds(findings);
}
