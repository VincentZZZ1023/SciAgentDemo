[CmdletBinding()]
param(
  [switch]$InstallDeps,
  [switch]$OpenBrowser,
  [switch]$DryRun,
  [switch]$Stop,
  [switch]$Restart,
  [switch]$ForceCleanPorts,
  [int]$ReadyTimeoutSec = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$StateDir = Join-Path $RepoRoot ".dev"
$PidFile = Join-Path $StateDir "dev-up.pids.json"
$BackendPort = 8000
$FrontendPort = 5173

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Please install it and retry."
  }
}

function Is-ProcessAlive {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return $false
  }

  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  return $null -ne $proc
}

function Load-Pids {
  if (-not (Test-Path $PidFile)) {
    return $null
  }

  try {
    return Get-Content $PidFile -Raw | ConvertFrom-Json
  }
  catch {
    Write-Warning "PID file is invalid and will be removed: $PidFile"
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Remove-PidFile {
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Save-Pids {
  param(
    [int]$BackendPid,
    [int]$FrontendPid
  )

  if (-not (Test-Path $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  }

  @{
    backendPid = $BackendPid
    frontendPid = $FrontendPid
    backendPort = $BackendPort
    frontendPort = $FrontendPort
    updatedAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
}

function Stop-ProcessSafe {
  param(
    [int]$ProcessId,
    [string]$Label
  )

  if ($ProcessId -le 0) {
    return
  }

  if (-not (Is-ProcessAlive -ProcessId $ProcessId)) {
    Write-Host "[dev-up] $Label process not running (PID $ProcessId)." -ForegroundColor DarkYellow
    return
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host "[dev-up] Stopped $Label process PID $ProcessId." -ForegroundColor Yellow
}

function Stop-DevProcesses {
  $pids = Load-Pids
  if ($null -eq $pids) {
    Write-Host "[dev-up] No managed dev processes found." -ForegroundColor DarkYellow
    return
  }

  Stop-ProcessSafe -ProcessId ([int]$pids.backendPid) -Label "backend"
  Stop-ProcessSafe -ProcessId ([int]$pids.frontendPid) -Label "frontend"

  Remove-PidFile
  Write-Host "[dev-up] Cleanup complete." -ForegroundColor Yellow
}

function Get-PortOwnerPids {
  param([int]$Port)

  try {
    $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  }
  catch {
    return @()
  }

  if ($null -eq $connections) {
    return @()
  }

  return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Ensure-PortAvailable {
  param(
    [int]$Port,
    [string]$Label,
    [switch]$Force
  )

  $owners = @(Get-PortOwnerPids -Port $Port)
  if ($owners.Count -eq 0) {
    return
  }

  if (-not $Force) {
    $ownerText = ($owners -join ", ")
    throw "Port $Port ($Label) is in use by PID(s): $ownerText. Use -ForceCleanPorts to kill them."
  }

  foreach ($ownerPid in $owners) {
    Stop-ProcessSafe -ProcessId ([int]$ownerPid) -Label "port-$Port owner"
  }

  Start-Sleep -Milliseconds 300
  $remainingOwners = @(Get-PortOwnerPids -Port $Port)
  if ($remainingOwners.Count -gt 0) {
    $ownerText = ($remainingOwners -join ", ")
    throw "Port $Port is still in use after cleanup. Remaining PID(s): $ownerText"
  }
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [string]$Label,
    [int]$TimeoutSec,
    [int[]]$WatchPids
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)

  while ((Get-Date) -lt $deadline) {
    foreach ($watchProcessId in $WatchPids) {
      if (-not (Is-ProcessAlive -ProcessId $watchProcessId)) {
        Write-Warning "[dev-up] $Label readiness check aborted: process PID $watchProcessId exited."
        return $false
      }
    }

    try {
      $resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -ErrorAction Stop
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    }
    catch {
      # Keep waiting until timeout.
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

if ($Stop) {
  Stop-DevProcesses
  exit 0
}

if ($ReadyTimeoutSec -lt 5) {
  throw "ReadyTimeoutSec must be >= 5."
}

if (-not (Test-Path $BackendDir)) {
  throw "Backend directory not found: $BackendDir"
}

if (-not (Test-Path $FrontendDir)) {
  throw "Frontend directory not found: $FrontendDir"
}

Require-Command -Name "powershell"
Require-Command -Name "python"
Require-Command -Name "npm"

$existing = Load-Pids
if ($null -ne $existing) {
  $backendAlive = Is-ProcessAlive -ProcessId ([int]$existing.backendPid)
  $frontendAlive = Is-ProcessAlive -ProcessId ([int]$existing.frontendPid)

  if ($backendAlive -or $frontendAlive) {
    if (-not $Restart) {
      throw "Managed dev processes already running. Use -Restart or -Stop first."
    }
    Stop-DevProcesses
  }
  else {
    Write-Host "[dev-up] Removing stale PID file: $PidFile" -ForegroundColor DarkYellow
    Remove-PidFile
  }
}
elseif ($Restart) {
  Stop-DevProcesses
}

if ($InstallDeps) {
  Write-Host "[setup] Installing backend dependencies..." -ForegroundColor Cyan
  & python -m pip install -r (Join-Path $BackendDir "requirements.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "Backend dependency install failed."
  }

  Write-Host "[setup] Installing frontend dependencies..." -ForegroundColor Cyan
  Push-Location $FrontendDir
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend dependency install failed."
    }
  }
  finally {
    Pop-Location
  }
}

Ensure-PortAvailable -Port $BackendPort -Label "backend" -Force:$ForceCleanPorts
Ensure-PortAvailable -Port $FrontendPort -Label "frontend" -Force:$ForceCleanPorts

$backendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Backend'
Set-Location -Path '$BackendDir'
if (Test-Path '.venv\Scripts\python.exe') {
  & '.venv\Scripts\python.exe' -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort
} else {
  python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort
}
"@

$frontendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Frontend'
Set-Location -Path '$FrontendDir'
npm run dev -- --host 0.0.0.0 --port $FrontendPort
"@

if ($DryRun) {
  Write-Host "[dry-run] Backend command:" -ForegroundColor Yellow
  Write-Host $backendCommand
  Write-Host "[dry-run] Frontend command:" -ForegroundColor Yellow
  Write-Host $frontendCommand
  Write-Host "[dry-run] Ready timeout: $ReadyTimeoutSec s"
  Write-Host "[dry-run] Script validation complete."
  exit 0
}

$backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -PassThru
Start-Sleep -Milliseconds 500
$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -PassThru

Save-Pids -BackendPid $backendProc.Id -FrontendPid $frontendProc.Id

Write-Host "[dev-up] Backend PID:  $($backendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Frontend PID: $($frontendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Backend URL:  http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "[dev-up] Frontend URL: http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "[dev-up] Stop command: .\dev-up.ps1 -Stop" -ForegroundColor Green

$watchPids = @($backendProc.Id, $frontendProc.Id)
$backendReady = Wait-HttpReady -Url "http://localhost:$BackendPort/api/health" -Label "backend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids
$frontendReady = Wait-HttpReady -Url "http://localhost:$FrontendPort" -Label "frontend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids

if ($backendReady -and $frontendReady) {
  Write-Host "[dev-up] Services are ready." -ForegroundColor Green
}
else {
  Write-Warning "[dev-up] Services did not become ready in $ReadyTimeoutSec seconds. Check the opened terminals."
}

if ($OpenBrowser) {
  Start-Process "http://localhost:$FrontendPort"
}
