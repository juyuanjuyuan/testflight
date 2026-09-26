# Report viewer

One static `index.html` that reads a single `report.json` (see `src/report/build.mjs`) plus the `shots/` next to it. No backend.
Develop against `fixtures/testpage-original/report.json` right now; the shop run will have the same shape.

Layout (the demo's main frame):
- Top: `verdicts.screenReaderUserCanComplete`, `verdicts.agentCanComplete`, `counts.block`, `counts.axeViolations` ("axe: 0 WCAG issues / we: N blocking").
- Left: `timeline[].action` (key + `reason` = the planner's thinking), step list, red if `findingIds` non-empty.
- Middle **what the screen showed**: `timeline[].screenshot`, draw boxes from `seen[].rect` and `focusRect`.
- Right **what assistive tech conveyed**: `timeline[].focus` + `timeline[].heard` — show "(nothing)" when empty.
- Bottom: `findings[]` (block first) with WCAG, `userImpact`, and `fix.edits` as a diff; `rerun.status` → "passes after fix".

Serve it from the repo root so relative paths work, e.g. `viewer/index.html?run=../fixtures/testpage-original/`.
