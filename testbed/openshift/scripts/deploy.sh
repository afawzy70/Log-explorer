#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - renders and applies one Deployment+Service
# per entry in manifests/services.yaml, all under TESTBED_NAMESPACE, all
# carrying the two testbed labels cleanup.sh keys off.
#
# Usage:
#   TESTBED_NAMESPACE=log-explorer-test TESTBED_IMAGE=<image-ref> ./deploy.sh [VERSION]
#
# VERSION (default v1) is stamped into each pod own env - used by
# rolling-update-demo.sh to distinguish v1/v2 pods in the real logs.
set -euo pipefail

: "${TESTBED_NAMESPACE:?Set TESTBED_NAMESPACE}"
: "${TESTBED_IMAGE:?Set TESTBED_IMAGE, printed by build-and-push.sh as TESTBED_IMAGE=...}"
VERSION="${1:-v1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="${SCRIPT_DIR}/../manifests"

oc project "${TESTBED_NAMESPACE}" >/dev/null

# services.yaml -> one "name role replicas sidecar" line per service,
# plus the shared resource-sizing/background-interval values - parsed
# once with python3 (already present on any dev machine touching this
# repo; no extra bash-side YAML tooling dependency).
CONFIG="$(python3 - "${MANIFESTS_DIR}/services.yaml" <<'PY'
import sys, yaml
with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)
r = doc["resources"]
print(f"__RESOURCES__ {r['cpuRequest']} {r['memoryRequest']} {r['cpuLimit']} {r['memoryLimit']} {doc.get('backgroundIntervalMs', 4000)}")
for s in doc["services"]:
    print(f"{s['name']} {s['role']} {s['replicas']} {'1' if s.get('sidecar') else '0'}")
PY
)"

read -r _ CPU_REQUEST MEMORY_REQUEST CPU_LIMIT MEMORY_LIMIT BG_INTERVAL <<< "$(echo "${CONFIG}" | grep '^__RESOURCES__')"
export CPU_REQUEST MEMORY_REQUEST CPU_LIMIT MEMORY_LIMIT
export TESTBED_BACKGROUND_INTERVAL_MS="${BG_INTERVAL}"
export TESTBED_NAMESPACE IMAGE="${TESTBED_IMAGE}" VERSION

while read -r SERVICE_NAME SERVICE_ROLE REPLICAS SIDECAR; do
  [ -z "${SERVICE_NAME}" ] && continue
  export SERVICE_NAME SERVICE_ROLE REPLICAS
  if [ "${SIDECAR}" = "1" ]; then
    echo "Applying ${SERVICE_NAME} (with metrics sidecar) ..."
    envsubst < "${MANIFESTS_DIR}/edge-with-sidecar-template.yaml" | oc apply -f -
  else
    echo "Applying ${SERVICE_NAME} ..."
    envsubst < "${MANIFESTS_DIR}/deployment-template.yaml" | oc apply -f -
  fi
done < <(echo "${CONFIG}" | grep -v '^__RESOURCES__')

echo "Waiting for rollouts ..."
while read -r SERVICE_NAME _ _ _; do
  [ -z "${SERVICE_NAME}" ] && continue
  oc rollout status "deployment/${SERVICE_NAME}" -n "${TESTBED_NAMESPACE}" --timeout=180s || true
done < <(echo "${CONFIG}" | grep -v '^__RESOURCES__')

echo "TESTBED_DEPLOY_COMPLETE=YES"
