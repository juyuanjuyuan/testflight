---
name: implementation
description: Implement work packages safely while keeping architecture, tests, and changelog synchronized.
license: MIT
---

# 4. Implementation

This Skill is used to implement code per work package. The Agent's goal is not to "finish as fast as possible," but to satisfy the requirement with minimal changes, keep documents consistent, and leave verifiable evidence.

## 4.1 Before Coding

Before every code change, read:

- `AGENTS.md`
- The current phase skill
- The associated `docs/work-packages/WP-NN-<slug>.md`
- Relevant architecture documents: backend, frontend, database, API, tech stack
- Relevant ADRs
- Relevant `docs/tech-references/`
- Records of similar issues in `docs/changelog/`

If no associated WP can be found, first add a minimal WP or record the hotfix background in the changelog.

## 4.2 Implementation Principles

- Changes are small and closed-loop; every change can be traced to a WP or a bug's root cause.
- Prefer existing project patterns; don't introduce new dependencies or new abstractions.
- When changing architecture boundaries, API contracts, schema, or deployment methods, update documents or ADRs first.
- Don't touch unrelated files, and don't opportunistically refactor unrelated modules.
- Any temporary debug switch must be off by default, and how to turn it on must be recorded.

## 4.3 Backend Rules

- Controllers only do protocol adaptation; business logic goes in Services.
- create/update/list/detail return the same contract shape.
- All external input goes through DTOs/validation.
- Use a unified exception format; never let raw ORM/native errors leak through to the frontend.
- All dynamic list/detail GETs disable caching by default.
- Files, imports, exports, and background jobs must have progress, failure states, and a recovery strategy.
- Files may only be written to explicitly writable directories; never rely on the process `cwd()`.

## 4.4 Database Rules

- Schema changes must include a migration, rollback notes, seed impact, and tests.
- In dual-database projects, complex fields must be converted in both read and write directions.
- Raw ORM records are forbidden at service exits; they must go through a serializer.
- Immutable fields must be guarded at both the service layer and the database constraint layer.
- Migrations, seeds, and rule loading must be idempotent; don't use empty directories or marker files to fake success.

## 4.5 Frontend Rules

- React Hooks must be declared before any early return.
- Page roots must have an ErrorBoundary or equivalent error fallback.
- Loading, empty, error, and permission-denied states must all be explicit.
- Don't unmount upload controls during upload; use disabled + overlay/progress.
- When refreshing lists after optimistic updates, prevent stale responses from overwriting newer state.
- Reset form dialogs on close to avoid stale data lingering.
- Don't blindly rely on the history stack for back navigation; prefer explicit routes for key business hierarchies.

## 4.6 File and Cross-Platform Rules

- Uploaded file names must handle encoding, reserved names, path length, extensions, and size limits.
- Windows reserved names, path separators, non-ASCII usernames, and paths with spaces must be tested.
- Keep the client-visible original file name separate from the internal safe storage file name.
- Local file writes and download tokens must not leak real disk paths.

## 4.7 Desktop/Embedded Rules

- Pass the full fork env explicitly; don't rely on the shell.
- Rebuild native modules for the target runtime.
- All extra resources have postbuild verify.
- BrowserWindow or equivalent window objects must be checked for destroyed/closed state.
- Production DevTools or debug entry points must be controllable and off by default.

## 4.8 After Coding

1. Run the minimal relevant tests.
2. Run type checking or lint.
3. Update the relevant architecture docs, tech-references, and WP status.
4. Update the changelog, recording root cause, impact, and verification.
5. If a general pitfall is found, add the anti-pattern back to this skill or the corresponding tech-reference.
