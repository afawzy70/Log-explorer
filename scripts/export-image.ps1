#!/usr/bin/env pwsh
#
# Windows PowerShell equivalent of scripts/export-image.sh - see that
# script's own header for the full rationale (Legacy Remediation Slice 9
# §O, capability matrix PKG-03).
#
# Usage: .\scripts\export-image.ps1 [-OutputFile out.tar.gz] [-ImageTag log-explorer:local]

param(
    [string]$OutputFile = 'log-explorer.tar.gz',
    [string]$ImageTag = 'log-explorer:local'
)

$ErrorActionPreference = 'Stop'

docker image inspect $ImageTag *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Image '$ImageTag' not found locally - build it first, e.g.:`n  docker compose build"
    exit 1
}

Write-Host "Saving $ImageTag -> $OutputFile ..."
docker save $ImageTag -o "$OutputFile.tmp.tar"
if ($LASTEXITCODE -ne 0) { Write-Error 'docker save failed'; exit 1 }

# `docker save` has no built-in gzip option on Windows - compress the
# intermediate tar with .NET's own GZipStream so no extra tool (gzip.exe)
# is required.
$inStream = [System.IO.File]::OpenRead("$OutputFile.tmp.tar")
$outStream = [System.IO.File]::Create($OutputFile)
$gzipStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionMode]::Compress)
try {
    $inStream.CopyTo($gzipStream)
} finally {
    $gzipStream.Dispose()
    $outStream.Dispose()
    $inStream.Dispose()
}
Remove-Item "$OutputFile.tmp.tar"

$sizeMb = [math]::Round((Get-Item $OutputFile).Length / 1MB, 1)
Write-Host "Wrote $OutputFile ($sizeMb MB)"
Write-Host "On the target machine: .\scripts\import-image.ps1 $OutputFile"
