#!/usr/bin/env pwsh
#
# MISSION=PR61_NATIVE_POWERSHELL_JAR_BUILD_WITH_PROXY - native Windows PowerShell equivalent of
# scripts/build-jar.sh, so a Windows developer can build the standalone jar with no Git Bash, WSL,
# Docker, or Unix shell. Reproduces build-jar.sh's own behavior exactly (see that file's own header for
# why the pattern looks the way it does - frontend dist -> Spring Boot static resources -> mvnw package,
# reused from Dockerfile/build-desktop-windows.ps1/build-desktop-macos.sh, without touching any of them
# or backend/pom.xml's build config), plus optional, per-execution proxy configuration for npm and Maven.
#
# Usage:
#   .\scripts\build-jar.ps1
#   .\scripts\build-jar.ps1 -ProxyUrl "http://proxy.company.local:8080"
#   .\scripts\build-jar.ps1 -ProxyUrl "http://proxy.company.local:8080" -NoProxy "localhost,127.0.0.1,.company.local"
#   .\scripts\build-jar.ps1 -OutputDir "C:\somewhere\else"   # defaults to <repo root>\dist-jar
#
# Proxy values are process-scoped to this script's own execution only: they are set on this process's
# environment (inherited by the npm/mvnw child processes this script starts), never written to any
# global npm/Maven/Windows configuration, and always restored to their original value (or removed, if
# they were not originally set) in a `finally` block before the script exits - success or failure. If
# -ProxyUrl is not supplied, any proxy environment the caller already has configured is left untouched.
#
# Exit code 0 = the jar was built and copied to <output-dir>. On success, the jar's full path is written
# to the success output stream as the very last output, for easy capture by a caller
# (e.g. $jar = .\scripts\build-jar.ps1); every progress message uses Write-Host instead, so it never
# pollutes that captured value.

param(
    [string]$ProxyUrl,
    [string]$NoProxy,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Step($name) { Write-Host "`n== $name ==" -ForegroundColor Cyan }
function Fail($message) { throw $message }

# Never echoes proxy credentials (a userinfo section, http://user:pass@host:port) - only scheme/host/port.
function Get-MaskedProxyUrl([string]$Url) {
    $parsed = $null
    if ([Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsed)) {
        return "$($parsed.Scheme)://$($parsed.Host):$($parsed.Port)"
    }
    return '(unparseable)'
}

if (-not $OutputDir) { $OutputDir = Join-Path $RepoRoot 'dist-jar' }
$StaticDir = Join-Path $RepoRoot 'backend\src\main\resources\static'

# ---------------------------------------------------------------------------
# Proxy setup - validated and applied BEFORE any build work starts, entirely
# via this process's own environment (never a persistent npm/Maven/system
# config change). Every touched variable's original value is captured here
# so the `finally` block below can put it back exactly, whatever happens.
# ---------------------------------------------------------------------------
$ProxyEnvVarNames = @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'MAVEN_OPTS')
# A plain @{} hashtable does case-INSENSITIVE key lookup by default, which would silently collide
# 'HTTP_PROXY' and 'http_proxy' into the same stored entry (harmless on Windows, where they really are
# the same variable, but wrong in principle and a real bug on any case-sensitive platform) - an explicit
# ordinal (case-sensitive) Dictionary keeps every tracked name genuinely distinct, on any platform.
$OriginalProxyEnv = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::Ordinal)
foreach ($varName in $ProxyEnvVarNames) {
    $OriginalProxyEnv[$varName] = [Environment]::GetEnvironmentVariable($varName, 'Process')
}

if ($ProxyUrl) {
    $parsedProxy = $null
    if (-not [Uri]::TryCreate($ProxyUrl, [UriKind]::Absolute, [ref]$parsedProxy) `
            -or ($parsedProxy.Scheme -ne 'http' -and $parsedProxy.Scheme -ne 'https')) {
        Write-Host "BUILD FAILED: invalid -ProxyUrl '$ProxyUrl' - must be an absolute http:// or https:// URL, e.g. http://proxy.company.local:8080" -ForegroundColor Red
        exit 1
    }
    Write-Host "Using proxy for this build only: $(Get-MaskedProxyUrl $ProxyUrl)"

    $env:HTTP_PROXY = $ProxyUrl
    $env:HTTPS_PROXY = $ProxyUrl
    $env:http_proxy = $ProxyUrl
    $env:https_proxy = $ProxyUrl

    # Java's `http(s).nonProxyHosts` uses '|'-separated patterns with a leading '*' for a domain suffix
    # (e.g. "*.company.local"), not the comma-separated, leading-dot convention NO_PROXY/npm use - both
    # forms are set below so npm and Maven each see the syntax they actually understand.
    $nonProxyHostsForJava = $null
    if ($NoProxy) {
        $env:NO_PROXY = $NoProxy
        $env:no_proxy = $NoProxy
        $entries = $NoProxy -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $nonProxyHostsForJava = ($entries | ForEach-Object { if ($_.StartsWith('.')) { "*$_" } else { $_ } }) -join '|'
    }

    $mavenProxyOpts = "-Dhttp.proxyHost=$($parsedProxy.Host) -Dhttp.proxyPort=$($parsedProxy.Port) -Dhttps.proxyHost=$($parsedProxy.Host) -Dhttps.proxyPort=$($parsedProxy.Port)"
    if ($nonProxyHostsForJava) {
        $mavenProxyOpts += " -Dhttp.nonProxyHosts=`"$nonProxyHostsForJava`""
    }
    $env:MAVEN_OPTS = if ($OriginalProxyEnv['MAVEN_OPTS']) { "$($OriginalProxyEnv['MAVEN_OPTS']) $mavenProxyOpts" } else { $mavenProxyOpts }
} elseif ($NoProxy) {
    Write-Host 'Note: -NoProxy was given without -ProxyUrl - ignored (nothing to exempt from).'
} else {
    Write-Host 'No -ProxyUrl supplied - using whatever proxy environment is already configured (if any), unchanged.'
}

$exitCode = 0
try {
    Step '[1/3] Building the frontend production bundle'
    Push-Location (Join-Path $RepoRoot 'frontend')
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed' }
        npm run build
        if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed' }
    } finally {
        Pop-Location
    }

    Step '[2/3] Embedding the frontend into Spring Boot''s static resources (fresh copy - no stale assets survive)'
    if (Test-Path $StaticDir) { Remove-Item -Recurse -Force $StaticDir }
    New-Item -ItemType Directory -Force -Path $StaticDir | Out-Null
    Copy-Item -Recurse -Force (Join-Path $RepoRoot 'frontend\dist\*') $StaticDir

    Step '[3/3] Building the backend fat jar (clean build)'
    Push-Location (Join-Path $RepoRoot 'backend')
    try {
        .\mvnw.cmd --batch-mode clean package -DskipTests
        if ($LASTEXITCODE -ne 0) { Fail 'backend package build failed' }
    } finally {
        Pop-Location
    }

    # spring-boot-maven-plugin repackages the plain jar into an executable one at the default finalName
    # (log-explorer-backend-<version>.jar) and renames the original, non-runnable plain jar alongside it
    # to *.jar.original - excluded here so this script only ever hands back the runnable one.
    $jar = Get-ChildItem (Join-Path $RepoRoot 'backend\target') -Filter 'log-explorer-backend-*.jar' |
        Where-Object { $_.Name -notlike '*.original' } | Select-Object -First 1
    if (-not $jar) {
        Fail 'no runnable jar found under backend\target (expected log-explorer-backend-<version>.jar)'
    }

    $version = $jar.BaseName -replace '^log-explorer-backend-', ''
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $dest = Join-Path $OutputDir "log-explorer-$version.jar"
    Copy-Item -Force $jar.FullName $dest

    Write-Host "`n== Runnable jar ready: $dest ==" -ForegroundColor Green
    Write-Output $dest
}
catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
finally {
    # Cleanup and proxy-environment restoration ALWAYS run here, success or failure - never leaves a
    # stray static/ copy in the source tree, and never leaks this build's proxy configuration into the
    # caller's own shell session afterward.
    if (Test-Path $StaticDir) { Remove-Item -Recurse -Force $StaticDir -ErrorAction SilentlyContinue }
    foreach ($varName in $ProxyEnvVarNames) {
        if ($null -ne $OriginalProxyEnv[$varName]) {
            [Environment]::SetEnvironmentVariable($varName, $OriginalProxyEnv[$varName], 'Process')
        } else {
            [Environment]::SetEnvironmentVariable($varName, $null, 'Process')
        }
    }
}
exit $exitCode
