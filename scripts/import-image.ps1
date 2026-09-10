#!/usr/bin/env pwsh
#
# Windows PowerShell equivalent of scripts/import-image.sh - see that
# script's own header for the full rationale (Legacy Remediation Slice 9
# §O, capability matrix PKG-03).
#
# Usage: .\scripts\import-image.ps1 <tarball produced by export-image.ps1/.sh>

param(
    [Parameter(Mandatory = $true)][string]$Tarball
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Tarball)) {
    Write-Error "File not found: $Tarball"
    exit 1
}

$tempTar = [System.IO.Path]::GetTempFileName()
Write-Host "Decompressing $Tarball ..."
$inStream = [System.IO.File]::OpenRead($Tarball)
$gzipStream = New-Object System.IO.Compression.GZipStream($inStream, [System.IO.Compression.CompressionMode]::Decompress)
$outStream = [System.IO.File]::Create($tempTar)
try {
    $gzipStream.CopyTo($outStream)
} finally {
    $outStream.Dispose()
    $gzipStream.Dispose()
    $inStream.Dispose()
}

Write-Host "Loading into Docker ..."
try {
    docker load -i $tempTar
    if ($LASTEXITCODE -ne 0) { Write-Error 'docker load failed'; exit 1 }
} finally {
    Remove-Item $tempTar -ErrorAction SilentlyContinue
}

Write-Host "Done. Run with: docker compose --profile demo up (see docs/RUN_GUIDE.md for the full Quick Start)."
