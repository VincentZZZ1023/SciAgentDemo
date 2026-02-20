[CmdletBinding()]
param(
  [switch]$InstallDeps,
  [switch]$OpenBrowser,
  [switch]$DryRun,
  [switch]$Stop,
  [switch]$Restart,
  [switch]$NoRestart,
  [switch]$ForceCleanPorts,
  [switch]$RequireDeepSeek,
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
$AutoRestart = ($Restart -or (-not $NoRestart)) -and (-not $DryRun)

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Please install it and retry."
  }
}

function Get-EnvValueFromFile {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $pattern = "^\s*$Name\s*=\s*(.*)\s*$"
  foreach ($line in Get-Content -Path $Path) {
    if ($line.TrimStart().StartsWith("#")) {
      continue
    }
    if ($line -match $pattern) {
      $value = $Matches[1].Trim()
      if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
        return $value.Substring(1, $value.Length - 2)
      }
      if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
        return $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }

  return $null
}

function Resolve-DeepSeekApiKey {
  if (-not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    return $env:DEEPSEEK_API_KEY
  }

  $rootEnv = Join-Path $RepoRoot ".env"
  $backendEnv = Join-Path $BackendDir ".env"

  $rootValue = Get-EnvValueFromFile -Path $rootEnv -Name "DEEPSEEK_API_KEY"
  if (-not [string]::IsNullOrWhiteSpace($rootValue)) {
    return $rootValue
  }

  $backendValue = Get-EnvValueFromFile -Path $backendEnv -Name "DEEPSEEK_API_KEY"
  if (-not [string]::IsNullOrWhiteSpace($backendValue)) {
    return $backendValue
  }

  return $null
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
  Start-Sleep -Milliseconds 250

  if (Is-ProcessAlive -ProcessId $ProcessId) {
    try {
      & taskkill /PID $ProcessId /T /F | Out-Null
    }
    catch {
      # Keep going; final liveness check below decides outcome.
    }
    Start-Sleep -Milliseconds 250
  }

  if (Is-ProcessAlive -ProcessId $ProcessId) {
    Write-Warning "[dev-up] Failed to stop $Label process PID $ProcessId."
    return
  }

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

function Test-PortBindable {
  param([int]$Port)

  $listener = $null
  try {
    $ip = [System.Net.IPAddress]::Parse("0.0.0.0")
    $listener = [System.Net.Sockets.TcpListener]::new($ip, $Port)
    $listener.Start()
    return $true
  }
  catch {
    return $false
  }
  finally {
    if ($null -ne $listener) {
      try {
        $listener.Stop()
      }
      catch {
      }
    }
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return ""
  }

  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if ($null -eq $proc -or $null -eq $proc.CommandLine) {
      return ""
    }
    return [string]$proc.CommandLine
  }
  catch {
    return ""
  }
}

function Is-LikelySciAgentPortOwner {
  param(
    [int]$Port,
    [int]$ProcessId
  )

  $cmd = (Get-ProcessCommandLine -ProcessId $ProcessId).ToLowerInvariant()
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  $procName = ""
  if ($null -ne $proc) {
    $procName = [string]$proc.ProcessName
    $procName = $procName.ToLowerInvariant()
  }

  if ([string]::IsNullOrWhiteSpace($cmd)) {
    if ($Port -eq $BackendPort -and $procName -in @("python", "python3", "py", "powershell", "pwsh")) {
      return $true
    }
    if ($Port -eq $FrontendPort -and $procName -in @("node", "npm", "powershell", "pwsh")) {
      return $true
    }
    return $false
  }

  $repoLower = $RepoRoot.ToLowerInvariant()
  if ($cmd.Contains($repoLower)) {
    return $true
  }

  if ($Port -eq $BackendPort) {
    if ($cmd.Contains("uvicorn app.main:app") -and $cmd.Contains("--port 8000")) {
      return $true
    }
  }

  if ($Port -eq $FrontendPort) {
    if (($cmd.Contains("npm run dev") -or $cmd.Contains("vite")) -and $cmd.Contains("--port 5173")) {
      return $true
    }
  }

  return $false
}

function ShouldAutoCleanPortOwners {
  param(
    [int]$Port,
    [int[]]$Owners
  )

  if ($Owners.Count -eq 0) {
    return $false
  }

  foreach ($ownerPid in $Owners) {
    if (-not (Is-LikelySciAgentPortOwner -Port $Port -ProcessId ([int]$ownerPid))) {
      return $false
    }
  }

  return $true
}

function Ensure-PortAvailable {
  param(
    [int]$Port,
    [string]$Label,
    [switch]$Force
  )

  if (Test-PortBindable -Port $Port) {
    return
  }

  $owners = @(Get-PortOwnerPids -Port $Port)
  if ($owners.Count -eq 0) {
    return
  }

  $aliveOwners = @()
  foreach ($ownerPid in $owners) {
    if (Is-ProcessAlive -ProcessId ([int]$ownerPid)) {
      $aliveOwners += [int]$ownerPid
    }
  }

  if ($aliveOwners.Count -eq 0) {
    for ($ghostAttempt = 1; $ghostAttempt -le 8; $ghostAttempt++) {
      Start-Sleep -Milliseconds 300
      $owners = @(Get-PortOwnerPids -Port $Port)
      if ($owners.Count -eq 0) {
        return
      }
      $aliveOwners = @()
      foreach ($ownerPid in $owners) {
        if (Is-ProcessAlive -ProcessId ([int]$ownerPid)) {
          $aliveOwners += [int]$ownerPid
        }
      }
      if ($aliveOwners.Count -gt 0) {
        break
      }
    }
  }

  if ($aliveOwners.Count -eq 0) {
    $ownerText = ($owners -join ", ")
    Write-Warning "[dev-up] Port $Port ($Label) is reported by non-live PID(s): $ownerText. Continue startup and let service bind check decide."
    return
  }

  $autoClean = ShouldAutoCleanPortOwners -Port $Port -Owners $aliveOwners

  if (-not $Force -and -not $autoClean) {
    $ownerText = ($aliveOwners -join ", ")
    throw "Port $Port ($Label) is in use by PID(s): $ownerText. Use -ForceCleanPorts to kill them."
  }

  if ($autoClean -and -not $Force) {
    $ownerText = ($aliveOwners -join ", ")
    Write-Host "[dev-up] Auto-cleaning likely SciAgent dev process(es) on port ${Port}: $ownerText" -ForegroundColor Yellow
  }

  $allowAggressiveCleanup = $Force -or $autoClean

  foreach ($ownerPid in $aliveOwners) {
    Stop-ProcessSafe -ProcessId ([int]$ownerPid) -Label "port-$Port owner"
  }

  for ($attempt = 1; $attempt -le 8; $attempt++) {
    Start-Sleep -Milliseconds 350
    $remainingOwners = @(Get-PortOwnerPids -Port $Port)
    if ($remainingOwners.Count -eq 0) {
      return
    }

    $remainingAliveOwners = @()
    foreach ($remainingPid in $remainingOwners) {
      if (Is-ProcessAlive -ProcessId ([int]$remainingPid)) {
        $remainingAliveOwners += [int]$remainingPid
      }
    }
    if ($remainingAliveOwners.Count -eq 0) {
      continue
    }

    if ($allowAggressiveCleanup) {
      foreach ($remainingPid in $remainingAliveOwners) {
        if ($Force -or (Is-LikelySciAgentPortOwner -Port $Port -ProcessId ([int]$remainingPid))) {
          Stop-ProcessSafe -ProcessId ([int]$remainingPid) -Label "port-$Port owner(retry#$attempt)"
        }
      }
    }
  }

  $remainingOwners = @(Get-PortOwnerPids -Port $Port)
  if ($remainingOwners.Count -gt 0) {
    if (Test-PortBindable -Port $Port) {
      return
    }

    $remainingAliveOwners = @()
    foreach ($remainingPid in $remainingOwners) {
      if (Is-ProcessAlive -ProcessId ([int]$remainingPid)) {
        $remainingAliveOwners += [int]$remainingPid
      }
    }
    if ($remainingAliveOwners.Count -eq 0) {
      $ownerText = ($remainingOwners -join ", ")
      Write-Warning "[dev-up] Port $Port still reports non-live PID(s): $ownerText. Continue startup."
      return
    }

    $ownerText = ($remainingAliveOwners -join ", ")
    throw "Port $Port is still in use after cleanup. Remaining live PID(s): $ownerText"
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
      Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3 -ErrorAction Stop | Out-Null
      return $true
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

$deepseekKey = Resolve-DeepSeekApiKey
if ([string]::IsNullOrWhiteSpace($deepseekKey)) {
  if ($RequireDeepSeek) {
    throw "DEEPSEEK_API_KEY is missing. Set it in .env (repo root/backend) or environment variables."
  }
  Write-Warning "[dev-up] DEEPSEEK_API_KEY is not configured. Runner will use fallback content instead of real DeepSeek calls."
}
else {
  Write-Host "[dev-up] DeepSeek key detected. Real LLM mode is available." -ForegroundColor Green
}

if (-not $DryRun) {
  $existing = Load-Pids
  if ($null -ne $existing) {
    $backendAlive = Is-ProcessAlive -ProcessId ([int]$existing.backendPid)
    $frontendAlive = Is-ProcessAlive -ProcessId ([int]$existing.frontendPid)

    if ($backendAlive -or $frontendAlive) {
      if (-not $AutoRestart) {
        throw "Managed dev processes already running. Use -Restart or -Stop first."
      }
      Write-Host "[dev-up] Existing managed processes detected. Restarting..." -ForegroundColor Yellow
      Stop-DevProcesses
    }
    else {
      Write-Host "[dev-up] Removing stale PID file: $PidFile" -ForegroundColor DarkYellow
      Remove-PidFile
    }
  }
  elseif ($AutoRestart) {
    Stop-DevProcesses
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

if (-not $DryRun) {
  Ensure-PortAvailable -Port $BackendPort -Label "backend" -Force:$ForceCleanPorts
  Ensure-PortAvailable -Port $FrontendPort -Label "frontend" -Force:$ForceCleanPorts
}

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
$backendReady = Wait-HttpReady -Url "http://127.0.0.1:$BackendPort/api/health" -Label "backend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids
$frontendReady = Wait-HttpReady -Url "http://127.0.0.1:$FrontendPort" -Label "frontend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids

if ($backendReady -and $frontendReady) {
  Write-Host "[dev-up] Services are ready." -ForegroundColor Green
}
else {
  Write-Warning "[dev-up] Services did not become ready in $ReadyTimeoutSec seconds. Check the opened terminals."
}

if ($OpenBrowser) {
  Start-Process "http://localhost:$FrontendPort"
}
