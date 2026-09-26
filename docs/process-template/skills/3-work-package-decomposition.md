---
name: work-package-decomposition
description: Decompose architecture into ordered work packages with dependencies, DoD, tests, and handoff state.
license: MIT
---

# 3. Work Package Decomposition

This Skill breaks the architecture design into `docs/work-packages/WP-NN-<slug>.md` files that can be developed, verified, and handed off. A work package is not a pile of tasks; it is a vertical slice that can be closed out independently.

## 3.1 Inputs

- `docs/requirements/refined-brief.md`
- The five architecture documents in `docs/architecture/`
- `docs/decisions/`
- `constraints/`

## 3.2 Outputs

- `docs/work-packages/WP-01-<slug>.md` through `WP-NN-<slug>.md`
- Dependencies, DoD, test commands, and documentation updates for each WP
- Milestone planning in `docs/changelog/INDEX.md`

## 3.3 Decomposition Principles

1. **Freeze foundational rules first**: domain rules, directory templates, controlled vocabularies, permission matrices, the schema baseline, and the API prefix are decided first.
2. **Deliver the underlying runtime first**: database compatibility, file storage, cache/queue abstractions, health checks, logging, and writable paths come before business pages.
3. **Prefer vertical slices**: a WP should close the loop from data model to API to page to tests, rather than "one backend package, one frontend package."
4. **Prioritize the demoable main flow**: the first demo opens up the shortest business path first, then edge capabilities.
5. **Every package has acceptance commands**: never just write "development complete"; write tests, builds, or manual acceptance steps.

## 3.4 Standard WP Template

Each work package must include:

- **WP Goal**: the goal of this package.
- **Business Scope**: business scope and what is out of scope.
- **Prerequisites**: dependent WPs, ADRs, architecture documents.
- **Data Changes**: schema, migrations, seeds, compatibility strategy.
- **Backend Steps**: module/service/controller/guard/job/storage, etc.
- **Frontend Steps**: pages, components, state, error boundaries, empty states, loading states.
- **API Contract**: endpoints, request, response, error format.
- **Docs To Update**: architecture docs, tech-references, and changelog that must be updated in sync.
- **Tests**: unit, integration, E2E, manual acceptance.
- **Release Risk**: whether it involves migration, native rebuild, client data, cold install.
- **Handoff State**: TODO / IN_PROGRESS / READY_FOR_QA / READY_FOR_NEXT / BLOCKED.

## 3.5 Vertical Slice Execution Order

Proceed in the following order by default:

```text
Constraint/Rule -> Database Schema -> Migration/Seed -> DTO/Contract -> Service -> Controller -> Frontend -> Tests -> Docs -> Changelog
```

If a step needs to be skipped, the reason must be written in the WP.

## 3.6 Anti-Patterns

- **Drawing pages first and filling in the data model later**: complex business systems will repeatedly overturn the UI later on.
- **Leaving migrations until the end**: schema changes become untraceable, and test and delivery environments diverge.
- **A WP with no test command**: it can't be handed off, and there's no way to tell whether it's done.
- **Leaving deployment capability to the last day**: path, env, and native dependency problems in local/desktop/container setups often only surface during cold install.
- **Writing only the happy path**: approval, withdrawal, replacement, deletion, duplicate submission, empty data, and insufficient permissions all need to be planned.
