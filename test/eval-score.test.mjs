// eval/score.mjs: detection counts every barrier the detectors found; impact grading compares the level given to each
// detected barrier (none = judged irrelevant) with the ground truth's expectedImpact (plan 10 follow-up).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeRun } from '../eval/score.mjs';

function fixture(findings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-score-'));
  fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(findings.map(([barrierId, impact], n) => ({
    id: `F${n + 1}`, detector: 'd', wcag: [], impact, evidence: { selector: `#e${n}`, barrierId } }))));
  const gt = path.join(dir, 'gt.yaml');
  fs.writeFileSync(gt, ['variant: original', 'barriers:',
    '  - { id: A, expectedImpact: block }', '  - { id: B, expectedImpact: none }',
    '  - { id: C, expectedImpact: degrade }', '  - { id: D, expectedImpact: degrade }'].join('\n'));
  return { runDir: dir, groundtruth: gt };
}

test('gradeRun: worst level per detected barrier vs expectedImpact; undetected barriers are not graded', () => {
  const f = fixture([['A', 'degrade'], ['A', 'block'], ['B', 'none'], ['C', 'block'], [null, 'degrade']]);
  const g = gradeRun(f);
  assert.deepEqual(g.graded, [
    { id: 'A', expected: 'block', given: 'block' },
    { id: 'B', expected: 'none', given: 'none' },
    { id: 'C', expected: 'degrade', given: 'block' },
  ]);
  assert.equal(g.agree, 2);
  assert.deepEqual(g.ungraded, ['D']);
  fs.rmSync(f.runDir, { recursive: true });
});

test('gradeRun refuses ground truth without expectedImpact', () => {
  const f = fixture([['A', 'block']]);
  fs.writeFileSync(f.groundtruth, 'barriers:\n  - { id: A }\n');
  assert.throws(() => gradeRun(f), /A.*expectedImpact/);
  fs.rmSync(f.runDir, { recursive: true });
});
