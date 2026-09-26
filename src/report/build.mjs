import fs from 'node:fs';
import path from 'node:path';
import { computeVerdicts } from '../verdicts.mjs';
import { heardInStep, describeFocus } from '../agent/observation.mjs';
import { NOISE_REPEAT } from '../contracts.mjs';

/** report.json is the ONLY file the viewer reads. */
export function buildReport({ meta, trace, findings, axe = null, rerun = null, fixes = null, stats = null }) {
  const isWcag = (v) => (v.tags || []).some((t) => /^wcag\d/.test(t));
  const axeOk = axe && !axe.error;
  const axeSelectors = new Set((axe?.violations || []).flatMap((v) => v.nodes.map((n) => n.target.join(' '))));
  for (const f of findings) f.axeAlsoFound = axeSelectors.has(f.evidence.selector);
  const shown = findings.filter((f) => f.impact !== 'none');
  const order = { block: 0, degrade: 1 };
  return {
    meta: { ...meta, generatedAt: new Date().toISOString() },
    verdicts: computeVerdicts(trace, findings),
    counts: {
      block: shown.filter((f) => f.impact === 'block').length,
      degrade: shown.filter((f) => f.impact === 'degrade').length,
      filteredOut: findings.length - shown.length,
      axeViolations: axeOk ? axe.violations.filter(isWcag).length : null,        // WCAG rules only; null = axe unavailable
      axeBestPractice: axeOk ? axe.violations.filter((v) => !isWcag(v)).length : null,
    },
    timeline: trace.map((s) => ({
      i: s.i, action: s.action, url: s.url, focus: describeFocus(s.focusAfter), focusRect: s.focusAfter.rect ?? null,
      seen: s.changes.filter((c) => c.visible && c.repeatCount < NOISE_REPEAT).map((c) => ({ text: c.text, rect: c.rect ?? null })), // middle column
      seenNoise: s.changes.filter((c) => c.repeatCount >= NOISE_REPEAT).map((c) => c.text),                              // carousels etc.
      heard: heardInStep(s),                                             // right column: what AT conveyed
      screenshot: s.screenshot, findingIds: shown.filter((f) => f.steps.includes(s.i)).map((f) => f.id),
    })),
    findings: shown.sort((a, b) => order[a.impact] - order[b.impact]),
    axe: !axe ? null : axe.error ? { error: axe.error } : { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, wcag: isWcag(v), nodes: v.nodes.length })) },
    fixes, rerun, stats,
  };
}

export function reportMarkdown(r) {
  const yn = (b) => (b ? '✅ yes' : '❌ no');
  const lines = [
    `## Task audit: ${r.meta.goal}`,
    `- Screen-reader user can complete: **${yn(r.verdicts.screenReaderUserCanComplete)}**`,
    `- Structure-only AI agent can complete: **${yn(r.verdicts.agentCanComplete)}** (outcome: ${r.verdicts.outcome})`,
    `- Blocking: ${r.counts.block} · Degrading: ${r.counts.degrade}` + (r.counts.axeViolations != null ? ` · axe WCAG violations: ${r.counts.axeViolations} (+${r.counts.axeBestPractice} best-practice)` : r.axe?.error ? ` · axe unavailable: ${r.axe.error}` : ''),
    '', '| id | impact | detector | WCAG | summary |', '|---|---|---|---|---|',
    ...r.findings.map((f) => `| ${f.id} | ${f.impact} | ${f.detector} | ${f.wcag.join(', ')} | ${f.summary.replace(/\|/g, '\\|')} |`),
  ];
  return lines.join('\n') + '\n';
}

export function writeReport(runDir, report) {
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(runDir, 'report.md'), reportMarkdown(report));
}
