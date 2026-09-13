#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - mission §11 rolling-deployment test.
# payment-service starts at VERSION=v1 (set by deploy.sh), generates some
# traffic, then this script performs a normal rolling update to
# VERSION=v2 (same image - only the env var changes, which is enough to
# trigger a real new ReplicaSet/rollout) and generates more traffic
# during the overlap window, so Log Explorer's supported-workload scope
# can be observed against genuine old+new ReplicaSet pods coexisting
# briefly - exactly what OS-1B's own "supported workload discovery"
# design already has to handle. Does NOT touch the product implementation.
set -euo pipefail

: "${TESTBED_NAMESPACE:?Set TESTBED_NAMESPACE}"

echo "Current payment-service pods (v1):"
oc get pods -n "${TESTBED_NAMESPACE}" -l app=payment-service

echo "Rolling payment-service to VERSION=v2 ..."
oc set env deployment/payment-service -n "${TESTBED_NAMESPACE}" VERSION=v2

echo "Watching rollout (Ctrl+C to stop watching once you've observed the overlap in Log Explorer) ..."
oc rollout status "deployment/payment-service" -n "${TESTBED_NAMESPACE}" --timeout=180s &
WATCH_PID=$!

# A short window where old and new ReplicaSet pods may both be Ready -
# this is the interesting moment to check Log Explorer's own Pod
# discovery and (separately) that an already-running Live session's
# target set stays the immutable snapshot it was resolved from.
sleep 15

wait "${WATCH_PID}" || true
echo "Current payment-service pods (post-rollout):"
oc get pods -n "${TESTBED_NAMESPACE}" -l app=payment-service
echo "ROLLING_UPDATE_TESTED=YES"
