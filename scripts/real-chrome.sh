#!/usr/bin/env bash
# Real-site mode: start a separate Chrome with remote debugging so `node cli.mjs audit --mode real` can take over a tab.
# Own profile dir: none of your everyday logins, saved cards or autofill are in it (and Chrome refuses remote debugging
# on the default profile anyway). The profile persists between runs, so a captcha solved once usually stays solved.
#
# usage:  scripts/real-chrome.sh [url ...]
# env:    CDP_PORT (default 9222) · A11Y_PROFILE (default /tmp/a11y-real-profile) · CHROME_BIN (Chrome binary)
#
# WSL: install Chrome inside WSL and let WSLg show the window (don't try to reach Windows' Chrome over the WSL2 NAT):
#   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
#   sudo apt install ./google-chrome-stable_current_amd64.deb
set -euo pipefail

PORT="${CDP_PORT:-9222}"
PROFILE="${A11Y_PROFILE:-/tmp/a11y-real-profile}"

find_chrome() {
  if [[ -n "${CHROME_BIN:-}" ]]; then echo "$CHROME_BIN"; return; fi
  local mac="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ -x "$mac" ]]; then echo "$mac"; return; fi
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null; then command -v "$c"; return; fi
  done
  echo "Chrome not found: install Google Chrome or set CHROME_BIN (WSL: see the comment at the top of $0)" >&2
  exit 1
}

if curl -s -m 2 "http://localhost:$PORT/json/version" >/dev/null; then
  echo "something is already listening on :$PORT (a Chrome from an earlier run?); reusing it. Close it to start fresh." >&2
  exit 0
fi

CHROME="$(find_chrome)"
echo "Chrome with remote debugging on http://localhost:$PORT (profile $PROFILE)" >&2
echo "next: node cli.mjs audit --mode real --cdp http://localhost:$PORT --goal \"...\" --out runs/real" >&2
exec "$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check --window-size=1280,900 "$@"
