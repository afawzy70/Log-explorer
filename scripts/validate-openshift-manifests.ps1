#!/usr/bin/env pwsh
#
# Windows PowerShell equivalent of scripts/validate-openshift-manifests.sh
# (Legacy Remediation Slice 9 §Z) - same steps, same PASS criteria. Still
# shells out to `python3` for YAML parsing (exactly like the Bash version
# does, via its own heredoc) rather than reimplementing a YAML parser in
# PowerShell - Python is already a required tool for this one script on
# every platform, so this adds no new cross-platform dependency.
#
# Usage: .\scripts\validate-openshift-manifests.ps1
# Requires Docker (for real Kubernetes OpenAPI schema validation via
# kubeconform) and python3 with PyYAML.

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$DeployDir = 'deploy'
function Step($name) { Write-Host "`n=== $name ===" }
function Fail($message) { Write-Error "FAIL: $message"; exit 1 }

if (-not (Test-Path $DeployDir -PathType Container)) { Fail "no $DeployDir/ directory found" }

Step 'YAML syntax (every document in every file)'
$pyScript = @'
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
'@
$tempPy = [System.IO.Path]::GetTempFileName() + '.py'
Set-Content -Path $tempPy -Value $pyScript
try {
    python3 $tempPy $DeployDir
    if ($LASTEXITCODE -ne 0) { Fail 'YAML syntax check failed' }
} finally {
    Remove-Item $tempPy -ErrorAction SilentlyContinue
}

Step "No ClusterRole / ClusterRoleBinding anywhere under $DeployDir/ (CLAUDE.md §2 rule 9)"
$clusterRoleMatches = Get-ChildItem -Recurse -Path $DeployDir -Include '*.yaml', '*.yml' |
    Select-String -Pattern '^kind:\s*ClusterRole(Binding)?\s*$'
if ($clusterRoleMatches) {
    $clusterRoleMatches | ForEach-Object { Write-Host $_.Path }
    Fail "a ClusterRole or ClusterRoleBinding was found under $DeployDir/ - never allowed"
}
Write-Host 'none found'

Step "No Secret object committed anywhere under $DeployDir/ (credentials must be Secret *references* only)"
$secretMatches = Get-ChildItem -Recurse -Path $DeployDir -Include '*.yaml', '*.yml' |
    Select-String -Pattern '^kind:\s*Secret\s*$'
if ($secretMatches) {
    $secretMatches | ForEach-Object { Write-Host $_.Path }
    Fail "a Secret object was found committed under $DeployDir/ - credentials must be referenced (secretKeyRef), never committed"
}
Write-Host 'none found'

Step "No literal secret-shaped values anywhere under $DeployDir/"
$secretShaped = Get-ChildItem -Recurse -Path $DeployDir -Include '*.yaml', '*.yml' |
    Select-String -Pattern 'BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|eyJhbGciOi'
if ($secretShaped) {
    $secretShaped | ForEach-Object { Write-Host $_.Path }
    Fail "a secret-shaped literal value was found under $DeployDir/"
}
Write-Host 'none found'

Step 'Real Kubernetes OpenAPI schema validation (kubeconform, via Docker)'
# Route (route.openshift.io/v1) is an OpenShift-specific CRD with no
# schema in kubeconform's default Kubernetes-only catalog -
# -ignore-missing-schemas skips exactly that kind rather than failing the
# whole run; every standard Kubernetes resource here is still validated
# for real against the actual Kubernetes OpenAPI schema.
docker run --rm -v "${RootDir}\${DeployDir}:/deploy:ro" `
    ghcr.io/yannh/kubeconform:latest-alpine `
    -summary -ignore-missing-schemas -strict /deploy
if ($LASTEXITCODE -ne 0) { Fail 'kubeconform validation failed' }

Write-Host "`nOPENSHIFT MANIFEST VALIDATION PASSED"
