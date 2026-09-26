# AGENTS.md — rules for coding agents in this repo (hackathon mode)

This is a 26-hour hackathon project. Ship working vertical slices; no ADRs, changelogs, or phase gates.
(The generic enterprise process spec that used to live here is in `docs/process-template/` for later.)

## Work from plans
Remaining work is split into `docs/plans/NN-*.md`. When asked to execute a plan: read it fully, read its "先读" list,
change ONLY the files under "可以改", run its acceptance commands, then tick it in `docs/plans/README.md` in the same commit.
If the plan is wrong or blocked, edit the plan file and say so instead of improvising outside its scope.

## Read first
- `docs/plans/README.md` — ordered plan list, dependencies, deadlines.
- `docs/CODING_STANDARDS.md` — code rules (layering, validation, no silent catch, root-anchored paths, tests, commits). Follow it for every change.
- `docs/ARCHITECTURE.md` — module map, frozen contracts, detector rules, milestones.
- `src/contracts.mjs` — the ONLY interface between modules. Do not change a field without telling the team;
  if you must, update `fixtures/`, `docs/ARCHITECTURE.md` §3 and make `npm test` pass.

## Hard rules
1. **Information barrier.** The planner (`src/agent/planner.mjs`) may only see what `buildObservation()` returns:
   focus role/name/description, what assistive tech announced, and AX-tree page text after navigation.
   Never pass `step.changes`, screenshots, or DOM to the planner. `npm test` checks this.
2. **AI labels, rules measure.** Detectors in `src/detect/` are deterministic pure functions over the trace.
   The judge may only filter/label candidates; it can never add findings. Every finding keeps `detector` and `steps`.
3. **Fixer uses search/replace edits** (`{file, old, new}`), never unified diffs, and may not remove visible text.
4. **Real-site mode**: never type into payment/password fields, stop at checkout (enforced in `src/runner/guard.mjs`).
   Never commit real-site runs or name companies in the repo.
5. **Secrets**: keys only in `.env` (gitignored). Never print keys in logs.
6. ESM JavaScript, Node ≥ 20. Allowed deps: playwright, axe-core, openai, dotenv, yaml. Ask before adding others.
7. Keep `main` green: run `npm test` before pushing. Judges read `main` at 14:00 Sunday.
8. No silent failures: every `catch` rethrows or records the degradation in the output (see CODING_STANDARDS §3).
9. Library code under `src/` never uses `console.*` and never uses `process.cwd()`; use a `log` callback and `src/paths.mjs`.
10. Every bug fix starts with a failing regression test.
11. Do NOT follow `docs/process-template/` (archived enterprise process: no ADRs, changelogs, work-package docs).
12. Frontend is owned by teammates. Never modify `viewer/` or `sites/shop/`. The only interface to the frontend is `report.json`
    (built by `src/report/build.mjs`): changes to it must be additive only — never rename or remove a field.
    If a backend change needs a frontend change, write it down in the relevant plan's results section instead of doing it.

## Handy commands
```bash
npm run serve                                   # sites/ on http://localhost:8080
node cli.mjs audit --url http://localhost:8080/testpage/original/ --goal "Buy the canvas tote bag" \
  --script eval/keys.testpage.json --no-judge   # deterministic run, no LLM
node cli.mjs replay --trace fixtures/testpage-original/trace.jsonl --goal "Buy the canvas tote bag"
npm test
```
