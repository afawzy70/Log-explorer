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

APP_PORT="${APP_PORT:-3434}"
BASE_URL="http://127.0.0.1:${APP_PORT}"
COMPOSE=(docker compose --profile demo)

step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

SMOKE_RULE_ID=""

cleanup() {
  # A failed persistence step never leaves its own smoke rule on the volume.
  if [ -n "$SMOKE_RULE_ID" ]; then
    # Deletes carry the current rules revision (optimistic concurrency).
    CLEANUP_REVISION="$(curl -s "${BASE_URL}/api/v1/settings/classification-rules" | grep -Eo '"revision":[0-9]+' | head -n1 | cut -d: -f2 || true)"
    curl -s -o /dev/null -X DELETE "${BASE_URL}/api/v1/settings/classification-rules/${SMOKE_RULE_ID}?expectedRevision=${CLEANUP_REVISION}" || true
  fi
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

# Classification rules persistence across container recreation: the rules
# file lives on the `log-explorer-data` named volume (docker-compose.yml).
# Creates one uniquely named rule, recreates only the `app` container,
# checks the rule is still there, then deletes that one rule again (other
# rules already on the volume are never touched). Skip with
# SMOKE_SKIP_RULES_PERSISTENCE=1.
if [ "${SMOKE_SKIP_RULES_PERSISTENCE:-0}" != "1" ]; then
  step "Classification rules survive container recreation (log-explorer-data volume)"
  RULES_URL="${BASE_URL}/api/v1/settings/classification-rules"
  rule_ids() { grep -Eo '"id":"[^"]+"' | sort -u || true; }

  BEFORE_JSON="$(curl -sf "$RULES_URL")" || fail "GET ${RULES_URL} failed"
  REVISION="$(printf '%s' "$BEFORE_JSON" | grep -Eo '"revision":[0-9]+' | head -n1 | cut -d: -f2 || true)"
  [ -n "$REVISION" ] || fail "classification rules response has no revision"
  RULE_NAME="Smoke persistence $(date -u +%Y%m%dT%H%M%SZ)-$$"
  AFTER_JSON="$(curl -sf -X POST "$RULES_URL" -H 'Content-Type: application/json' \
    -d "{\"expectedRevision\":${REVISION},\"rule\":{\"name\":\"${RULE_NAME}\",\"tags\":[\"smoke\"],\"conditions\":[{\"field\":\"message\",\"matcher\":\"CONTAINS\",\"value\":\"smoke-test-marker\"}]}}")" \
    || fail "creating a classification rule failed (a 503 means /app/data is not writable)"
  # The new rule's id is the one id present after the save but not before.
  SMOKE_RULE_ID="$(comm -13 <(printf '%s' "$BEFORE_JSON" | rule_ids) <(printf '%s' "$AFTER_JSON" | rule_ids) | head -n1 | sed -e 's/^"id":"//' -e 's/"$//')"
  [ -n "$SMOKE_RULE_ID" ] || fail "could not determine the id of the newly created rule"
  echo "created rule ${SMOKE_RULE_ID}"

  "${COMPOSE[@]}" up -d --force-recreate app
  sleep 2
  HEALTHY=""
  for _ in $(seq 1 30); do
    status="$(docker inspect --format='{{.State.Health.Status}}' log-explorer-app-1 2>/dev/null || echo "")"
    if [ "$status" = "healthy" ]; then
      HEALTHY="1"
      break
    fi
    sleep 2
  done
  [ -n "$HEALTHY" ] || fail "recreated app container never reported healthy within 60s"

  RECREATED_JSON="$(curl -sf "$RULES_URL")" || fail "GET ${RULES_URL} after recreate failed"
  printf '%s' "$RECREATED_JSON" | grep -q "\"id\":\"${SMOKE_RULE_ID}\"" \
    || fail "rule ${SMOKE_RULE_ID} was lost when the app container was recreated - rules are not on the named volume"
  echo "rule survived container recreation"

  CURRENT_REVISION="$(printf '%s' "$RECREATED_JSON" | grep -Eo '"revision":[0-9]+' | head -n1 | cut -d: -f2 || true)"
  curl -sf -o /dev/null -X DELETE "${RULES_URL}/${SMOKE_RULE_ID}?expectedRevision=${CURRENT_REVISION}" \
    || fail "deleting smoke rule ${SMOKE_RULE_ID} failed"
  SMOKE_RULE_ID=""
  echo "smoke rule deleted"
fi

printf '\nSMOKE TEST PASSED\n'
