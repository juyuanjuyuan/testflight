#!/usr/bin/env bash
# Demo prep (plan 12): check the machine, then run the shop main flow once through the HTTP API
# (audit → fix all block findings → rerun) and print the runDir as the demo fallback.
# Needs `npm run serve` already running. Run it with the server in LLM_CACHE=readwrite (the default)
# so the planner/judge/fixer answers land in .cache/llm; see docs/plans/12-demo-rehearsal.md, 结果.
# Never prints .env values: only the names of missing variables.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
BASE="http://localhost:$PORT"
SHOP_URL="$BASE/shop/original/"
GOAL="Buy a canvas tote bag. Pay with the test card 4000 0000 0000 0002. If it is declined, try 4242 4242 4242 4242."
AUDIT_TIMEOUT_S="${AUDIT_TIMEOUT_S:-600}"
FIX_TIMEOUT_S="${FIX_TIMEOUT_S:-900}"

fail() { echo "demo-prep: $*" >&2; exit 1; }
ok() { echo "  ok  $*"; }

echo "== checks"
command -v node >/dev/null || fail "node not found (need Node >= 20)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "Node >= 20 required, have $(node -v)"
ok "node $(node -v)"
command -v curl >/dev/null || fail "curl not found"

[ -d node_modules ] || fail "node_modules missing: run npm install"
node -e 'for (const m of ["playwright","axe-core","openai","dotenv","yaml","@guidepup/virtual-screen-reader"]) require.resolve(m)' 2>/dev/null \
  || fail "a dependency is missing: run npm install"
ok "dependencies installed"

node --input-type=module -e '
  import fs from "node:fs"; import { chromium } from "playwright";
  const p = process.env.CHROME_BIN || chromium.executablePath();
  if (!fs.existsSync(p)) { console.error(`Chromium not found at ${p}: run npx playwright install chromium (or set CHROME_BIN)`); process.exit(1); }' \
  || fail "Chromium missing"
ok "Chromium present"

[ -f .env ] || fail ".env missing: cp .env.example .env and fill in the keys"
# dotenv.parse strips the inline comments of .env.example; a variable set in the shell also counts (dotenv never overrides it)
missing="$(node -e '
  const fs = require("fs"), d = require("dotenv").parse(fs.readFileSync(".env"));
  const miss = ["SCIFORIUM_API_KEY", "MODEL_PLANNER", "MODEL_JUDGE"].filter((k) => !(process.env[k] || d[k] || "").trim());
  process.stdout.write(miss.join(" "));')"
[ -z "$missing" ] || fail ".env: missing or empty: $missing"
ok ".env has SCIFORIUM_API_KEY, MODEL_PLANNER, MODEL_JUDGE (values not shown)"

code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/runs" || true)"
[ "$code" = 200 ] || fail "no server on $BASE (GET /api/runs → ${code:-no answer}): start it with npm run serve"
code="$(curl -s -o /dev/null -w '%{http_code}' "$SHOP_URL" || true)"
[ "$code" = 200 ] || fail "$SHOP_URL → $code"
ok "server on $BASE"

# json <file-or-> <js expression over r> : prints the value (strings raw)
json() { node -e '
  const fs = require("fs"), src = process.argv[1] === "-" ? 0 : process.argv[1];
  const r = JSON.parse(fs.readFileSync(src, "utf8")), v = eval(process.argv[2]);
  process.stdout.write(typeof v === "string" ? v : JSON.stringify(v ?? null));' "$1" "$2"; }

post() { # post <path> <json body> → body on stdout; fails on non-2xx
  local out; out="$(curl -s -w '\n%{http_code}' -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2")"
  local status="${out##*$'\n'}" body="${out%$'\n'*}"
  [[ "$status" == 2* ]] || fail "POST $1 → $status $body"
  printf '%s' "$body"
}

wait_done() { # wait_done <runDir> <timeout s> <label>
  local dir="$1" deadline=$((SECONDS + $2)) state="" last=""
  while :; do
    state="$(curl -s "$BASE/runs/$dir/progress.json" | json - 'r.state + " " + (r.step ?? "-") + "/" + r.maxSteps' 2>/dev/null || echo "? ")"
    [ "$state" != "$last" ] && { echo "  $3: $state"; last="$state"; }
    case "$state" in
      done*) return 0 ;;
      failed*) fail "$3 failed: $(curl -s "$BASE/runs/$dir/progress.json" | json - 'r.error') (see runs/$dir/cli.log)" ;;
    esac
    [ $SECONDS -lt $deadline ] || fail "$3 did not finish within $2 s (runs/$dir)"
    sleep 2
  done
}

echo "== audit $SHOP_URL"
body="$(node -e 'process.stdout.write(JSON.stringify({ url: process.argv[1], goal: process.argv[2] }))' "$SHOP_URL" "$GOAL")"
RUN="$(post /api/runs "$body" | json - 'r.runDir')"
echo "  runDir $RUN"
wait_done "$RUN" "$AUDIT_TIMEOUT_S" audit
curl -s "$BASE/runs/$RUN/report.json" > "runs/$RUN/.demo-prep-audit.json"
echo "  block: $(json "runs/$RUN/.demo-prep-audit.json" 'r.findings.filter(f => f.impact === "block").map(f => f.id + " " + f.detector).join(", ")')"

echo "== fix all block findings + rerun"
post "/api/runs/$RUN/fix" '{"rerun":true}' >/dev/null
wait_done "$RUN" "$FIX_TIMEOUT_S" fix
REPORT="runs/$RUN/report.json"
RERUN_DIR="$(json "$REPORT" 'r.rerun && r.rerun.runDir')"
CLOSED="$(json "$REPORT" 'r.rerun && r.rerun.closedLoop')"
rm -f "runs/$RUN/.demo-prep-audit.json"
echo "  fixes: $(json "$REPORT" '(r.fixes || []).map(f => f.finding + ": " + f.applied + " edit(s)" + (f.errors.length ? " (errors)" : "")).join(", ")')"
echo "  rerun: $RERUN_DIR · closedLoop: $CLOSED"
[ "$CLOSED" = true ] || fail "closedLoop is $CLOSED, not true (runs/$RUN): not a usable fallback, run again"

echo
echo "demo fallback run (closedLoop true):"
echo "  runDir   $RUN"
echo "  viewer   $BASE/viewer/?run=/runs/$RUN/"
echo "$RUN"
