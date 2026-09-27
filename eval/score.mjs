// Matching: by data-barrier id (exact), NOT by selector substring ("#add" is a substring of "#address").
// Every barrier element in sites/shop/* carries data-barrier="B<n>". Unmatched findings = false positives.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function normalize(runDir, tool) {
  if (tool === 'axe') {
    // axe gives selectors only; barrier ids come from the runner-side lookup file if present
    const axe = JSON.parse(fs.readFileSync(path.join(runDir, 'axe.json'), 'utf8'));
    if (axe.error) throw new Error(`axe was unavailable in ${runDir}: ${axe.error}`);
    return axe.violations.filter((v) => v.tags.some((t) => /^wcag\d/.test(t))).flatMap((v) => v.nodes.map((n) => ({ barrierId: n.barrierId ?? null, selector: n.target.join(' '), wcag: v.tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => t.slice(4).split('').join('.')) })));
  }
  const findings = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  return findings.filter((f) => f.impact !== 'none').map((f) => ({ barrierId: f.evidence.barrierId, selector: f.evidence.selector, wcag: f.wcag, id: f.id }));
}

export function scoreRun({ runDir, groundtruth, tool = 'ours' }) {
  const gt = YAML.parse(fs.readFileSync(groundtruth, 'utf8'));
  const barriers = gt.barriers || [];
  const found = normalize(runDir, tool);
  const hit = new Set();
  let fp = 0;
  for (const f of found) {
    const b = barriers.find((b) => (f.barrierId ? f.barrierId === b.id : f.selector === b.selector));
    if (b) hit.add(b.id); else fp++;
  }
  return { dataset: path.basename(groundtruth, '.yaml'), variant: gt.variant || 'original', tool, planted: barriers.length,
    hits: hit.size, misses: barriers.filter((b) => !hit.has(b.id)).map((b) => b.id), falsePositives: fp };
}

export function scoreTable(rows) {
  return ['| dataset | variant | tool | planted | detected | missed | false positives |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.dataset} | ${r.variant} | ${r.tool} | ${r.planted} | ${r.hits} | ${r.misses.join(' ') || '–'} | ${r.falsePositives} |`)].join('\n');
}

const SEVERITY = { none: 0, degrade: 1, block: 2 };

/**
 * Impact grading for one run: for every barrier the detectors found, the level the findings give it (the most severe
 * when several findings hit it; none = judged irrelevant) vs the ground truth's expectedImpact.
 * Barriers no finding hits are `ungraded` (a detection miss, scored by scoreRun), not wrong.
 */
export function gradeRun({ runDir, groundtruth }) {
  const barriers = YAML.parse(fs.readFileSync(groundtruth, 'utf8')).barriers || [];
  const missing = barriers.filter((b) => !(b.expectedImpact in SEVERITY)).map((b) => b.id);
  if (missing.length) throw new Error(`${groundtruth}: barriers ${missing.join(' ')} need expectedImpact (block|degrade|none)`);
  const findings = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  const given = new Map();
  for (const f of findings) {
    const id = f.evidence.barrierId;
    if (id && (!given.has(id) || SEVERITY[f.impact] > SEVERITY[given.get(id)])) given.set(id, f.impact);
  }
  const graded = barriers.filter((b) => given.has(b.id)).map((b) => ({ id: b.id, expected: b.expectedImpact, given: given.get(b.id) }));
  return { graded, agree: graded.filter((g) => g.given === g.expected).length, ungraded: barriers.filter((b) => !given.has(b.id)).map((b) => b.id) };
}
