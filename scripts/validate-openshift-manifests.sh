#!/usr/bin/env bash
#
# IMPLEMENTATION_PLAN.md "Phase L": "Manifest lint/schema validation; a
# test asserting no ClusterRole/ClusterRoleBinding and no literal secret
# values anywhere under deploy/."
#
# Usage: ./scripts/validate-openshift-manifests.sh
# Requires Docker (for real Kubernetes OpenAPI schema validation via
# kubeconform - no local kubectl/oc/kubeconform install needed).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOY_DIR="deploy"
step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

[ -d "$DEPLOY_DIR" ] || fail "no $DEPLOY_DIR/ directory found"

step "YAML syntax (every document in every file)"
python3 - "$DEPLOY_DIR" <<'PYEOF'
import sys, pathlib, yaml
root = pathlib.Path(sys.argv[1])
files = sorted(root.rglob("*.yaml")) + sorted(root.rglob("*.yml"))
if not files:
    print("FAIL: no YAML files found under", root, file=sys.stderr)
    sys.exit(1)
for f in files:
    try:
        list(yaml.safe_load_all(f.read_text()))
    except yaml.YAMLError as e:
        print(f"FAIL: {f} is not valid YAML: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"  ok: {f}")
PYEOF

step "No ClusterRole / ClusterRoleBinding anywhere under $DEPLOY_DIR/ (CLAUDE.md §2 rule 9)"
if grep -rlE '^kind:\s*ClusterRole(Binding)?\s*$' "$DEPLOY_DIR" > /dev/null 2>&1; then
  grep -rlE '^kind:\s*ClusterRole(Binding)?\s*$' "$DEPLOY_DIR"
  fail "a ClusterRole or ClusterRoleBinding was found under $DEPLOY_DIR/ - never allowed"
fi
echo "none found"

step "No Secret object committed anywhere under $DEPLOY_DIR/ (credentials must be Secret *references* only)"
if grep -rlE '^kind:\s*Secret\s*$' "$DEPLOY_DIR" > /dev/null 2>&1; then
  grep -rlE '^kind:\s*Secret\s*$' "$DEPLOY_DIR"
  fail "a Secret object was found committed under $DEPLOY_DIR/ - credentials must be referenced (secretKeyRef), never committed"
fi
echo "none found"

step "No literal secret-shaped values anywhere under $DEPLOY_DIR/"
# Heuristic scan for common credential shapes (JWTs, AWS-style keys, PEM
# private key headers) - defense in depth on top of the structural "no
# Secret object" check above, which is the real guarantee.
if grep -rlEi 'BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|eyJhbGciOi' "$DEPLOY_DIR" > /dev/null 2>&1; then
  grep -rlEi 'BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|eyJhbGciOi' "$DEPLOY_DIR"
  fail "a secret-shaped literal value was found under $DEPLOY_DIR/"
fi
echo "none found"

step "Real Kubernetes OpenAPI schema validation (kubeconform, via Docker)"
# Route (route.openshift.io/v1) is an OpenShift-specific CRD with no
# schema in kubeconform's default Kubernetes-only catalog -
# -ignore-missing-schemas skips exactly that kind rather than failing the
# whole run; every standard Kubernetes resource here (ServiceAccount,
# ConfigMap, Deployment, Service, Role, RoleBinding) is still validated
# for real against the actual Kubernetes OpenAPI schema.
docker run --rm -v "${ROOT_DIR}/${DEPLOY_DIR}:/deploy:ro" \
  ghcr.io/yannh/kubeconform:latest-alpine \
  -summary -ignore-missing-schemas -strict /deploy

printf '\nOPENSHIFT MANIFEST VALIDATION PASSED\n'
