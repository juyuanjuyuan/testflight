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

function compactStep(s) {
  return {
    action: s.action, focus: describeFocus(s.focusAfter), heard: heardInStep(s),
    visibleChanges: s.changes.map((c) => ({ text: c.text, selector: c.selector, dtMs: c.dtMs, repeatCount: c.repeatCount })),
    url: s.url, modalOpen: s.modalOpen,
  };
}

function outcomeOf(trace) {
  const k = trace[trace.length - 1]?.action.kind;
  return k === 'done' || k === 'stuck' ? k : 'max-steps';
}

/** Labels candidates. Can never add a finding that no detector produced. */
export async function judge({ goal, trace, candidates, enabled = true, stats }) {
  const withIds = (fs) => fs.map((f, n) => ({ ...f, id: `F${n + 1}`, candidateId: f.id }));
  if (!enabled || candidates.length === 0) return withIds(candidates.map((c) => toFinding(c)));
  const steps = {};
  for (const c of candidates) for (const i of c.steps) steps[i] ??= compactStep(trace.find((s) => s.i === i));
  const findings = [];
  for (let k = 0; k < candidates.length; k += 12) { // batch to keep prompts small
    const batch = candidates.slice(k, k + 12);
    let verdicts = [];
    try {
      const { data } = await chatJSON({ role: 'judge', system: SYSTEM, stats,
        user: JSON.stringify({ goal, outcome: outcomeOf(trace), candidates: batch, steps }) });
      verdicts = Array.isArray(data?.verdicts) ? data.verdicts : [];
    } catch (e) {
      console.warn(`[judge] failed, using defaults: ${e.message}`);
    }
    const byId = new Map(verdicts.map((v) => [v.id, v]));
    for (const c of batch) findings.push(toFinding(c, byId.get(c.id) || null));
  }
  return withIds(findings);
}
