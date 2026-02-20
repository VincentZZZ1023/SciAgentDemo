[CmdletBinding()]
param(
  [switch]$InstallDeps,
  [switch]$OpenBrowser,
  [switch]$DryRun,
  [switch]$Stop,
  [switch]$Restart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$StateDir = Join-Path $RepoRoot ".dev"
$PidFile = Join-Path $StateDir "dev-up.pids.json"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Please install it and retry."
  }
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
    updatedAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
}

function Stop-ProcessSafe {
  param(
    [int]$Pid,
    [string]$Label
  )

  if ($Pid -le 0) {
    return
  }

  $proc = Get-Process -Id $Pid -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    Write-Host "[dev-up] $Label process not running (PID $Pid)." -ForegroundColor DarkYellow
    return
  }

  Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue
  Write-Host "[dev-up] Stopped $Label process PID $Pid." -ForegroundColor Yellow
}

function Stop-DevProcesses {
  $pids = Load-Pids
  if ($null -eq $pids) {
    Write-Host "[dev-up] No managed dev processes found." -ForegroundColor DarkYellow
    return
  }

  Stop-ProcessSafe -Pid ([int]$pids.backendPid) -Label "backend"
  Stop-ProcessSafe -Pid ([int]$pids.frontendPid) -Label "frontend"

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[dev-up] Cleanup complete." -ForegroundColor Yellow
}

if ($Stop) {
  Stop-DevProcesses
  exit 0
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

if ($Restart) {
  Stop-DevProcesses
}
elseif (Test-Path $PidFile) {
  $existing = Load-Pids
  if ($null -ne $existing) {
    Write-Host "[dev-up] Existing PID file detected: $PidFile" -ForegroundColor DarkYellow
    Write-Host "[dev-up] Use .\dev-up.ps1 -Restart to restart cleanly, or .\dev-up.ps1 -Stop to stop old processes." -ForegroundColor DarkYellow
  }
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

$backendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Backend'
Set-Location -Path '$BackendDir'
if (Test-Path '.venv\Scripts\python.exe') {
  & '.venv\Scripts\python.exe' -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
} else {
  python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
}
"@

$frontendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Frontend'
Set-Location -Path '$FrontendDir'
npm run dev -- --host 0.0.0.0 --port 5173
"@

if ($DryRun) {
  Write-Host "[dry-run] Backend command:" -ForegroundColor Yellow
  Write-Host $backendCommand
  Write-Host "[dry-run] Frontend command:" -ForegroundColor Yellow
  Write-Host $frontendCommand
  Write-Host "[dry-run] Script validation complete."
  exit 0
}

$backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -PassThru
Start-Sleep -Milliseconds 500
$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -PassThru

Save-Pids -BackendPid $backendProc.Id -FrontendPid $frontendProc.Id

Write-Host "[dev-up] Backend PID:  $($backendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Frontend PID: $($frontendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Backend URL:  http://localhost:8000" -ForegroundColor Green
Write-Host "[dev-up] Frontend URL: http://localhost:5173" -ForegroundColor Green
Write-Host "[dev-up] Stop command: .\dev-up.ps1 -Stop" -ForegroundColor Green

if ($OpenBrowser) {
  Start-Process "http://localhost:5173"
}
