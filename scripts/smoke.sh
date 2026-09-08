#!/usr/bin/env bash
#
# IMPLEMENTATION_PLAN.md "Phase K" scope item 6: deterministic smoke test -
# build -> start -> health -> source discovery -> search -> UI load -> stop
# -> cleanup, limited to this stack only (no global prune, ever). Uses only
# the `demo` profile - the default happy path, no host Docker socket or
# Loki mock required - so this script is a fair fresh-clone rehearsal on
# its own.
#
# Usage: ./scripts/smoke.sh
# Exit code 0 = every step passed. Any failure prints the failing step and
# exits non-zero; cleanup still runs via the trap below either way.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_PORT="${APP_PORT:-8080}"
BASE_URL="http://127.0.0.1:${APP_PORT}"
COMPOSE=(docker compose --profile demo)

step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

cleanup() {
  step "Stop + cleanup (limited to this stack only - no global prune)"
  "${COMPOSE[@]}" down || true
}
trap cleanup EXIT

if [ ! -f .env ]; then
  step "No .env found - creating one from .env.example (documented Quick Start step)"
  cp .env.example .env
fi

step "Build"
"${COMPOSE[@]}" build

step "Start"
"${COMPOSE[@]}" up -d

step "Health"
HEALTHY=""
for _ in $(seq 1 30); do
  status="$(docker inspect --format='{{.State.Health.Status}}' log-explorer-app-1 2>/dev/null || echo "")"
  if [ "$status" = "healthy" ]; then
    HEALTHY="1"
    break
  fi
  sleep 2
done
[ -n "$HEALTHY" ] || fail "app container never reported healthy within 60s"
echo "app is healthy"

step "Source discovery"
SOURCES_JSON="$(curl -sf "${BASE_URL}/api/v1/sources")"
echo "$SOURCES_JSON" | grep -q '"id":"fixture"' || fail "fixture source not present in /api/v1/sources response"
echo "fixture source discovered"

step "Search"
END="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
START="$(date -u -d '-1 day' +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-1d +"%Y-%m-%dT%H:%M:%SZ")"
SEARCH_JSON="$(curl -sf -X POST "${BASE_URL}/api/v1/logs/search" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceId\":\"fixture\",\"start\":\"${START}\",\"end\":\"${END}\",\"limit\":5}")"
echo "$SEARCH_JSON" | grep -q '"events"' || fail "search response did not contain an events field"
echo "$SEARCH_JSON" | grep -q '"events":\[\]' && fail "search returned zero events against the fixture source's own deterministic corpus"
echo "search returned real fixture events"

step "UI load"
UI_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/")"
[ "$UI_STATUS" = "200" ] || fail "root path returned HTTP ${UI_STATUS}, expected 200"
UI_BODY="$(curl -sf "${BASE_URL}/")"
echo "$UI_BODY" | grep -qi "log explorer" || fail "root response did not look like the app shell"
echo "UI shell loads"

step "SPA fallback never swallows /api or /actuator (Phase K's own PASS criterion)"
API_404="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/v1/logs/does-not-exist")"
[ "$API_404" = "404" ] || fail "an unmapped /api path returned ${API_404}, expected a clean 404 (never swallowed into the app shell or a fake 500)"
ACTUATOR_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/actuator/health")"
[ "$ACTUATOR_STATUS" = "200" ] || fail "/actuator/health returned ${ACTUATOR_STATUS}, expected 200"
echo "SPA fallback correctly scoped"

printf '\nSMOKE TEST PASSED\n'
