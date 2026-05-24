#!/bin/bash
# Pre-deploy smoke test — starts the built Next.js server locally, hits a few
# pages to exercise the page-render code paths, then greps the server log for
# webpack/runtime errors. The signal we care about is "Cannot find module"
# (the missing-chunk class of bug that 500'd prod earlier today). We do NOT
# assert HTTP status codes because pages that need the DB will 500 locally
# without one, and that's expected — not a build problem.

set -e

LOCAL="${1:-/Users/nate/smileys-community}"
PORT=3998
LOG=/tmp/smoke-server.log

cd "$LOCAL"

echo "  starting next start on :$PORT ..."
PORT=$PORT npx next start >"$LOG" 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true" EXIT

# Wait up to 30s for "Ready in" line.
READY=0
for i in $(seq 1 30); do
  if grep -q "Ready in" "$LOG" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "  ✗ server did not become ready within 30s — log:"
  tail -30 "$LOG"
  exit 1
fi

# Hit pages to exercise the render path. We discard status codes — pages with
# DB dependencies will 500 locally, which is expected. The chunk grep below
# is the real assertion.
for path in /app /app/login /app/apply /app/forgot-password /app/api/health; do
  curl -sLo /dev/null --max-time 10 "http://localhost:$PORT$path" || true
done

if grep -qE "Cannot find module.*chunks|MODULE_NOT_FOUND" "$LOG"; then
  echo "  ✗ chunk/module errors in server log:"
  grep -E "Cannot find module|MODULE_NOT_FOUND" "$LOG" | head -5
  exit 1
fi

echo "  ✓ no chunk/module errors after rendering 5 pages"
