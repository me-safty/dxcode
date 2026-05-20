param(
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$SkipGitUpdate,
  [switch]$AllowDirty,
  [switch]$SkipInstall,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot "logs"
$UpdaterScript = Join-Path $PSScriptRoot "update-t3code-server.ps1"

if (-not (Test-Path -LiteralPath $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$updateLog = Join-Path $LogDir "t3code-production-update-$timestamp.log"
$updateErr = Join-Path $LogDir "t3code-production-update-$timestamp.err.log"

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $UpdaterScript,
  "-Remote",
  $Remote,
  "-Branch",
  $Branch,
  "-DetachedRestart"
)

if ($SkipGitUpdate) {
  $arguments += "-SkipGitUpdate"
}
if ($AllowDirty) {
  $arguments += "-AllowDirty"
}
if ($SkipInstall) {
  $arguments += "-SkipInstall"
}
if ($SkipHealthCheck) {
  $arguments += "-SkipHealthCheck"
}

Start-Process -FilePath "powershell.exe" `
  -ArgumentList $arguments `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $updateLog `
  -RedirectStandardError $updateErr

Write-Host "Queued detached T3 Code production rebuild."
Write-Host "Update log: $updateLog"
Write-Host "Update error log: $updateErr"
Write-Host "Restart helper logs:"
Write-Host "  $(Join-Path $LogDir "t3code-server-detached-restart.log")"
Write-Host "  $(Join-Path $LogDir "t3code-server-detached-restart.err.log")"
Write-Host ""
Write-Host "This command intentionally returns before the server restarts."
