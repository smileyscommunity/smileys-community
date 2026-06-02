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

# ── Security-header regression checks ──────────────────────────────────────
# These exist because the CSP migration (commit 9016ef7) and HSTS header
# (commit 18ca349) are easy to silently regress if next.config.js or
# middleware.ts is restructured. The smoke test catches that pre-deploy.
HDR=/tmp/smoke-headers.txt
BODY=/tmp/smoke-body.html
curl -sD "$HDR" "http://localhost:$PORT/app/login" -o "$BODY"

# CSP must be present, must include a per-request nonce, and the nonce on
# the response header must match the one Next.js applied to its <script>
# tags. If middleware ever stops setting the request-side CSP header,
# Next.js silently skips the nonce-on-script step and modern browsers
# block every script.
CSP_NONCE=$(grep -i "content-security-policy" "$HDR" | grep -oE "nonce-[a-f0-9]+" | head -1 | sed 's/nonce-//')
if [ -z "$CSP_NONCE" ]; then
  echo "  ✗ CSP header missing or has no nonce — middleware regression?"
  grep -i "content-security-policy" "$HDR" | head -1
  exit 1
fi
BODY_NONCE=$(grep -oE 'nonce="[a-f0-9]+"' "$BODY" | head -1 | sed 's/nonce="//;s/"//')
if [ -z "$BODY_NONCE" ]; then
  echo "  ✗ rendered HTML has no nonce on any <script> tag — Next.js auto-nonce broken"
  exit 1
fi
if [ "$CSP_NONCE" != "$BODY_NONCE" ]; then
  echo "  ✗ CSP nonce ($CSP_NONCE) doesn't match script nonce ($BODY_NONCE)"
  exit 1
fi
echo "  ✓ CSP nonce wired ($CSP_NONCE)"

# Any unnonced <script> tags would be blocked by 'strict-dynamic' in modern browsers.
UNNONCED=$(grep -oE '<script[^>]*>' "$BODY" | grep -cv "nonce=" || true)
if [ "${UNNONCED:-0}" -gt 0 ]; then
  echo "  ✗ $UNNONCED <script> tag(s) without a nonce attribute — would be CSP-blocked in prod"
  grep -oE '<script[^>]*>' "$BODY" | grep -v "nonce=" | head -3
  exit 1
fi
echo "  ✓ every rendered <script> tag has a nonce"

if ! grep -qi "strict-transport-security" "$HDR"; then
  echo "  ✗ HSTS header missing — next.config.js regression?"
  exit 1
fi
echo "  ✓ HSTS header present"

# /login must 200 — it's the entry point for unauthenticated users.
STATUS=$(grep -E "^HTTP/" "$HDR" | tail -1 | awk '{print $2}')
if [ "$STATUS" != "200" ]; then
  echo "  ✗ /app/login returned HTTP $STATUS (expected 200)"
  exit 1
fi
echo "  ✓ /app/login returns 200"
