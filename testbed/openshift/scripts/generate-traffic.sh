#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - drives the deterministic /test/* scenarios
# (mission §7/§8) against the real testbed via its gateway Route, plus
# scenarios that only make sense on a specific service (payment-error,
# fraud-warning, customer-not-found) reached the same way (the shared
# image exposes the same endpoints on every service; only the JOURNEY
# chain is gateway-specific).
#
# Usage: TESTBED_NAMESPACE=log-explorer-test ./generate-traffic.sh [scenario ...]
# scenarios: journey customer-not-found payment-error fraud-warning
#            unknown-field empty-message burst all (default: all, once each)
set -euo pipefail

: "${TESTBED_NAMESPACE:?Set TESTBED_NAMESPACE}"
HOST="$(oc get route gateway-service -n "${TESTBED_NAMESPACE}" -o jsonpath='{.spec.host}')"
BASE="https://${HOST}"

call() {
  echo "-> POST /test/$1"
  curl -sk -X POST "${BASE}/test/$1" "${@:2}" | (cat; echo)
}

SCENARIOS=("${@:-all}")
if [ "${SCENARIOS[0]}" = "all" ]; then
  SCENARIOS=(journey journey customer-not-found payment-error fraud-warning unknown-field empty-message)
fi

for s in "${SCENARIOS[@]}"; do
  case "$s" in
    burst) call burst -d "count=20" ;;
    *) call "$s" ;;
  esac
  sleep 1
done

echo "TRAFFIC_GENERATED=YES"
