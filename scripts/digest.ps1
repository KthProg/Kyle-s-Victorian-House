# Writes two Markdown files:
#   updates.md  posts from links.htm published in the last 2 days
#   events.md   events from detroit-events.htm in the next 2 weeks
#
# Usage: .\scripts\digest.ps1 [output-dir]   (default: digest\)

param([string]$OutputDir = "")

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $Root "digest" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$tmpUpdates = [IO.Path]::GetTempFileName()
$tmpEvents  = [IO.Path]::GetTempFileName()

try {
    Write-Host "Fetching updates and events..."

    $scriptUpdates = Join-Path $Root "scripts\list-updates.mjs"
    $scriptEvents  = Join-Path $Root "scripts\list-events.mjs"

    $pUpdates = Start-Process -FilePath "node" `
        -ArgumentList "`"$scriptUpdates`"", "--days", "2", "--limit", "50" `
        -RedirectStandardOutput $tmpUpdates -NoNewWindow -PassThru

    $pEvents = Start-Process -FilePath "node" `
        -ArgumentList "`"$scriptEvents`"", "--days", "14", "--limit", "50" `
        -RedirectStandardOutput $tmpEvents -NoNewWindow -PassThru

    $pUpdates.WaitForExit()
    $pEvents.WaitForExit()

    $status = 0
    if ($pUpdates.ExitCode -ne 0) { [Console]::Error.WriteLine("list-updates.mjs failed"); $status = 1 }
    if ($pEvents.ExitCode  -ne 0) { [Console]::Error.WriteLine("list-events.mjs failed");  $status = 1 }
    if ($status -ne 0) { exit $status }

    $outUpdates = Join-Path $OutputDir "updates.md"
    $outEvents  = Join-Path $OutputDir "events.md"
    Move-Item -Path $tmpUpdates -Destination $outUpdates -Force
    Move-Item -Path $tmpEvents  -Destination $outEvents  -Force

    Write-Host "Wrote $outUpdates"
    Write-Host "Wrote $outEvents"
} finally {
    if (Test-Path $tmpUpdates) { Remove-Item $tmpUpdates -ErrorAction SilentlyContinue }
    if (Test-Path $tmpEvents)  { Remove-Item $tmpEvents  -ErrorAction SilentlyContinue }
}
