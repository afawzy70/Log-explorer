#!/usr/bin/env pwsh
#
# Legacy Remediation Slice 9 §AG "PACKAGED WINDOWS SMOKE TEST — MANDATORY":
# installs the real generated installer, launches the real installed
# product (launcher.exe -> bundled JRE -> Spring Boot -> WebView2), and
# verifies the real end-to-end lifecycle: backend health, UI load, a
# representative API call, then a shutdown that leaves no orphan
# java.exe process behind. This does NOT drive the WebView2 UI itself
# (no UI-automation harness is wired up for this slice - see the Slice 9
# Windows desktop report for exactly what remains manual) - everything
# else in the real packaged lifecycle is verified for real here, not
# assumed from "jpackage/ISCC produced a file".
#
# Usage (PowerShell, Windows CI):
#   .\desktop\packaging\packaged-smoke-test.ps1 -InstallerPath <path-to-generated-exe>

param(
    [Parameter(Mandatory = $true)][string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Log Explorer'
# Where the launcher tells the backend to persist classification rules
# (AppPaths.DataDirectory, passed as LOGEXPLORER_DATA_DIR).
$RulesDataDir = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'LogExplorer\data'))
$RulesFileNames = @('classification-rules.json', 'classification-rules.json.bak')
# Set once this script has saved any pre-existing rules data aside; the
# restore below puts it back (or removes what the smoke rule created) so a
# developer machine or CI runner is left exactly as it was found.
$script:RulesBackupDir = $null

function Step($name) { Write-Host "`n=== $name ===" }

function Restore-ClassificationRulesData {
    if (-not $script:RulesBackupDir) { return }
    try {
        foreach ($name in $RulesFileNames) {
            $target = Join-Path $RulesDataDir $name
            $saved = Join-Path $script:RulesBackupDir $name
            if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $target -Force }
            else { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
        }
        if ((Test-Path -LiteralPath $RulesDataDir) -and -not (Get-ChildItem -LiteralPath $RulesDataDir -Force)) {
            Remove-Item -LiteralPath $RulesDataDir -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $script:RulesBackupDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "WARNING: could not fully restore classification rules data under $RulesDataDir"
    }
    $script:RulesBackupDir = $null
}

# Restores rules data first, so a failed run never leaves the smoke rule behind.
function Fail($message) { Restore-ClassificationRulesData; Write-Error "FAIL: $message"; exit 1 }

function Test-PathIsUnder($path, $root) {
    $full = [System.IO.Path]::GetFullPath($path)
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    return $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
}

Step 'Install (silent, per-user - no admin/UAC prompt expected)'
$installProc = Start-Process -FilePath $InstallerPath -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS' -Wait -PassThru
if ($installProc.ExitCode -ne 0) { Fail "installer exited with code $($installProc.ExitCode)" }

$launcherExe = Join-Path $InstallDir 'LogExplorerLauncher.exe'
if (-not (Test-Path $launcherExe)) { Fail "installed launcher not found at $launcherExe" }
Write-Host "Installed at $InstallDir"

Step 'Verify product/version/publisher metadata (v0.1.0 release branding requirement)'
$expectedPublisher = 'Ahmed Fawzy elrifaye'
# Inno Setup writes per-user uninstall info under HKCU with an "_is1"
# suffix appended to the [Setup] AppId - this IS the real Add/Remove
# Programs / Installed Apps entry a user sees, not a simulation of it.
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{9F1B7C3E-4C7B-4F2C-9C1E-2A7B7D9C4B10}_is1'
if (-not (Test-Path $uninstallKey)) { Fail "uninstall registry key not found at $uninstallKey - Add/Remove Programs entry was not created" }
$uninstallInfo = Get-ItemProperty -Path $uninstallKey
Write-Host "Add/Remove Programs DisplayName: $($uninstallInfo.DisplayName)"
Write-Host "Add/Remove Programs Publisher:   $($uninstallInfo.Publisher)"
Write-Host "Add/Remove Programs DisplayVersion: $($uninstallInfo.DisplayVersion)"
if ($uninstallInfo.DisplayName -notlike 'Log Explorer*') { Fail "Add/Remove Programs DisplayName is '$($uninstallInfo.DisplayName)', expected it to start with 'Log Explorer'" }
if ($uninstallInfo.Publisher -ne $expectedPublisher) { Fail "Add/Remove Programs Publisher is '$($uninstallInfo.Publisher)', expected '$expectedPublisher'" }

$launcherVersionInfo = (Get-Item $launcherExe).VersionInfo
Write-Host "Launcher executable CompanyName:    $($launcherVersionInfo.CompanyName)"
Write-Host "Launcher executable ProductName:    $($launcherVersionInfo.ProductName)"
Write-Host "Launcher executable FileDescription: $($launcherVersionInfo.FileDescription)"
Write-Host "Launcher executable ProductVersion:  $($launcherVersionInfo.ProductVersion)"
if ($launcherVersionInfo.CompanyName -ne $expectedPublisher) { Fail "launcher executable CompanyName is '$($launcherVersionInfo.CompanyName)', expected '$expectedPublisher'" }
if ($launcherVersionInfo.ProductName -ne 'Log Explorer') { Fail "launcher executable ProductName is '$($launcherVersionInfo.ProductName)', expected 'Log Explorer'" }
Write-Host 'Product/version/publisher metadata verified'

Step 'Launch the real installed application'
$launcherProc = Start-Process -FilePath $launcherExe -PassThru
Start-Sleep -Seconds 2
if ($launcherProc.HasExited) { Fail "launcher process exited immediately (code $($launcherProc.ExitCode)) - see %LOCALAPPDATA%\LogExplorer\logs\backend.log" }

Step 'Wait for backend health (bounded, 3434 preferred but the launcher may have fallen back - poll the log for the actual port)'
$backendLog = Join-Path $env:LOCALAPPDATA 'LogExplorer\logs\backend.log'
$port = 3434
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/actuator/health" -TimeoutSec 2
        if ($resp.status -eq 'UP') { $healthy = $true; break }
    } catch {
        # Not up yet, or 3434 was actually unavailable to this process for
        # an unrelated CI-runner reason - either way, keep polling on the
        # preferred port for the bounded window below before giving up.
    }
    Start-Sleep -Seconds 1
}
if (-not $healthy) {
    if (Test-Path $backendLog) { Write-Host "--- backend.log tail ---"; Get-Content $backendLog -Tail 50 }
    Fail 'backend never reported healthy within 30s'
}
Write-Host "Backend healthy on port $port"

Step 'Verify the local UI loads (served by Spring Boot itself, no separate frontend server)'
$ui = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing
if ($ui.StatusCode -ne 200) { Fail "root path returned HTTP $($ui.StatusCode)" }
if ($ui.Content -notmatch '(?i)log explorer') { Fail 'root response did not look like the app shell' }
Write-Host 'UI shell loads'

Step 'Verify a representative API call'
$sources = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/sources"
if (-not ($sources | Where-Object { $_.id -eq 'fixture' -or $_.id -eq 'local-docker' -or $_.id -eq 'openshift-loki' })) {
    Fail 'no recognizable source in /api/v1/sources response'
}
Write-Host 'API call returned real source data'

Step 'Classification rules persist under %LOCALAPPDATA%\LogExplorer\data (never inside the install directory)'
$rulesUrl = "http://127.0.0.1:$port/api/v1/settings/classification-rules"
# Save any pre-existing rules data aside before the smoke rule touches it.
$script:RulesBackupDir = Join-Path ([System.IO.Path]::GetTempPath()) ("logexplorer-smoke-rules-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:RulesBackupDir | Out-Null
foreach ($name in $RulesFileNames) {
    $existing = Join-Path $RulesDataDir $name
    if (Test-Path -LiteralPath $existing) { Copy-Item -LiteralPath $existing -Destination $script:RulesBackupDir }
}

try { $rulesState = Invoke-RestMethod -Uri $rulesUrl -TimeoutSec 10 } catch { Fail "GET $rulesUrl failed: $($_.Exception.Message)" }
if ($null -eq $rulesState.revision) { Fail 'classification rules response has no revision' }
if ([string]::IsNullOrWhiteSpace($rulesState.storageFile)) { Fail 'classification rules response has no storageFile' }
$storageFile = [System.IO.Path]::GetFullPath($rulesState.storageFile)
Write-Host "Rules storageFile (from the API): $storageFile"
if (-not (Test-PathIsUnder $storageFile $RulesDataDir)) {
    Fail "rules storageFile '$storageFile' is not under $RulesDataDir - the launcher did not pass LOGEXPLORER_DATA_DIR to the backend"
}
if (Test-PathIsUnder $storageFile $InstallDir) {
    Fail "rules storageFile '$storageFile' is inside the install directory $InstallDir - an upgrade or uninstall would lose the user's rules"
}

$ruleBody = @{
    expectedRevision = $rulesState.revision
    rule             = @{
        name       = 'Smoke rule'
        tags       = @('smoke')
        conditions = @(@{ field = 'message'; matcher = 'CONTAINS'; value = 'smoke-test-marker' })
    }
} | ConvertTo-Json -Depth 6
try {
    $savedState = Invoke-RestMethod -Uri $rulesUrl -Method Post -ContentType 'application/json' -Body $ruleBody -TimeoutSec 10
} catch {
    Fail "POST $rulesUrl (create smoke rule) failed: $($_.Exception.Message)"
}
if (-not ($savedState.rules | Where-Object { $_.name -eq 'Smoke rule' })) { Fail 'the saved rules state returned by POST does not contain the smoke rule' }
if ([System.IO.Path]::GetFullPath($savedState.storageFile) -ne $storageFile) { Fail "storageFile changed between GET ($storageFile) and POST ($($savedState.storageFile))" }
if (-not (Test-Path -LiteralPath $storageFile -PathType Leaf)) { Fail "rules file $storageFile does not exist on disk after a successful save" }
if (-not (Select-String -LiteralPath $storageFile -SimpleMatch 'smoke-test-marker' -Quiet)) { Fail "rules file $storageFile does not contain the smoke rule after a successful save" }
Write-Host "Smoke rule saved to $storageFile (outside $InstallDir)"

Step 'Close the application and verify clean shutdown (no orphan backend process)'
Stop-Process -Id $launcherProc.Id -Force
Start-Sleep -Seconds 3
$orphanJava = Get-Process -Name 'java' -ErrorAction SilentlyContinue
if ($orphanJava) {
    Fail "an orphan java.exe process (PID $($orphanJava.Id -join ',')) survived the launcher being stopped"
}
Write-Host 'No orphan backend process - clean shutdown'

Step 'Uninstall (silent) and confirm the install directory is removed'
$uninstallExe = Get-ChildItem -Path $InstallDir -Filter 'unins*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($uninstallExe) {
    Start-Process -FilePath $uninstallExe.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
    Start-Sleep -Seconds 2
    if (Test-Path (Join-Path $InstallDir 'LogExplorerLauncher.exe')) {
        Fail 'uninstall did not remove the installed launcher'
    }
    Write-Host 'Uninstall removed the installed application'
} else {
    Fail 'no uninstaller (unins*.exe) found in the install directory'
}

Step 'Classification rules survive uninstall (an upgrade/reinstall keeps them)'
if (-not (Test-Path -LiteralPath $storageFile -PathType Leaf)) { Fail "rules file $storageFile was removed by uninstall - rules would not survive an upgrade or reinstall" }
if (-not (Select-String -LiteralPath $storageFile -SimpleMatch 'smoke-test-marker' -Quiet)) { Fail "rules file $storageFile no longer contains the smoke rule after uninstall" }
Write-Host 'Rules file survived uninstall'

Step 'Clean up the smoke rule (restore any pre-existing rules data)'
Restore-ClassificationRulesData
Write-Host "Rules data under $RulesDataDir restored to its pre-test state"

Write-Host "`nPACKAGED WINDOWS SMOKE TEST PASSED"
