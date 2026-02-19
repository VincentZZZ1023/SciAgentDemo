[CmdletBinding()]
param(
  [switch]$InstallDeps,
  [switch]$OpenBrowser,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Please install it and retry."
  }
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
Set-Location -Path '$BackendDir'
if (Test-Path '.venv\\Scripts\\python.exe') {
  & '.venv\\Scripts\\python.exe' -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
} else {
  python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
}
"@

$frontendCommand = @"
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

$backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-Command", $backendCommand) -PassThru
Start-Sleep -Milliseconds 500
$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-Command", $frontendCommand) -PassThru

Write-Host "[dev-up] Backend PID: $($backendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Frontend PID: $($frontendProc.Id)" -ForegroundColor Green
Write-Host "[dev-up] Backend URL:  http://localhost:8000" -ForegroundColor Green
Write-Host "[dev-up] Frontend URL: http://localhost:5173" -ForegroundColor Green

if ($OpenBrowser) {
  Start-Process "http://localhost:5173"
}
