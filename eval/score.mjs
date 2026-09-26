// Matching: by data-barrier id (exact), NOT by selector substring ("#add" is a substring of "#address").
// Every barrier element in sites/shop/* carries data-barrier="B<n>". Unmatched findings = false positives.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function normalize(runDir, tool) {
  if (tool === 'axe') {
    // axe gives selectors only; barrier ids come from the runner-side lookup file if present
    const axe = JSON.parse(fs.readFileSync(path.join(runDir, 'axe.json'), 'utf8'));
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
