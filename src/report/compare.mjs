// Before/after comparison for fix -> rerun.
const keyOf = (f) => `${f.detector}|${f.evidence.barrierId || f.evidence.selector}`;

export function compareRuns(before, after) {
  const afterKeys = new Map(after.findings.filter((f) => f.impact !== 'none').map((f) => [keyOf(f), f]));
  const beforeKeys = new Set(before.findings.map(keyOf));
  const status = before.findings.filter((f) => f.impact !== 'none').map((f) => ({
    id: f.id, key: keyOf(f), status: afterKeys.has(keyOf(f)) ? 'persists' : 'resolved',
  }));
  const introduced = [...afterKeys.values()].filter((f) => !beforeKeys.has(keyOf(f))).map((f) => ({ id: f.id, key: keyOf(f), status: 'new' }));
  return {
    before: before.verdicts, after: after.verdicts, status, introduced,
    closedLoop: !before.verdicts.screenReaderUserCanComplete && after.verdicts.screenReaderUserCanComplete,
  };
}
