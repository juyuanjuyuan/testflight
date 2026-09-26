---
name: self-testing
description: Verify implementation through unit, integration, E2E, regression, and build-time hard assertions.
license: MIT
---

# 5. Self Testing

This Skill has the Agent proactively prove, before delivery, that "the change really works, old features aren't broken, and packaging won't miss resources." Testing is not a last-minute patch; it is the exit condition of every WP.

## 5.1 Inputs

- The current WP's DoD and test commands
- Interface, data, and deployment constraints in `docs/architecture/`
- Root causes and defensive measures for similar bugs in `docs/changelog/`
- Existing test directories, CI configuration, and build scripts

## 5.2 Test Levels

### Unit

- Services, helpers, serializers, validators, state machines, file naming rules, permission checks.
- Every bug fix adds at least one test that reproduces the root cause.

### Integration

- API request/response, database reads/writes, transactions, cache/queue abstractions, file storage, import/export.
- Dual-database projects must cover the key paths for both providers.

### Frontend Component

- Loading, empty, error, insufficient permissions, form reset, upload progress, list refresh.
- Regression coverage for Hooks, ErrorBoundary, tables, tree components, and dialogs.

### E2E

- Login/initialization -> create core object -> enter files or data -> approve/validate/export -> reopen and confirm data is retained.
- The first demo must cover at least the client demo main flow.

### Packaging Smoke

- The build artifact starts.
- The health endpoint is healthy.
- Initialization, migrations, seeds, and rule loading succeed.
- Key resource files and native modules exist.

## 5.3 Build-Time Hard Assertions

The following must fail fast:

- Schema parity.
- Minimum counts of key rules/dictionaries/templates.
- Existence of migration files and idempotent seed results.
- Existence of frontend static assets.
- Existence of native binaries, engines, browsers, fonts, certificates, public keys, and other resources.
- Consistency between the API health endpoint and startup script configuration.

Emitting only a warning and continuing the build is forbidden. Warnings may only be used for non-blocking information.

## 5.4 Debugging Process

When encountering a bug, proceed in this order:

1. Reproduce and record evidence: Console, Network, backend logs, database state, screenshots, or command output.
2. Locate the minimal root cause; don't change multiple guessed spots at once.
3. Write a regression test or build assertion.
4. Implement the minimal fix.
5. Run the relevant tests.
6. Update the changelog, clearly writing down the symptom, root cause, fix, and defensive measures.

Don't keep stacking fixes without evidence; if multiple layers of defense are truly needed, explain which failure mode each layer covers.

## 5.5 Async and Resource Cleanup

- At the end of tests, close intervals, timers, file watchers, database connections, browser pages, and server listeners.
- Use open-handle detection when necessary.
- Temporary files and SQLite test databases use unique paths and are deleted after tests.
- E2E tests must not depend on the dev machine's existing login state, cache, or data directory.

## 5.6 Acceptance Record

After each round of self-testing, write in the changelog or WP:

- Which commands were run.
- Pass/fail counts.
- Tests not run and why.
- Whether a cold install, rebuild, or client-machine verification is needed.
- Remaining risks.
