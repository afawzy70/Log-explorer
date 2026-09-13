#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - deterministic cleanup. Removes ONLY
# resources this testbed created (everything carries
# log-explorer-testbed=true), never the owner's whole Sandbox project and
# never any other workload in it.
#
# Usage: TESTBED_NAMESPACE=log-explorer-test ./cleanup.sh
set -euo pipefail

: "${TESTBED_NAMESPACE:?Set TESTBED_NAMESPACE}"

echo "Deleting every label-selected testbed resource in ${TESTBED_NAMESPACE} ..."
oc delete deployment,service,route,buildconfig,imagestream,pod \
  -l log-explorer-testbed=true -n "${TESTBED_NAMESPACE}" --ignore-not-found

echo "Remaining resources in ${TESTBED_NAMESPACE} carrying the testbed label (should be empty):"
oc get all -l log-explorer-testbed=true -n "${TESTBED_NAMESPACE}"

echo "TESTBED_CLEANUP_COMPLETE=YES"
echo "Note: the project/namespace itself was NOT deleted - only labelled testbed resources."
