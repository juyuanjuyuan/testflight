---
name: architecture-design
description: Produce the architecture document set for a complex business system before implementation starts.
license: MIT
---

# 2. Architecture Design

This Skill turns `docs/requirements/refined-brief.md` into the five architecture documents, key ADRs, and implementable engineering constraints. Before any coding, a sufficiently clear architecture baseline must exist.

## 2.1 Inputs

- `docs/requirements/refined-brief.md`
- `constraints/`
- Existing `docs/decisions/`
- Any client-specified tech stack, deployment restrictions, or security requirements

## 2.2 Outputs

Create or update under `docs/architecture/`:

- `tech_stack.md`
- `backend_architecture.md`
- `frontend_architecture.md`
- `database_design.md`
- `api_design.md`

Create the necessary ADRs under `docs/decisions/`.

## 2.3 Requirements for the Five Architecture Documents

### tech_stack.md

Must record:

- Frontend, backend, database, cache, queue, object storage, desktop shell, testing, and deployment tools.
- Explicitly prohibited items and why.
- Differences between cloud mode and local/desktop mode.
- High-risk dependencies such as native dependencies, browser automation, and PDF/Office/image processing.

### backend_architecture.md

Must record:

- Module boundaries, dependency injection, service layer responsibilities.
- Authentication, authorization, auditing, exception filters, logging strategy.
- Abstractions for file storage, cache, queue, import/export, and background jobs.
- For embedded/desktop runtimes: startup method, health checks, environment variable injection.

### frontend_architecture.md

Must record:

- Routing strategy, layouts, page hierarchy, component boundaries.
- Global error boundaries and loading/empty/failure states.
- Conventions for complex components such as tables, uploads, tree directories, editors, and approval panels.
- Environment awareness, file preview, and debug entry points for local/desktop mode.

### database_design.md

Must record:

- ER relationships, core tables, field constraints, indexes, uniqueness.
- Immutable fields, lifecycle fields, audit fields.
- Dual-database compatibility strategy: JSON/array fallback, time types, enums, foreign keys, transactions, migrations.
- Idempotency strategy for seeds and key rule data.

### api_design.md

Must record:

- API prefix, resource naming, request/response contracts, error format.
- Whether create/update/list/detail return the same shape.
- Caching strategy for dynamic lists; caching is disabled by default.
- Contracts for file upload, download, preview, bulk import, and export jobs.

## 2.4 Mandatory Architecture Principles

### Dual-Provider Data Compatibility

If multiple databases are supported:

- Complex fields must use a unified serializer/parser.
- Every service exit returns frontend contract types; leaking raw ORM records is forbidden.
- The schema parity check is part of CI or the build scripts.
- When adding a JSON field, write both read and write tests.

### Same-Origin SPA Delivery

If the final artifact has the backend serving the frontend SPA:

- Static asset serving and the SPA catch-all are architecture requirements, not deployment details.
- The catch-all route must be registered last and must exclude API, health, file streams, and assets.
- After building, check `index.html`, JS chunks, and the health endpoint.

### Explicit Writable Paths and Environment Variables

Local/desktop runtimes must not rely on the dev machine's `cwd()`, shell env, or implicit resource paths:

- Database, logs, uploaded files, cache, and temp directories must be anchored to a writable data directory.
- The env dictionary for forked child processes must cover every variable the backend requires.
- Paths with spaces, non-ASCII usernames, and read-only install directories must be handled as architecture scenarios.

### Fail Fast

Key rules, templates, dictionaries, resources, engines, migrations, license public keys, etc. must never be silently skipped. The architecture documents must specify how build-time assertions are done.

## 2.5 ADR Triggers

An ADR must be written when:

- A core dependency is introduced or removed.
- The database schema or persistence strategy changes significantly.
- A cloud/local/desktop delivery mode is chosen.
- The API root path, authentication, permissions, or security level changes.
- A solution has been changed more than twice.
- The user has rejected a solution and a "don't go this way again" record is needed.

ADRs must include Context, Options, Decision, Consequences, and Rollback Plan.
