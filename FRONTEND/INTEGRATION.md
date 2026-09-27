# Testflight integration

The active UI uses the HTTP contract at backend commit
d6f0fea. Product text is English.
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

## Local backend verified (2026-09-27)

Frontend files in this original project folder and the running backend at
/private/tmp/testflight-backend are synced with main at d6f0fea.
The backend listens on http://127.0.0.1:8080; Vite serves this folder at
http://127.0.0.1:8443 and proxies API and report requests to the backend.
The existing backend .env, model configuration and run history were preserved.
The previous local generated-task patch is saved in Git stash; main now
implements that behavior with validation, so the old patch was not reapplied.

Validation: 34 frontend tests, TypeScript checks, production build and 169
backend tests passed. An actual scripted audit through the frontend proxy
completed as 2026-09-27T15-36-34-audit: 13 actions plus the initial step,
2 blocking and 5 degrading findings. History, fixtures and the resulting report
were reachable through port 8443. This check did not invoke AI planning or repair.

To restart the backend in a separate terminal:

    cd /private/tmp/testflight-backend
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" PORT=8080 /Users/paranxiaair/.nvm/versions/node/v22.23.2/bin/node --env-file=.env scripts/serve.mjs

The backend lives in a temporary directory. The original frontend folder is
still not a Git checkout; updating the backend alone does not update this folder.
A backup of the frontend before this sync is at
/private/tmp/frontend-before-main-sync-20260927/.
