param(
  [string]$Remote = "pingdotgg",
  [string]$Branch = "main",
  [switch]$SkipGitUpdate,
  [switch]$AllowDirty,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipRestart,
  [switch]$SkipHealthCheck,
  [switch]$DetachedRestart,
  [int]$DetachedRestartDelaySeconds = 5,
  [switch]$RestartOnly
)

$ErrorActionPreference = "Stop"

$ServiceName = "t3code-server"
$ScheduledTaskName = "t3code-server"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot "logs"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found on PATH."
  }
}

function Assert-AdminIfNeeded {
  if ($SkipRestart -or $DetachedRestart) {
    return
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    throw "Restarting $ServiceName requires an elevated PowerShell. Rerun as Administrator or pass -SkipRestart."
  }
}

function Get-T3CodeServerProcess {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*apps\server\dist\bin.mjs*" }
}

function Stop-T3CodeServerProcessTree {
  $serverProcesses = @(Get-T3CodeServerProcess)
  foreach ($process in $serverProcesses) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)" -ErrorAction SilentlyContinue
    if ($parent -and $parent.CommandLine -like "*start-t3code-server.cmd*") {
      Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForT3CodeServer {
  param([int]$TimeoutSeconds = 30)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3773 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "T3 Code server did not start listening on 127.0.0.1:3773 within $TimeoutSeconds seconds."
}

function Get-HttpStatus {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 10
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSeconds
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw "Failed to reach $Url`: $($_.Exception.Message)"
  }
}

function Assert-HttpStatus {
  param(
    [string]$Name,
    [string]$Url,
    [int[]]$ExpectedStatuses = @(200)
  )

  $status = Get-HttpStatus -Url $Url
  if ($ExpectedStatuses -notcontains $status) {
    throw "$Name failed: $Url returned HTTP $status."
  }
  Write-Host "$Name ok: $Url -> HTTP $status"
}

function Assert-T3CodeReachable {
  Assert-HttpStatus -Name "Local T3" -Url "http://127.0.0.1:3773/"
  Assert-HttpStatus -Name "Cloudflare T3" -Url "https://t3.olumbe.com/"
}

function Restart-T3CodeServer {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $task = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
  $runningProcesses = @(Get-T3CodeServerProcess)

  if ($service -and $service.Status -eq "Running") {
    Write-Host "Restarting Windows service $ServiceName"
    Restart-Service -Name $ServiceName -Force
    Wait-ForT3CodeServer
    Assert-T3CodeReachable
    return
  }

  if ($task) {
    Write-Host "Restarting scheduled-task/manual server path $ScheduledTaskName"
    Stop-T3CodeServerProcessTree
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $ScheduledTaskName
    Wait-ForT3CodeServer
    Assert-T3CodeReachable
    return
  }

  if ($service) {
    Write-Host "Starting stopped Windows service $ServiceName"
    Start-Service -Name $ServiceName
    Wait-ForT3CodeServer
    Assert-T3CodeReachable
    return
  }

  if ($runningProcesses.Count -gt 0) {
    throw "Found a running T3 Code server process, but no $ServiceName service or $ScheduledTaskName scheduled task to restart it."
  }

  throw "$ServiceName service and $ScheduledTaskName scheduled task are not installed."
}

function Invoke-Logged {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  Write-Host "> $FilePath $($Arguments -join ' ')"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE"
  }
}

Set-Location -LiteralPath $RepoRoot

if ($RestartOnly) {
  if ($DetachedRestartDelaySeconds -gt 0) {
    Write-Step "Waiting $DetachedRestartDelaySeconds seconds before detached restart"
    Start-Sleep -Seconds $DetachedRestartDelaySeconds
  }

  Write-Step "Restarting $ServiceName"
  Restart-T3CodeServer

  if (-not $SkipHealthCheck) {
    Write-Step "Running orchestrator health check"
    Invoke-Logged bun @("run", "health:orchestrator")
  }

  Write-Step "Restart complete"
  exit 0
}

Write-Step "Checking prerequisites"
Require-Command git
Require-Command bun
Require-Command curl.exe
Assert-AdminIfNeeded

Write-Host "Repo root: $RepoRoot"
Write-Host "Target upstream: $Remote/$Branch"

if (-not $SkipGitUpdate) {
  Write-Step "Checking git worktree"
  $status = git status --porcelain
  if ($status -and -not $AllowDirty) {
    Write-Host $status
    throw "Worktree is dirty. Commit/stash changes first, or rerun with -AllowDirty if you know the local changes are intentional."
  }

  git remote get-url $Remote | Out-Null

  Write-Step "Fetching upstream"
  Invoke-Logged git @("fetch", $Remote, $Branch)

  Write-Step "Merging upstream"
  Invoke-Logged git @("merge", "$Remote/$Branch")
} else {
  Write-Step "Skipping git update"
}

if (-not $SkipInstall) {
  Write-Step "Installing dependencies"
  Invoke-Logged bun @("install")
}

if (-not $SkipBuild) {
  Write-Step "Building server and web assets"
  Invoke-Logged bun @("run", "build")
}

if (-not $SkipRestart) {
  if ($DetachedRestart) {
    Write-Step "Queueing detached $ServiceName restart"
    if (-not (Test-Path -LiteralPath $LogDir)) {
      New-Item -ItemType Directory -Path $LogDir | Out-Null
    }

    $restartLog = Join-Path $LogDir "t3code-server-detached-restart.log"
    $restartErr = Join-Path $LogDir "t3code-server-detached-restart.err.log"
    $arguments = @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $PSCommandPath,
      "-RestartOnly",
      "-SkipGitUpdate",
      "-SkipInstall",
      "-SkipBuild",
      "-DetachedRestartDelaySeconds",
      $DetachedRestartDelaySeconds.ToString()
    )
    if ($SkipHealthCheck) {
      $arguments += "-SkipHealthCheck"
    }

    Start-Process -FilePath "powershell.exe" `
      -ArgumentList $arguments `
      -WindowStyle Hidden `
      -RedirectStandardOutput $restartLog `
      -RedirectStandardError $restartErr

    Write-Host "Detached restart queued. Logs:"
    Write-Host "  $restartLog"
    Write-Host "  $restartErr"
  } else {
    Write-Step "Restarting $ServiceName"
    Restart-T3CodeServer
  }
}

if (-not $SkipHealthCheck -and -not $DetachedRestart) {
  Write-Step "Running orchestrator health check"
  Invoke-Logged bun @("run", "health:orchestrator")
}

Write-Step "Update complete"
git log -1 --oneline
