#!/usr/bin/env pwsh
#
# Legacy Remediation Slice 9 §H: builds a custom, minimal Java runtime
# (jlink) bundled into the Windows installer, so end users need no
# separately-installed Java. Module list is *detected* from the real
# backend jar via `jdeps`, not hand-guessed - a hardcoded module list
# would silently rot the moment a new dependency needs a module this
# script's author didn't think of.
#
# Usage (PowerShell, Windows - this script only ever runs there, since
# jlink's own output is platform-specific and the installer only targets
# Windows):
#   .\desktop\packaging\build-runtime.ps1 -JarPath backend\target\log-explorer-backend-*.jar -OutputDir desktop\build\runtime

param(
    [Parameter(Mandatory = $true)][string]$JarPath,
    [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $JarPath)) {
    throw "Backend jar not found at '$JarPath' - build it first (mvnw package)."
}
$ResolvedJar = (Resolve-Path $JarPath).Path

if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}

Write-Host "Detecting required modules from $ResolvedJar via jdeps..."
$depsOutput = & jdeps --multi-release 21 --ignore-missing-deps --print-module-deps $ResolvedJar 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "jdeps failed:`n$depsOutput"
}
# jdeps prints a single comma-separated line of module names as its last
# non-empty line - any earlier lines are diagnostic noise (e.g. a JAR
# with no module-info still gets scanned fine, but jdeps may print an
# informational warning first).
$moduleLine = ($depsOutput | Where-Object { $_ -match '^[a-zA-Z0-9_.]+(,[a-zA-Z0-9_.]+)*$' } | Select-Object -Last 1)
if (-not $moduleLine) {
    throw "Could not parse a module list from jdeps output:`n$depsOutput"
}

# Two modules added explicitly, on top of whatever jdeps detected -
# both are real, evidence-based additions (the first real packaged
# Windows smoke test failed without java.desktop, with the exact
# NoClassDefFoundError this comment names), not a guess:
#
#  - jdk.crypto.ec: the TLS cipher suites modern servers (including a
#    real OpenShift/Loki gateway) commonly negotiate, loaded reflectively
#    by the JSSE provider machinery rather than referenced directly -
#    jlink's own documentation names this exact module for exactly this
#    reason.
#  - java.desktop: Spring Boot's own property-binding conversion service
#    (`BindConverter`/`PropertyEditorSupport`) needs `java.beans.*`, which
#    jdeps' static bytecode analysis of a *repackaged* Spring Boot fat jar
#    (BOOT-INF/classes + BOOT-INF/lib/*.jar, not a normal flat classpath)
#    does not reliably trace through - confirmed by a real
#    `NoClassDefFoundError: java/beans/PropertyEditorSupport` startup
#    crash in this exact CI job before this module was added.
$modules = "$moduleLine,jdk.crypto.ec,java.desktop"
Write-Host "Detected modules: $modules"

Write-Host "Running jlink..."
& jlink `
    --add-modules $modules `
    --output $OutputDir `
    --strip-debug `
    --no-header-files `
    --no-man-pages `
    --compress=2
if ($LASTEXITCODE -ne 0) {
    throw "jlink failed"
}

$javaExe = Join-Path $OutputDir 'bin\java.exe'
if (-not (Test-Path $javaExe)) {
    throw "jlink completed but $javaExe was not produced"
}

Write-Host "Custom runtime built at $OutputDir"
$size = (Get-ChildItem -Recurse $OutputDir | Measure-Object -Property Length -Sum).Sum
Write-Host ("Runtime size: {0:N1} MB" -f ($size / 1MB))
