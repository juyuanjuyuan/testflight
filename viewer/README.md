# Report viewer

One static `index.html` that reads a single `report.json` (see `src/report/build.mjs`) plus the `shots/` next to it. No backend.
Develop against `fixtures/testpage-original/report.json` right now; the shop run will have the same shape.

Layout (the demo's main frame):
- Top: `verdicts.screenReaderUserCanComplete`, `verdicts.agentCanComplete`, `counts.block`, `counts.axeViolations` ("axe: 0 WCAG issues / we: N blocking").
- Left: `timeline[].action` (key + `reason` = the planner's thinking), step list, red if `findingIds` non-empty.
- Middle **what the screen showed**: `timeline[].screenshot`, draw boxes from `seen[].rect` and `focusRect`.
- Right **what assistive tech conveyed**: `timeline[].focus` + `timeline[].heard` — show "(nothing)" when empty.
- Bottom: `findings[]` (block first) with WCAG, `userImpact`, and `fix.edits` as a diff; per-finding `rerun.status[]` → resolved/persists,
  overall `rerun.after.screenReaderUserCanComplete` → "passes after fix".

Open it through `npm run serve`, which also mounts `/viewer`, `/runs` and `/fixtures` read-only:
`http://localhost:8080/viewer/?run=/fixtures/testpage-original/` (or `?run=/runs/<run-dir>/`).

Keys: ← → (or j k) step through the timeline; `#step=N` in the URL opens a given step.
`sample/report.json` is hand-written test data (fix diff, rerun, axe unavailable, missing screenshot): `http://localhost:8080/viewer/?run=/viewer/sample/`.
