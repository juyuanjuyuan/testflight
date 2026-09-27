// eval/groundtruth/*.yaml: every planted barrier says how it should affect THIS flow's task (plan 10 follow-up),
// so the eval can score the judge's task-level impact separately from detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from '../src/paths.mjs';
import { IMPACTS } from '../src/contracts.mjs';

const DIR = path.join(ROOT, 'eval', 'groundtruth');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yaml'));

test('every ground-truth barrier has expectedImpact block|degrade|none', () => {
  assert.ok(files.length > 0);
  for (const f of files) {
    for (const b of YAML.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).barriers || []) {
      assert.ok(IMPACTS.includes(b.expectedImpact), `${f} ${b.id}: expectedImpact ${b.expectedImpact}`);
    }
  }
});

test('T5 (optional coupon) is expected to be irrelevant to buying the tote bag', () => {
  const t5 = YAML.parse(fs.readFileSync(path.join(DIR, 'testpage.yaml'), 'utf8')).barriers.find((b) => b.id === 'T5');
  assert.equal(t5.expectedImpact, 'none');
});
