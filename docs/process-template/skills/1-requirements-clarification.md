---
name: requirements-clarification
description: Turn a raw client request into a structured, constraint-aware refined brief for a complex business system.
license: MIT
---

# 1. Requirements Clarification

This Skill turns a client's one-line request, verbal description, or scattered materials into an actionable `docs/requirements/refined-brief.md`. The goal is not to propose a solution right away, but first to make the business boundaries, domain constraints, deployment form, and acceptance criteria clear.

## 1.1 Inputs

- `docs/requirements/client-brief.md`
- Regulations, contracts, sample sheets, templates, client policies, or interface materials under `constraints/`
- Delivery deadlines, demo scenarios, deployment environments, budget, and prohibited technologies supplied by the user

## 1.2 Outputs

Create or update:

- `docs/requirements/refined-brief.md`
- When needed, a Proposed draft of `docs/decisions/ADR-NNN-<topic>.md`
- The requirements clarification conclusions recorded in `docs/changelog/YYYY-MM.md`

## 1.3 Steps

1. **Read the original brief**: extract user roles, core objects, core actions, current pain points, and demo goals.
2. **Scan constraint sources**: extract non-negotiable rules from `constraints/`, including required fields, naming, paths, formats, lifecycle, permissions, audit trail, import/export, and acceptance criteria.
3. **Abstract the business model**: convert domain terms into generic models, e.g. multi-level directories, master-detail objects, immutable metadata, state machines, attachments, version chains, approval flows, rule engines.
4. **Confirm the deployment form**: clarify cloud, multi-tenant, intranet, local single-machine, offline desktop, or hybrid mode, and whether dependencies on external services are allowed.
5. **List risks and must-ask items**: raise clarifying questions about regulations, security, database, tech stack, irreversible operations, and delivery commitments.
6. **Define the demo acceptance path**: write out the shortest business main flow for the first demo; it must be testable, reproducible, and demonstrable to the client.

## 1.4 refined-brief Template

`refined-brief.md` must include:

- **Business background**: who uses it, what problem it solves, where the current process is inefficient.
- **User roles**: administrators, business users, reviewers, external collaborators, etc.
- **Core business objects**: object hierarchy, key fields, immutable fields, file/attachment relationships.
- **Lifecycle**: states, operations, rollback, replacement, deletion, approval, publishing.
- **Constraint matrix**: hard rules from `constraints/` and how each is checked.
- **Deployment assumptions**: online/offline, single-machine/cloud, data directory, backup, permissions.
- **Non-functional requirements**: performance, concurrency, file size, audit, security, availability.
- **First demo scope**: must do, not doing yet, risk items.
- **Acceptance criteria**: observable outcomes such as runnable, testable, exportable/submittable/approvable.

## 1.5 Must-Ask Checklist

The Agent must not guess the following:

- Does the business data involve regulations, contracts, audits, or client-internal red lines?
- Must it run offline? Is access to the public internet, object storage, message queues, or external APIs allowed?
- Which fields are immutable after creation? Which operations must leave an audit trail?
- What is the client demo main flow for the first demo?
- Is introducing a new database, new native dependency, or new packaging method allowed?
- On failure, should it block, warn, or allow continuing?

## 1.6 Anti-Patterns

- **Understanding requirements only through UI pages**: a complex business system is first about data models, constraints, and lifecycle, not menu pages.
- **Proposing a solution before reading constraint sources**: whenever `constraints/` contains material, scan it before making judgments.
- **Hard-coding domain-specific terms into the generic architecture**: abstract them into portable concepts such as rule engines, controlled vocabularies, directory templates, and validation matrices.
- **Writing the demo scope as a wish list**: the first version must pass under the Release Gate; do not stuff unverifiable goals into the DoD.
