#!/usr/bin/env pwsh
#
# Windows PowerShell equivalent of scripts/smoke.sh (Legacy Remediation
# Slice 9 §Z "cross-platform scripts" - a Windows developer must not need
# WSL/Git Bash/Cygwin for this workflow). Same steps, same PASS criteria,
# same exit-code contract (0 = every step passed, non-zero + a printed
# failing step otherwise) - see smoke.sh's own header for the full
# rationale behind each step; kept deliberately in lockstep with it rather
# than diverging.
#
# Usage (PowerShell):
#   .\scripts\smoke.ps1

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { '3434' }
$BaseUrl = "http://127.0.0.1:$AppPort"
$Compose = @('docker', 'compose', '--profile', 'demo')

function Step($name) { Write-Host "`n=== $name ===" }
function Fail($message) { Write-Error "FAIL: $message"; exit 1 }

function Invoke-Cleanup {
    Step 'Stop + cleanup (limited to this stack only - no global prune)'
    & $Compose[0] $Compose[1..($Compose.Length - 1)] down 2>$null
}

try {
    if (-not (Test-Path '.env')) {
        Step 'No .env found - creating one from .env.example (documented Quick Start step)'
        Copy-Item '.env.example' '.env'
    }

    Step 'Build'
    & $Compose[0] $Compose[1..($Compose.Length - 1)] build
    if ($LASTEXITCODE -ne 0) { Fail 'docker compose build failed' }

    Step 'Start'
    & $Compose[0] $Compose[1..($Compose.Length - 1)] up -d
    if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed' }

    Step 'Health'
    $healthy = $false
    for ($i = 0; $i -lt 30; $i++) {
        $status = (docker inspect --format='{{.State.Health.Status}}' log-explorer-app-1 2>$null)
        if ($status -eq 'healthy') { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { Fail 'app container never reported healthy within 60s' }
    Write-Host 'app is healthy'

    Step 'Source discovery'
    $sources = Invoke-RestMethod -Uri "$BaseUrl/api/v1/sources" -Method Get
    if (-not ($sources | Where-Object { $_.id -eq 'fixture' })) {
        Fail 'fixture source not present in /api/v1/sources response'
    }
    Write-Host 'fixture source discovered'

    Step 'Search'
    $end = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $start = (Get-Date).ToUniversalTime().AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $body = @{ sourceId = 'fixture'; start = $start; end = $end; limit = 5 } | ConvertTo-Json
    $search = Invoke-RestMethod -Uri "$BaseUrl/api/v1/logs/search" -Method Post -ContentType 'application/json' -Body $body
    if ($null -eq $search.events) { Fail 'search response did not contain an events field' }
    if ($search.events.Count -eq 0) { Fail "search returned zero events against the fixture source's own deterministic corpus" }
    Write-Host 'search returned real fixture events'

    Step 'UI load'
    $uiResponse = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing
    if ($uiResponse.StatusCode -ne 200) { Fail "root path returned HTTP $($uiResponse.StatusCode), expected 200" }
    if ($uiResponse.Content -notmatch '(?i)log explorer') { Fail 'root response did not look like the app shell' }
    Write-Host 'UI shell loads'

    Step "SPA fallback never swallows /api or /actuator (Phase K's own PASS criterion)"
    try {
        Invoke-WebRequest -Uri "$BaseUrl/api/v1/logs/does-not-exist" -UseBasicParsing | Out-Null
        Fail 'an unmapped /api path did not return 404'
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 404) { Fail "an unmapped /api path returned $code, expected a clean 404 (never swallowed into the app shell or a fake 500)" }
    }
    $actuator = Invoke-WebRequest -Uri "$BaseUrl/actuator/health" -UseBasicParsing
    if ($actuator.StatusCode -ne 200) { Fail "/actuator/health returned $($actuator.StatusCode), expected 200" }
    Write-Host 'SPA fallback correctly scoped'

    # Same step as smoke.sh: a uniquely named rule must survive recreating
    # the `app` container (log-explorer-data named volume), then only that
    # rule is deleted again. Skip with SMOKE_SKIP_RULES_PERSISTENCE=1.
    if ($env:SMOKE_SKIP_RULES_PERSISTENCE -ne '1') {
        Step 'Classification rules survive container recreation (log-explorer-data volume)'
        $rulesUrl = "$BaseUrl/api/v1/settings/classification-rules"
        $before = Invoke-RestMethod -Uri $rulesUrl -Method Get
        if ($null -eq $before.revision) { Fail 'classification rules response has no revision' }
        $ruleName = "Smoke persistence $((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-$PID"
        $ruleBody = @{
            expectedRevision = $before.revision
            rule             = @{
                name       = $ruleName
                tags       = @('smoke')
                conditions = @(@{ field = 'message'; matcher = 'CONTAINS'; value = 'smoke-test-marker' })
            }
        } | ConvertTo-Json -Depth 6
        try {
            $created = Invoke-RestMethod -Uri $rulesUrl -Method Post -ContentType 'application/json' -Body $ruleBody
        } catch {
            Fail "creating a classification rule failed (a 503 means /app/data is not writable): $($_.Exception.Message)"
        }
        $script:SmokeRuleId = ($created.rules | Where-Object { $_.name -eq $ruleName } | Select-Object -First 1).id
        if (-not $script:SmokeRuleId) { Fail 'could not determine the id of the newly created rule' }
        Write-Host "created rule $($script:SmokeRuleId)"

        & $Compose[0] $Compose[1..($Compose.Length - 1)] up -d --force-recreate app
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose up --force-recreate app failed' }
        Start-Sleep -Seconds 2
        $healthy = $false
        for ($i = 0; $i -lt 30; $i++) {
            $status = (docker inspect --format='{{.State.Health.Status}}' log-explorer-app-1 2>$null)
            if ($status -eq 'healthy') { $healthy = $true; break }
            Start-Sleep -Seconds 2
        }
        if (-not $healthy) { Fail 'recreated app container never reported healthy within 60s' }

        $recreated = Invoke-RestMethod -Uri $rulesUrl -Method Get
        if (-not ($recreated.rules | Where-Object { $_.id -eq $script:SmokeRuleId })) {
            Fail "rule $($script:SmokeRuleId) was lost when the app container was recreated - rules are not on the named volume"
        }
        Write-Host 'rule survived container recreation'

        Invoke-RestMethod -Uri "$rulesUrl/$($script:SmokeRuleId)" -Method Delete | Out-Null
        $script:SmokeRuleId = $null
        Write-Host 'smoke rule deleted'
    }

    Write-Host "`nSMOKE TEST PASSED"
} finally {
    # A failed persistence step never leaves its own smoke rule on the volume.
    if ($script:SmokeRuleId) {
        try { Invoke-RestMethod -Uri "$BaseUrl/api/v1/settings/classification-rules/$($script:SmokeRuleId)" -Method Delete | Out-Null } catch { }
    }
    Invoke-Cleanup
}
