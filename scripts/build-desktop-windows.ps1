#!/usr/bin/env pwsh
#
# REL-1: the single, repository-owned entry point for building the
# Windows desktop package - a developer cloning this repository runs
# EXACTLY this script, and CI (.github/workflows/windows-desktop.yml)
# calls the exact same script rather than duplicating these steps in
# YAML (mission's own "CI should orchestrate only" rule). This is an
# extraction, not a rewrite: every step below is the same logic the
# Windows Desktop CI job already ran (build frontend, embed into
# backend static resources, build the backend jar, jlink a custom
# runtime, publish the launcher, run Inno Setup) - see
# docs/development/BUILD_DESKTOP.md for prerequisites and usage.
#
# Usage (PowerShell, Windows only - this produces a win-x64 artifact and
# depends on Windows-only tooling: WebView2/WinForms, Inno Setup):
#   .\scripts\build-desktop-windows.ps1
#   .\scripts\build-desktop-windows.ps1 -Version 1.2.3
#   .\scripts\build-desktop-windows.ps1 -SkipPreflight        # already verified tooling, skip the checks
#   .\scripts\build-desktop-windows.ps1 -SkipFrontendInstall  # node_modules already installed/current
#
# Output: desktop\build\installer\LogExplorer-<version>-windows-x64.exe

param(
    [string]$Version,
    [switch]$SkipPreflight,
    [switch]$SkipFrontendInstall
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }
function Fail($message) {
    Write-Host "`nBUILD FAILED: $message" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------
# Preflight - fail early, clearly, and actionably. No silent fallback:
# a missing tool here is reported by name, never discovered three steps
# later as an opaque MSB4181/NETSDK/ISCC error.
# ---------------------------------------------------------------------
if (-not $SkipPreflight) {
    Step 'Preflight: required local tooling'

    function RequireCommand($command, $installHint) {
        $found = Get-Command $command -ErrorAction SilentlyContinue
        if (-not $found) {
            Fail "'$command' was not found on PATH. $installHint"
        }
        Write-Host "  OK: $command -> $($found.Source)"
    }

    RequireCommand 'java' 'Install Java 21 (Temurin recommended) and ensure it is on PATH.'
    RequireCommand 'jlink' 'jlink ships with the JDK (not the JRE) - install a full JDK 21, not a JRE-only distribution.'
    RequireCommand 'jdeps' 'jdeps ships with the JDK (not the JRE) - install a full JDK 21, not a JRE-only distribution.'
    RequireCommand 'node' 'Install Node.js (see frontend/package.json engines, or .github/workflows/ci.yml for the exact version CI uses).'
    RequireCommand 'npm' 'npm ships with Node.js - reinstall Node.js if missing.'
    RequireCommand 'dotnet' 'Install the .NET 8 SDK (see global.json at the repository root for the exact pinned version).'

    $javaVersionOutput = & java -version 2>&1 | Out-String
    if ($javaVersionOutput -notmatch '"21\.') {
        Fail "java on PATH is not Java 21 (found: $($javaVersionOutput.Split([Environment]::NewLine)[0])). The backend, jlink runtime, and jdeps module detection all require exactly Java 21."
    }
    Write-Host '  OK: java is version 21'

    Push-Location (Join-Path $RepoRoot 'backend')
    try {
        if (-not (Test-Path '.\mvnw.cmd')) { Fail 'backend\mvnw.cmd not found - is this a clean checkout of the repository?' }
        Write-Host '  OK: Maven wrapper present (backend\mvnw.cmd)'
    } finally {
        Pop-Location
    }

    $dotnetInfo = & dotnet --version 2>&1
    if ($LASTEXITCODE -ne 0 -or $dotnetInfo -notlike '8.0.*') {
        Fail "Effective 'dotnet --version' is '$dotnetInfo', not an 8.0.x SDK. This repository pins .NET 8.0.100 via global.json (rollForward=latestFeature) - install .NET 8 SDK, or check whether a newer SDK is shadowing it."
    }
    Write-Host "  OK: effective dotnet SDK is $dotnetInfo (governed by global.json)"

    $iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    if (-not (Test-Path $iscc)) {
        Fail "Inno Setup 6 (ISCC.exe) not found at '$iscc'. Install it (e.g. 'choco install innosetup' or https://jrsoftware.org/isinfo.php) - this builds the Windows installer."
    }
    Write-Host "  OK: Inno Setup -> $iscc"
} else {
    Write-Host 'Skipping preflight (-SkipPreflight) - assuming tooling was already verified.'
}

# ---------------------------------------------------------------------
# Version resolution - VERSION (repository root) is the single
# authoritative release/application version source (REL-1 §10). A git
# tag on the exact current commit takes precedence (matches this
# project's existing release-tagging convention); otherwise the VERSION
# file's own value is used with a "-dev.<short-sha>" suffix. -Version
# overrides both, for a caller (CI, or a developer) that already knows
# the exact version it wants.
# ---------------------------------------------------------------------
Step 'Resolve version'
if (-not $Version) {
    $tag = git describe --tags --exact-match 2>$null
    if ($LASTEXITCODE -eq 0 -and $tag) {
        $Version = $tag.TrimStart('v')
    } else {
        $baseVersion = (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim()
        $sha = (git rev-parse --short HEAD)
        $Version = "$baseVersion-dev.$sha"
    }
}
Write-Host "Version: $Version"

# ---------------------------------------------------------------------
# Frontend production build, embedded into the backend's static resources
# - this is the SAME single-deployable-jar shape the product always
# ships as (CLAUDE.md §1: "one deployable image"); the desktop package
# is not a different build of the product, it is the same jar plus a
# native launcher shell around it.
# ---------------------------------------------------------------------
Step 'Build frontend production assets'
Push-Location (Join-Path $RepoRoot 'frontend')
try {
    if (-not $SkipFrontendInstall) {
        npm ci
        if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed' }
} finally {
    Pop-Location
}

Step 'Embed frontend build into backend static resources'
$staticDir = Join-Path $RepoRoot 'backend\src\main\resources\static'
New-Item -ItemType Directory -Force -Path $staticDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $RepoRoot 'frontend\dist\*') $staticDir

Step 'Build backend jar (skips tests - run the full backend suite separately; see docs/development/BUILD_DESKTOP.md)'
Push-Location (Join-Path $RepoRoot 'backend')
try {
    .\mvnw.cmd --batch-mode -DskipTests package
    if ($LASTEXITCODE -ne 0) { Fail 'backend package build failed' }
} finally {
    Pop-Location
}

$jar = Get-ChildItem (Join-Path $RepoRoot 'backend\target') -Filter 'log-explorer-backend-*.jar' |
    Where-Object { $_.Name -notlike '*.original' } | Select-Object -First 1
if (-not $jar) { Fail 'backend jar not found in backend\target after packaging' }

Step 'Build custom Java runtime (jlink)'
& (Join-Path $RepoRoot 'desktop\packaging\build-runtime.ps1') -JarPath $jar.FullName -OutputDir (Join-Path $RepoRoot 'desktop\build\runtime')

Step 'Restore NuGet packages (locked mode; bounded retry on transient network/feed failures only - the SAME contract CI uses, never duplicated separately in YAML)'
Push-Location (Join-Path $RepoRoot 'desktop\launcher')
try {
    # Bounded retry (max 2 attempts, i.e. at most 1 retry), only for a
    # small explicit allowlist of transient network/feed failure
    # signatures. Anything else (NU1xxx dependency resolution, an
    # MSB-prefixed build/SDK error, a lock-file mismatch) fails
    # immediately on the first attempt - retrying those would hide a
    # real, deterministic defect behind a flaky-looking extra attempt.
    $transientPatterns = @(
        'Unable to load the service index', 'The SSL connection could not be established',
        'timed out', 'A task was canceled', 'An error occurred while sending the request',
        'No such host is known', 'The operation has timed out', ': 503', ': 502', 'temporarily unavailable'
    )
    $maxAttempts = 2
    $attempt = 0
    $exitCode = 1
    while ($attempt -lt $maxAttempts) {
        $attempt++
        Write-Host "---- dotnet restore attempt $attempt/$maxAttempts ----"
        $output = & dotnet restore LogExplorerLauncher.csproj -r win-x64 --locked-mode --verbosity detailed 2>&1
        $exitCode = $LASTEXITCODE
        $output | ForEach-Object { Write-Host $_ }
        if ($exitCode -eq 0) { break }
        $joined = ($output | Out-String)
        $isTransient = $false
        foreach ($pattern in $transientPatterns) {
            if ($joined -match [regex]::Escape($pattern)) { $isTransient = $true; break }
        }
        if (-not $isTransient -or $attempt -ge $maxAttempts) {
            Fail "dotnet restore --locked-mode failed (attempt $attempt/$maxAttempts, classified-transient=$isTransient). If this is a deliberate dependency change, regenerate desktop\launcher\packages.lock.json explicitly (without --locked-mode), review the diff, and commit it as its own change - never let CI/this script silently re-lock."
        }
        Write-Host "restore failed with a transient-looking network/feed error (attempt $attempt/$maxAttempts) - retrying once after a short delay."
        Start-Sleep -Seconds 5
    }
} finally {
    Pop-Location
}

Step 'Publish the launcher (self-contained, single-file, win-x64, no implicit restore)'
Push-Location (Join-Path $RepoRoot 'desktop\launcher')
try {
    dotnet publish -c Release -r win-x64 --self-contained true `
        --no-restore `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:Version=$Version `
        -o (Join-Path $RepoRoot 'desktop\build\launcher-publish')
    if ($LASTEXITCODE -ne 0) { Fail 'dotnet publish failed' }
} finally {
    Pop-Location
}

Step 'Copy the backend jar into the packaging layout'
$appDir = Join-Path $RepoRoot 'desktop\build\app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item $jar.FullName (Join-Path $appDir 'log-explorer-backend.jar')

Step 'Build the Windows installer (Inno Setup)'
$publishDir = (Resolve-Path (Join-Path $RepoRoot 'desktop\build\launcher-publish')).Path
$runtimeDir = (Resolve-Path (Join-Path $RepoRoot 'desktop\build\runtime')).Path
$appJar = (Resolve-Path (Join-Path $appDir 'log-explorer-backend.jar')).Path
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' `
    /DMyAppVersion=$Version `
    /DPublishDir=$publishDir `
    /DRuntimeDir=$runtimeDir `
    /DAppJar=$appJar `
    (Join-Path $RepoRoot 'desktop\packaging\installer.iss')
if ($LASTEXITCODE -ne 0) { Fail 'ISCC.exe (Inno Setup) failed' }

$installer = Get-ChildItem (Join-Path $RepoRoot 'desktop\build\installer') -Filter '*.exe' | Select-Object -First 1
if (-not $installer) { Fail 'Inno Setup reported success but no .exe was found in desktop\build\installer' }

Step 'SHA-256 checksum'
$hash = (Get-FileHash -Algorithm SHA256 $installer.FullName).Hash.ToLowerInvariant()
$checksumFile = "$($installer.FullName).sha256"
"$hash  $($installer.Name)" | Out-File -Encoding ascii -NoNewline $checksumFile
Write-Host "SHA-256: $hash"
Write-Host "Checksum written to $checksumFile"

Step 'Packaging sizes'
function DirSizeMb($p) { [math]::Round((Get-ChildItem -Recurse $p | Measure-Object -Property Length -Sum).Sum / 1MB, 1) }
$jarSizeMb = [math]::Round((Get-Item (Join-Path $appDir 'log-explorer-backend.jar')).Length / 1MB, 1)
$runtimeSizeMb = DirSizeMb (Join-Path $RepoRoot 'desktop\build\runtime')
$installerSizeMb = [math]::Round($installer.Length / 1MB, 1)
Write-Host "Backend jar (with embedded frontend): $jarSizeMb MB"
Write-Host "Bundled custom JRE (jlink): $runtimeSizeMb MB"
Write-Host "Windows installer ($($installer.Name)): $installerSizeMb MB"

Write-Host "`nBUILD COMPLETE: $($installer.FullName)" -ForegroundColor Green
Write-Host 'Run desktop\packaging\packaged-smoke-test.ps1 -InstallerPath <that path> to verify the real installed app end to end.'
