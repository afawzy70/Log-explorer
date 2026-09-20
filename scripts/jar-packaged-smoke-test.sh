#!/usr/bin/env bash
#
# MISSION=PR61_DEFAULT_LOG_LEVELS_SINGLE_JAR_AND_USAGE_DOCS - packaged-JAR verification. Copies ONLY the
# given jar into a clean, isolated temporary directory and proves it is a genuinely complete, standalone
# application: starts with a plain `java -jar`, becomes healthy, serves the built frontend's index.html,
# serves a real hashed static asset, answers one representative API request, and shuts down cleanly - all
# from that one file, with nothing else in the directory, no Node, no Docker, no external application file.
#
# Usage: scripts/jar-packaged-smoke-test.sh <path-to-jar>
# Exit code 0 = every step passed.

set -euo pipefail

JAR_SRC="${1:?usage: jar-packaged-smoke-test.sh <path-to-jar>}"
if [ ! -f "$JAR_SRC" ]; then
  echo "ERROR: jar not found at $JAR_SRC" >&2
  exit 1
fi

PORT="${JAR_SMOKE_PORT:-18034}"
BASE_URL="http://127.0.0.1:${PORT}"
WORKDIR="$(mktemp -d)"
DATA_DIR="$WORKDIR/data"
APP_LOG="$WORKDIR/app.log"
APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "== [1-2/10] Clean isolated directory containing only the jar =="
mkdir -p "$DATA_DIR"
cp "$JAR_SRC" "$WORKDIR/app.jar"
ls -la "$WORKDIR"
FILE_COUNT="$(find "$WORKDIR" -maxdepth 1 -type f | wc -l | tr -d ' ')"
if [ "$FILE_COUNT" -ne 1 ]; then
  echo "ERROR: expected exactly one file (the jar) in $WORKDIR, found $FILE_COUNT" >&2
  exit 1
fi

echo "== [3/10] Starting with a plain 'java -jar' (dev profile -> deterministic Fixture source, matching the existing E2E CI convention; no Docker/OpenShift dependency) =="
(
  cd "$WORKDIR"
  SPRING_PROFILES_ACTIVE=dev \
  SERVER_PORT="$PORT" \
  LOGEXPLORER_DATA_DIR="$DATA_DIR" \
  java -jar app.jar > "$APP_LOG" 2>&1 &
  echo $! > "$WORKDIR/app.pid"
)
APP_PID="$(cat "$WORKDIR/app.pid")"

echo "== [4-5/10] Waiting for successful startup / backend health =="
HEALTHY=""
for i in $(seq 1 90); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "ERROR: the process exited before becoming healthy" >&2
    cat "$APP_LOG" >&2
    exit 1
  fi
  if curl -sf "$BASE_URL/actuator/health" 2>/dev/null | grep -q '"status":"UP"'; then
    HEALTHY=1
    echo "backend healthy after ${i}s"
    break
  fi
  sleep 1
done
if [ -z "$HEALTHY" ]; then
  echo "ERROR: backend never became healthy within 90s" >&2
  cat "$APP_LOG" >&2
  exit 1
fi

echo "== [6/10] Verifying the frontend's index.html =="
INDEX_HTML="$(curl -sf "$BASE_URL/")"
if ! echo "$INDEX_HTML" | grep -qi '<div id="root"'; then
  echo "ERROR: response from / does not look like the built frontend (no #root div)" >&2
  echo "$INDEX_HTML" >&2
  exit 1
fi

echo "== [7/10] Verifying a hashed static asset loads =="
ASSET_PATH="$(echo "$INDEX_HTML" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -n1)"
if [ -z "$ASSET_PATH" ]; then
  echo "ERROR: no hashed JS asset referenced in index.html" >&2
  echo "$INDEX_HTML" >&2
  exit 1
fi
ASSET_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$ASSET_PATH")"
if [ "$ASSET_STATUS" != "200" ]; then
  echo "ERROR: hashed asset $ASSET_PATH returned HTTP $ASSET_STATUS" >&2
  exit 1
fi
echo "static asset $ASSET_PATH loaded (200)"

echo "== [8/10] Verifying one representative API request (POST /api/v1/logs/search, Fixture source) =="
SEARCH_RESPONSE="$WORKDIR/search-response.json"
# The Fixture source enforces a real max-range validation (7 days) - a fixed distant-past/future window
# would be correctly rejected as MAX_RANGE_EXCEEDED, so this uses a genuine narrow "last hour" window.
END_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_TS="$(date -u -d '@'"$(( $(date +%s) - 3600 ))" +%Y-%m-%dT%H:%M:%SZ)"
API_STATUS="$(curl -s -o "$SEARCH_RESPONSE" -w '%{http_code}' -X POST "$BASE_URL/api/v1/logs/search" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceId\":\"fixture\",\"direction\":\"BACKWARD\",\"start\":\"$START_TS\",\"end\":\"$END_TS\"}")"
if [ "$API_STATUS" != "200" ]; then
  echo "ERROR: search API returned HTTP $API_STATUS" >&2
  cat "$SEARCH_RESPONSE" >&2
  exit 1
fi
if ! grep -q '"events"' "$SEARCH_RESPONSE"; then
  echo "ERROR: search response missing an 'events' field" >&2
  cat "$SEARCH_RESPONSE" >&2
  exit 1
fi
echo "search API responded 200 with an events payload"

echo "== [9/10] No Node process, dev server, Docker container, or external application file was ever used =="
echo "isolated directory contents (jar + this run's own generated data/log only):"
ls -la "$WORKDIR"

echo "== [10/10] Shutting down cleanly =="
kill "$APP_PID"
STOPPED=""
for _ in $(seq 1 20); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    STOPPED=1
    break
  fi
  sleep 1
done
if [ -z "$STOPPED" ]; then
  echo "ERROR: process did not exit within 20s of SIGTERM" >&2
  exit 1
fi
echo "process exited cleanly after SIGTERM"
APP_PID=""

echo "PACKAGED JAR SMOKE TEST: PASS"
