# Testflight integration

The active UI uses the HTTP contract at backend commit
9f05fc84336d7196d6fadf29cff06a31579f4249. Product text is English.
Legacy mock screens remain on disk but are not imported by the active app.

## Local connection

Start the testflight HTTP backend separately. The frontend defaults to
proxying /api, /runs and /fixtures to http://127.0.0.1:8080.
Run `npm run dev` and open http://127.0.0.1:8443.

For a different backend, set AUDIT_API_TARGET in .env.local and restart Vite:

    AUDIT_API_TARGET=http://127.0.0.1:8080
    VITE_DEMO_URL=http://localhost:8080/shop/original/

The URL entered into the audit form must be a local test-site URL accepted by
the backend. It is not the frontend address. Real websites are launched through
the backend CLI; their recorded runs can be opened from Run history.

Production hosting must reverse-proxy /api and /runs (and /fixtures when used).
The Vite development proxy is not included in static builds.
VITE_API_BASE can instead point to a browser-accessible API origin, provided
the backend permits that origin through CORS. Never put API secrets into VITE_ variables.

## Workflow

- Start with an optional goal, or request and confirm a suggested task.
- Poll progress every second and history every five seconds.
- Read actual reports and screenshots; retain nested real/ run paths.
- Default Fix & re-test sends {rerun:true}, omitting findingIds.
- Targeted repairs are explicit; every attempt starts from the original site.
- Keep polling the original run until its comparison is complete.
- Read resolution statuses from rerun.status, not cross-run finding IDs.
- Separate agent completion, screen-reader completion and fix verification.
- Show backend checks separately from unverified AI instructions.
- Export actual evidence JSON or print a verification record.

A ?run= link restores a saved run after refresh. Unknown states are displayed
without assuming success, and step limits come from progress/report data.
Re-test reports are read-only for repairs; original findings retain repair actions.

## Validation

Requires Node 22.18+ (the test runner uses native TypeScript stripping).

    npm test
    npm run typecheck
    npm run build

Tests cover request payloads, errors/cancellation, nested artifact paths,
future statuses, screenshot geometry, and rendered audit/verification states.
They use controlled responses and server rendering, not a running backend.

## Local backend verified

Backend main at e9e1b38 was cloned to /private/tmp/testflight-backend.
It is running on 127.0.0.1:8080 with Node 22 and the installed Google Chrome.
All 145 backend tests passed outside the port-restricted sandbox.
A deterministic HTTP audit completed with run ID 2026-09-27T04-49-39-audit:
13 actions plus the initial step, 14 screenshots, 2 blocking and 5 degrading
findings. Task suggestions and the frontend's /api/runs proxy were verified.

The temporary checkout has no .env. Autonomous planning, judging and repair
require SCIFORIUM_API_KEY, MODEL_PLANNER and MODEL_JUDGE, as documented in its
.env.example. Configure secrets locally; do not paste them into chat.

Still required: a complete autonomous audit → fix → re-test cycle after model
configuration, and browser UI interaction checks (including refresh/history).
The scripted audit validates the runner and HTTP integration, not AI repair.
