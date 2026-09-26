---
name: deployment-packaging
description: Package, verify, and deliver cloud, container, or desktop builds through a strict release gate.
license: MIT
---

# 6. Deployment Packaging

This Skill packages a project that has passed testing into a deliverable demo, trial, or official release. Deliverability is judged by cold install and main-flow acceptance, not by whether it runs on the dev machine.

## 6.1 Inputs

- `docs/architecture/tech_stack.md`
- `docs/architecture/backend_architecture.md`
- `docs/architecture/frontend_architecture.md`
- `docs/architecture/database_design.md`
- `docs/work-packages/`
- `docs/changelog/INDEX.md`
- Build scripts, deployment scripts, CI configuration

## 6.2 Outputs

- A runnable delivery package: container image, installer, archive, demo environment, or client deployment package.
- Build fingerprint, version status, and known risks in `docs/changelog/INDEX.md`.
- Client user guide, installation guide, and backup/uninstall instructions.
- Release Gate checklist results.

## 6.3 Stage A: Source Checks

- Architecture documents match the code.
- Database schema parity passes.
- The API health endpoint matches the script configuration.
- The fork/env dictionary covers every environment variable the backend requires.
- All write paths are anchored to a writable data directory.
- Key resources don't depend on dev machine paths.
- Sensitive information is not written to regular logs.
- The latest changelog entry matches the changes.

## 6.4 Stage B: Build Checks

- Frontend, backend, scripts, desktop shell, or image builds are all green.
- Postbuild verify checks:
  - Frontend `index.html` and JS assets.
  - Backend bundle and entry point.
  - Rules, templates, dictionaries, migrations, and seed resources.
  - Native modules, database engines, browsers/fonts/certificates/public keys, and other binary resources.
  - SHA256 or equivalent fingerprint.
- Start the build artifact once in a temp directory: health returns 200 and the basic login or initialization API succeeds.
- Do not run secondary install commands during the build that would overwrite already-verified artifacts.

## 6.5 Stage C: Cold Install Checks

Cold install must be performed on a clean machine, clean container, or clean user data directory:

- The data directory is created automatically on first launch.
- Migrations and seeds succeed idempotently.
- Domain rules and templates really exist, and are not faked by empty directories or marker files.
- The core business main flow runs end to end.
- Upload, import, validation, export, or the project-specific main action can be completed.
- Data is retained after restart.
- No lingering background processes after exit.
- No uncaught ERRORs in the Console and backend logs.
- Paths with spaces, non-ASCII usernames, reserved names, and long paths are spot-checked per target platform.

## 6.6 Stage D: Client Delivery Checks

- The deliverables list is complete.
- The user guide covers installation, first-time initialization, accounts, licensing, backup, uninstall, log locations, and handling of common system dialogs.
- Limitations such as unsigned builds, notarization, antivirus, browser security policies, and online downloads are clearly communicated.
- Activation codes, certificates, keys, or client configurations are tracked in a ledger.
- Open risks are written into `docs/changelog/INDEX.md`.

## 6.7 Special Rules for Desktop Delivery

- Electron or similar desktop runtimes do not share the system Node ABI; native modules must be rebuilt for the target runtime.
- Allowlist-based dependency copying easily misses files; if prune is used, there must be a required-file sanity check.
- The install directory may be read-only; logs, databases, and uploaded files must be written to the user data directory.
- The two dev-time servers usually need to converge into a single server after packaging, with the backend serving the SPA.
- A window object existing doesn't mean it's usable; reopen/activate logic must check the destroyed state.
- Production debug switches are off by default, but on-site troubleshooting must be able to open Console/Network/logs.

## 6.8 Do Not Deliver When

- It has only run on the dev machine and no cold install was performed.
- The build script has warnings but is missing key resources.
- Rule/template/seed data is empty but the process didn't fail.
- Any of native module ABI, schema parity, or health endpoint has not been verified.
- The client main flow has not run end to end.
- A known ERROR is recorded as "ignorable" without an ADR or user approval.
