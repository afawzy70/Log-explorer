#!/usr/bin/env pwsh
#
# Legacy Remediation Slice 9 §H: builds a custom, minimal Java runtime
# (jlink) bundled into the Windows installer, so end users need no
# separately-installed Java. Module list is *detected* from the real
# backend jar via `jdeps`, not hand-guessed - a hardcoded module list
# would silently rot the moment a new dependency needs a module this
# script's author didn't think of.
#
# `jdeps` is run against the *extracted* jar (BOOT-INF/classes as the
# target, BOOT-INF/lib/*.jar on its classpath), not the repackaged fat
# jar directly - found the hard way, via two real failed packaged-Windows-
# smoke-test runs in this exact CI job: `jdeps --print-module-deps`
# against a Spring Boot repackaged jar only sees the outer jar's own
# direct bytecode references, never traversing into the nested
# BOOT-INF/lib/*.jar dependency jars it doesn't unpack automatically - so
# it silently under-reported the module set (missing `java.desktop`, then
# separately `java.logging`, each only discovered by an actual
# NoClassDefFoundError at real startup). Extracting first gives jdeps a
# normal flat classpath it can actually analyze in full.
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

$ExtractDir = Join-Path ([System.IO.Path]::GetTempPath()) ("logexplorer-jar-extract-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
Write-Host "Extracting $ResolvedJar for full-visibility jdeps analysis..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($ResolvedJar, $ExtractDir)

$classesDir = Join-Path $ExtractDir 'BOOT-INF\classes'
$libDir = Join-Path $ExtractDir 'BOOT-INF\lib'
if (-not (Test-Path $classesDir)) {
    throw "Expected $classesDir after extraction - is this a normal Spring Boot repackaged jar?"
}
if (-not (Test-Path $libDir)) {
    throw "Expected $libDir after extraction - is this a normal Spring Boot repackaged jar?"
}

Write-Host "Detecting required modules via jdeps (classes + full nested-lib classpath)..."
$depsOutput = & jdeps --multi-release 21 --ignore-missing-deps --print-module-deps `
    --class-path "$libDir\*" `
    $classesDir 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "jdeps failed:`n$depsOutput"
}
# jdeps prints a single comma-separated line of module names as its last
# non-empty line - any earlier lines are diagnostic noise.
$moduleLine = ($depsOutput | Where-Object { $_ -match '^[a-zA-Z0-9_.]+(,[a-zA-Z0-9_.]+)*$' } | Select-Object -Last 1)
if (-not $moduleLine) {
    throw "Could not parse a module list from jdeps output:`n$depsOutput"
}

# jdk.crypto.ec is the one addition kept on top of full jdeps detection -
# it is genuinely never a static bytecode reference (loaded reflectively
# by the JSSE provider machinery for TLS cipher-suite negotiation with a
# real OpenShift/Loki gateway), so no amount of classpath visibility
# makes jdeps see it - jlink's own documentation names this exact module
# for exactly this reason.
$modules = "$moduleLine,jdk.crypto.ec"
Write-Host "Detected modules: $modules"

Remove-Item -Recurse -Force $ExtractDir

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
