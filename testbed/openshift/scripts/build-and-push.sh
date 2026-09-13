#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - builds the one shared testbed image using
# OpenShift's OWN build mechanism (a binary BuildConfig + ImageStream)
# rather than standing up external registry infrastructure (mission
# §12 "do not add external infrastructure unnecessarily") - the Sandbox's
# internal registry is already there and already authorized for anything
# built this way.
#
# Usage: TESTBED_NAMESPACE=log-explorer-test ./build-and-push.sh
set -euo pipefail

: "${TESTBED_NAMESPACE:?Set TESTBED_NAMESPACE to the target project/namespace}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../app" && pwd)"
IMAGE_NAME="testbed-service"

oc project "${TESTBED_NAMESPACE}" >/dev/null

if ! oc get bc "${IMAGE_NAME}" -n "${TESTBED_NAMESPACE}" >/dev/null 2>&1; then
  oc new-build --name="${IMAGE_NAME}" --strategy=docker --binary=true \
    -l app.kubernetes.io/part-of=log-explorer-sandbox-testbed,log-explorer-testbed=true \
    -n "${TESTBED_NAMESPACE}"
fi

echo "Starting binary build from ${APP_DIR} ..."
oc start-build "${IMAGE_NAME}" --from-dir="${APP_DIR}" --follow -n "${TESTBED_NAMESPACE}"

IMAGE_REF="$(oc get is "${IMAGE_NAME}" -n "${TESTBED_NAMESPACE}" -o jsonpath='{.status.dockerImageRepository}'):latest"
echo "TESTBED_IMAGE=${IMAGE_REF}"
