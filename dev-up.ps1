[CmdletBinding()]
param(
  [switch]$InstallDeps,
  [switch]$OpenBrowser,
  [switch]$NoBrowser,
  [switch]$DryRun,
  [switch]$Stop,
  [switch]$Status,
  [switch]$Restart,
  [switch]$OneClick,
  [switch]$Quick,
  [switch]$Test,
  [switch]$OpenAppCenter,
  [switch]$OpenAdmin,
  [switch]$OpenClassic,
  [switch]$NoRestart,
  [switch]$ForceCleanPorts,
  [switch]$RequireDeepSeek,
  [switch]$SkipDocker,
  [switch]$SkipMigrate,
  [int]$ReadyTimeoutSec = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
# Prevent stderr-only native output (e.g. Alembic INFO logs) from being treated
# as terminating errors in PowerShell 7+.
if (Get-Variable -Name "PSNativeCommandUseErrorActionPreference" -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$StateDir = Join-Path $RepoRoot ".dev"
$PidFile = Join-Path $StateDir "dev-up.pids.json"
$RootEnvFile = Join-Path $RepoRoot ".env"
$RootEnvExample = Join-Path $RepoRoot ".env.example"
$BackendPort = 8000
$FrontendPort = 5173
$PostgresPort = 5432

$AutoOneClick = ($PSBoundParameters.Count -eq 0)
if ($AutoOneClick) {
  $OneClick = $true
}

$EffectiveRestart = $Restart -or $Quick -or $OneClick -or $Test -or (-not $NoRestart)
$EffectiveForceCleanPorts = $ForceCleanPorts -or $Quick -or $OneClick -or $Test
$EffectiveOpenBrowser = ($OpenBrowser -or $Quick -or $OneClick -or $Test) -and (-not $NoBrowser)
$EffectiveOpenAdmin = $OpenAdmin
$EffectiveOpenClassic = $OpenClassic
$EffectiveOpenAppCenter = $OpenAppCenter -or (($OneClick -or $Quick) -and (-not $OpenClassic) -and (-not $OpenAdmin))

if (-not (Test-Path $RootEnvFile) -and (Test-Path $RootEnvExample)) {
  Copy-Item -Path $RootEnvExample -Destination $RootEnvFile -Force
  Write-Host "[dev-up] .env not found. Bootstrapped from .env.example." -ForegroundColor Yellow
}
$ConfiguredDatabaseUrl = $null
foreach ($candidate in @((Join-Path $RepoRoot ".env"), (Join-Path $BackendDir ".env"))) {
  if (-not (Test-Path $candidate)) {
    continue
  }

  foreach ($line in Get-Content -Path $candidate) {
    if ($line.TrimStart().StartsWith("#")) {
      continue
    }
    if ($line -match "^\s*DATABASE_URL\s*=\s*(.*)\s*$") {
      $value = $Matches[1].Trim()
      if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      elseif ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      if (-not [string]::IsNullOrWhiteSpace($value)) {
        $ConfiguredDatabaseUrl = $value
        break
      }
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredDatabaseUrl)) {
    break
  }
}
if ([string]::IsNullOrWhiteSpace($ConfiguredDatabaseUrl) -and -not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  $ConfiguredDatabaseUrl = $env:DATABASE_URL
}
if ([string]::IsNullOrWhiteSpace($ConfiguredDatabaseUrl)) {
  $ConfiguredDatabaseUrl = "postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent"
}
$env:DATABASE_URL = $ConfiguredDatabaseUrl
$UsingPostgres = $ConfiguredDatabaseUrl.ToLowerInvariant().StartsWith("postgresql")
$EffectiveAutoMigrate = (-not $SkipMigrate)
$EffectiveDockerBootstrap = (-not $SkipDocker) -and ($OneClick -or $Quick -or $Test) -and $UsingPostgres
$AutoRestart = $EffectiveRestart -and (-not $DryRun)
$AllowReuseExisting = (-not $AutoRestart)

if (-not $Stop -and -not $Status -and -not $UsingPostgres) {
  throw "SQLite is no longer supported for runtime. Set DATABASE_URL to PostgreSQL in .env before starting."
}

if (-not $Stop -and -not $Status) {
  if ($OneClick -and -not $Quick) {
    Write-Host "[dev-up] One-click mode enabled: restart + force-clean ports + open browser." -ForegroundColor Cyan
  }

  if ($Quick) {
    Write-Host "[dev-up] Quick mode enabled: restart + force-clean ports + open browser." -ForegroundColor Cyan
  }

  if ($Test) {
    Write-Host "[dev-up] Test mode enabled: quick API smoke + auto topic/run + open browser to run panel." -ForegroundColor Cyan
  }

  if (-not $Test -and $EffectiveOpenBrowser) {
    if ($EffectiveOpenAdmin) {
      Write-Host "[dev-up] Browser target: admin dashboard (/admin)." -ForegroundColor Cyan
    }
    elseif ($EffectiveOpenClassic) {
      Write-Host "[dev-up] Browser target: classic workflow (/app)." -ForegroundColor Cyan
    }
    elseif ($EffectiveOpenAppCenter) {
      Write-Host "[dev-up] Browser target: app center (/app-center)." -ForegroundColor Cyan
    }
  }

  if ($EffectiveAutoMigrate) {
    if ($EffectiveDockerBootstrap) {
      Write-Host "[dev-up] DB bootstrap enabled: docker postgres + alembic migrate." -ForegroundColor Cyan
    }
    else {
      if (-not $UsingPostgres) {
        Write-Host "[dev-up] DATABASE_URL points to non-Postgres ($ConfiguredDatabaseUrl). Skipping docker postgres bootstrap." -ForegroundColor DarkYellow
      }
      Write-Host "[dev-up] DB migrate enabled: alembic upgrade head." -ForegroundColor Cyan
    }
  }

  if (-not $AllowReuseExisting) {
    Write-Host "[dev-up] Restart mode: existing services will not be reused." -ForegroundColor Cyan
  }
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Please install it and retry."
  }
}

function Get-NpmCommand {
  $npmCmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if ($null -ne $npmCmd -and -not [string]::IsNullOrWhiteSpace($npmCmd.Source)) {
    return [string]$npmCmd.Source
  }

  $npm = Get-Command "npm" -ErrorAction SilentlyContinue
  if ($null -ne $npm -and -not [string]::IsNullOrWhiteSpace($npm.Source)) {
    return [string]$npm.Source
  }

  throw "Missing command 'npm'. Please install Node.js and retry."
}

function Test-PythonModule {
  param(
    [string]$ModuleName,
    [string]$PythonCommand = "python"
  )

  try {
    & $PythonCommand -c "import $ModuleName" *> $null
    return ($LASTEXITCODE -eq 0)
  }
  catch {
    return $false
  }
}

function Get-MissingPythonModules {
  param(
    [string[]]$ModuleNames,
    [string]$PythonCommand = "python"
  )

  $missing = @()
  foreach ($moduleName in $ModuleNames) {
    if (-not (Test-PythonModule -ModuleName $moduleName -PythonCommand $PythonCommand)) {
      $missing += $moduleName
    }
  }

  return $missing
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

function Resolve-EnvValue {
  param(
    [string]$Name,
    [string]$DefaultValue = ""
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return [string]$processValue
  }

  $rootEnv = Join-Path $RepoRoot ".env"
  $backendEnv = Join-Path $BackendDir ".env"

  $rootValue = Get-EnvValueFromFile -Path $rootEnv -Name $Name
  if (-not [string]::IsNullOrWhiteSpace($rootValue)) {
    return $rootValue
  }

  $backendValue = Get-EnvValueFromFile -Path $backendEnv -Name $Name
  if (-not [string]::IsNullOrWhiteSpace($backendValue)) {
    return $backendValue
  }

  return $DefaultValue
}

function Resolve-DatabaseUrl {
  $rootEnv = Join-Path $RepoRoot ".env"
  $backendEnv = Join-Path $BackendDir ".env"

  $rootValue = Get-EnvValueFromFile -Path $rootEnv -Name "DATABASE_URL"
  if (-not [string]::IsNullOrWhiteSpace($rootValue)) {
    return $rootValue
  }

  $backendValue = Get-EnvValueFromFile -Path $backendEnv -Name "DATABASE_URL"
  if (-not [string]::IsNullOrWhiteSpace($backendValue)) {
    return $backendValue
  }

  if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    return $env:DATABASE_URL
  }

  return "postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent"
}

function Get-BackendPythonCommand {
  $venvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
  if (Test-Path $venvPython) {
    return $venvPython
  }
  return "python"
}

function Get-ComposeRunner {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
      & docker compose version *> $null
      if ($LASTEXITCODE -eq 0) {
        return "docker-compose-v2"
      }
    }
    catch {
      # fallback to docker-compose binary check below
    }
  }

  if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    return "docker-compose-v1"
  }

  return $null
}

function Invoke-ComposeCommand {
  param(
    [string]$Runner,
    [string[]]$ComposeArgs
  )

  if ($Runner -eq "docker-compose-v2") {
    & docker compose @ComposeArgs
    return
  }

  if ($Runner -eq "docker-compose-v1") {
    & docker-compose @ComposeArgs
    return
  }

  throw "No docker compose runner available."
}

function Invoke-ExternalProcessCapture {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = ""
  )

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $startParams = @{
      FilePath = $FilePath
      ArgumentList = $Arguments
      Wait = $true
      PassThru = $true
      NoNewWindow = $true
      RedirectStandardOutput = $stdoutPath
      RedirectStandardError = $stderrPath
      ErrorAction = "Stop"
    }

    if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
      $startParams["WorkingDirectory"] = $WorkingDirectory
    }

    $process = Start-Process @startParams
    $stdoutLines = @(Get-Content -Path $stdoutPath -ErrorAction SilentlyContinue)
    $stderrLines = @(Get-Content -Path $stderrPath -ErrorAction SilentlyContinue)

    return @{
      ExitCode = [int]$process.ExitCode
      StdOut = $stdoutLines
      StdErr = $stderrLines
      Output = @($stdoutLines + $stderrLines)
    }
  }
  finally {
    Remove-Item -Path $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Wait-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $client = $null
    try {
      $client = [System.Net.Sockets.TcpClient]::new()
      $task = $client.ConnectAsync($HostName, $Port)
      if ($task.Wait(400) -and $client.Connected) {
        return $true
      }
    }
    catch {
      # keep waiting
    }
    finally {
      if ($null -ne $client) {
        $client.Dispose()
      }
    }

    Start-Sleep -Milliseconds 400
  }

  return $false
}

function Test-DockerEngineReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    return $false
  }

  $oldEap = $ErrorActionPreference
  $nativePrefVar = Get-Variable -Name "PSNativeCommandUseErrorActionPreference" -Scope Global -ErrorAction SilentlyContinue
  $hasNativePref = ($null -ne $nativePrefVar)
  $oldNativePref = $false
  if ($hasNativePref) {
    $oldNativePref = [bool]$nativePrefVar.Value
  }

  try {
    $ErrorActionPreference = "Continue"
    if ($hasNativePref) {
      Set-Variable -Name "PSNativeCommandUseErrorActionPreference" -Scope Global -Value $false
    }
    & docker info *> $null
    return ($LASTEXITCODE -eq 0)
  }
  catch {
    return $false
  }
  finally {
    if ($hasNativePref) {
      Set-Variable -Name "PSNativeCommandUseErrorActionPreference" -Scope Global -Value $oldNativePref
    }
    $ErrorActionPreference = $oldEap
  }
}

function Get-DockerDesktopExecutable {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramW6432} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:LocalAppData} "Programs\Docker\Docker\Docker Desktop.exe")
  )

  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Ensure-DockerEngineReady {
  param(
    [int]$TimeoutSec = 90
  )

  if (Test-DockerEngineReady) {
    return $true
  }

  $desktopExe = Get-DockerDesktopExecutable
  if ([string]::IsNullOrWhiteSpace($desktopExe)) {
    return $false
  }

  Write-Host "[dev-up] Docker daemon is not ready. Launching Docker Desktop..." -ForegroundColor Yellow
  try {
    Start-Process -FilePath $desktopExe | Out-Null
  }
  catch {
    return $false
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerEngineReady) {
      Write-Host "[dev-up] Docker engine is ready." -ForegroundColor Green
      return $true
    }
    Start-Sleep -Seconds 2
  }

  return $false
}

function Start-PostgresIfNeeded {
  $dbUrl = Resolve-DatabaseUrl
  if (-not $dbUrl.ToLowerInvariant().StartsWith("postgresql")) {
    Write-Host "[dev-up] DATABASE_URL is not PostgreSQL. Skip docker postgres bootstrap." -ForegroundColor DarkYellow
    return
  }

  # Only bootstrap local PostgreSQL via Docker when DATABASE_URL points to localhost.
  $dbHost = ""
  try {
    $normalizedDbUrl = $dbUrl -replace "^postgresql(\+[^:]+)?://", "postgres://"
    $dbUri = [System.Uri]$normalizedDbUrl
    $dbHost = $dbUri.Host
  }
  catch {
    $dbHost = ""
  }

  if (-not [string]::IsNullOrWhiteSpace($dbHost) -and $dbHost -notin @("localhost", "127.0.0.1")) {
    Write-Host "[dev-up] DATABASE_URL host is '$dbHost'. Skip local docker postgres bootstrap." -ForegroundColor DarkYellow
    return
  }

  # Local PostgreSQL already available, no need to bootstrap with Docker.
  if (Wait-TcpPort -HostName "127.0.0.1" -Port $PostgresPort -TimeoutSec 2) {
    Write-Host "[dev-up] PostgreSQL is already reachable on localhost:$PostgresPort. Skip docker bootstrap." -ForegroundColor Green
    return
  }

  if (-not (Test-Path $ComposeFile)) {
    Write-Host "[dev-up] docker-compose.yml not found. Skipping docker DB bootstrap." -ForegroundColor DarkYellow
    return
  }

  $runner = Get-ComposeRunner
  if ($null -eq $runner) {
    Write-Host "[dev-up] Docker Compose not found. Assuming external PostgreSQL is already running." -ForegroundColor DarkYellow
    return
  }

  if (-not (Ensure-DockerEngineReady -TimeoutSec 90)) {
    if (Wait-TcpPort -HostName "127.0.0.1" -Port $PostgresPort -TimeoutSec 2) {
      Write-Warning "[dev-up] Docker engine not ready, but PostgreSQL became reachable on localhost:$PostgresPort. Continuing..."
      return
    }

    throw @"
Docker engine is not ready, and PostgreSQL is not reachable on localhost:$PostgresPort.
Fix options:
  1) Start Docker Desktop manually, then rerun: .\dev-up.ps1
  2) If you already run PostgreSQL externally, rerun with: .\dev-up.ps1 -SkipDocker
  3) Verify DATABASE_URL in .env points to a reachable PostgreSQL instance.
"@
  }

  Write-Host "[dev-up] Starting PostgreSQL via Docker Compose..." -ForegroundColor Cyan
  $composeExitCode = 0
  $composeOutput = @()
  Push-Location $RepoRoot
  try {
    if ($runner -eq "docker-compose-v2") {
      $composeResult = Invoke-ExternalProcessCapture -FilePath "docker" -Arguments @("compose", "up", "-d", "postgres") -WorkingDirectory $RepoRoot
    }
    elseif ($runner -eq "docker-compose-v1") {
      $composeResult = Invoke-ExternalProcessCapture -FilePath "docker-compose" -Arguments @("up", "-d", "postgres") -WorkingDirectory $RepoRoot
    }
    else {
      throw "No docker compose runner available."
    }

    $composeOutput = @($composeResult.Output)
    $composeExitCode = [int]$composeResult.ExitCode
  }
  finally {
    Pop-Location
  }

  if ($composeOutput.Count -gt 0) {
    $composeOutput | ForEach-Object { Write-Host $_ }
  }

  if ($composeExitCode -ne 0) {
    if (Wait-TcpPort -HostName "127.0.0.1" -Port $PostgresPort -TimeoutSec 2) {
      Write-Warning "[dev-up] docker compose failed, but PostgreSQL is already reachable on localhost:$PostgresPort. Continuing..."
      return
    }

    throw @"
docker compose up -d postgres failed and PostgreSQL is not reachable on localhost:$PostgresPort.
Fix options:
  1) Start Docker Desktop, then rerun: .\dev-up.ps1
  2) If you already run PostgreSQL externally, rerun with: .\dev-up.ps1 -SkipDocker
  3) Verify DATABASE_URL in .env points to a reachable PostgreSQL instance.
"@
  }

  if (Wait-TcpPort -HostName "127.0.0.1" -Port $PostgresPort -TimeoutSec 25) {
    Write-Host "[dev-up] PostgreSQL is reachable on localhost:$PostgresPort" -ForegroundColor Green
  }
  else {
    Write-Warning "[dev-up] PostgreSQL did not become reachable in time. Migration may fail if DB is not ready."
  }
}

function Run-AlembicUpgrade {
  $pythonCmd = Get-BackendPythonCommand
  $dbUrl = Resolve-DatabaseUrl
  $env:DATABASE_URL = $dbUrl

  Write-Host "[dev-up] Running Alembic migrations (upgrade head)..." -ForegroundColor Cyan
  $upgradeResult = Invoke-ExternalProcessCapture -FilePath $pythonCmd -Arguments @("-m", "alembic", "upgrade", "head") -WorkingDirectory $BackendDir
  $upgradeOutput = @($upgradeResult.Output)
  $upgradeExitCode = [int]$upgradeResult.ExitCode
  if ($null -ne $upgradeOutput) {
    $upgradeOutput | ForEach-Object { Write-Host $_ }
  }
  if ($upgradeExitCode -ne 0) {
    $upgradeText = ""
    if ($null -ne $upgradeOutput) {
      $upgradeText = ($upgradeOutput | Out-String)
    }
    $looksLikeDuplicateSchema = (
      $upgradeText -match "already exists" -or
      $upgradeText -match "DuplicateTable"
    )

    if ($looksLikeDuplicateSchema) {
      Write-Warning "[dev-up] Alembic detected existing schema without version state. Attempting 'alembic stamp head' repair..."
      $stampResult = Invoke-ExternalProcessCapture -FilePath $pythonCmd -Arguments @("-m", "alembic", "stamp", "head") -WorkingDirectory $BackendDir
      if ($null -ne $stampResult.Output) {
        @($stampResult.Output) | ForEach-Object { Write-Host $_ }
      }
      if ([int]$stampResult.ExitCode -ne 0) {
        throw "alembic stamp head failed during automatic repair."
      }

      $retryResult = Invoke-ExternalProcessCapture -FilePath $pythonCmd -Arguments @("-m", "alembic", "upgrade", "head") -WorkingDirectory $BackendDir
      $retryOutput = @($retryResult.Output)
      $retryExitCode = [int]$retryResult.ExitCode
      if ($null -ne $retryOutput) {
        $retryOutput | ForEach-Object { Write-Host $_ }
      }
      if ($retryExitCode -ne 0) {
        throw "alembic upgrade head failed after automatic repair."
      }
    }
    else {
      throw "alembic upgrade head failed."
    }
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

function Stop-PortOwnersIfLikely {
  param(
    [int]$Port,
    [string]$Label
  )

  $owners = @(Get-PortOwnerPids -Port $Port)
  if ($owners.Count -eq 0) {
    return
  }

  $stoppedAny = $false
  foreach ($ownerPid in $owners) {
    $pidInt = [int]$ownerPid
    if (-not (Is-ProcessAlive -ProcessId $pidInt)) {
      continue
    }
    if (Is-LikelySciAgentPortOwner -Port $Port -ProcessId $pidInt) {
      Stop-ProcessSafe -ProcessId $pidInt -Label "$Label(port-$Port)"
      $stoppedAny = $true
    }
  }

  if ($stoppedAny) {
    Start-Sleep -Milliseconds 300
  }
}

function Get-TrackedPortOwnerPid {
  param(
    [int]$Port
  )

  $owners = @(Get-PortOwnerPids -Port $Port)
  foreach ($ownerPid in $owners) {
    $pidInt = [int]$ownerPid
    if ((Is-ProcessAlive -ProcessId $pidInt) -and (Is-LikelySciAgentPortOwner -Port $Port -ProcessId $pidInt)) {
      return $pidInt
    }
  }

  return 0
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

function Test-HttpReadyOnce {
  param(
    [string]$Url,
    [int]$TimeoutSec = 3
  )

  try {
    Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop | Out-Null
    return $true
  }
  catch {
    return $false
  }
}

function Invoke-JsonRequest {
  param(
    [ValidateSet("GET", "POST", "PUT", "PATCH", "DELETE")]
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [int]$TimeoutSec = 15
  )

  $params = @{
    Method = $Method
    Uri = $Url
    TimeoutSec = $TimeoutSec
    ErrorAction = "Stop"
  }

  if ($Headers.Count -gt 0) {
    $params["Headers"] = $Headers
  }

  if ($null -ne $Body) {
    $params["ContentType"] = "application/json"
    $params["Body"] = ($Body | ConvertTo-Json -Depth 12 -Compress)
  }

  return Invoke-RestMethod @params
}

function Invoke-QuickUiTest {
  param(
    [string]$BackendBaseUrl,
    [string]$FrontendBaseUrl,
    [string]$DemoUsername = "demo",
    [string]$DemoPassword = "demo"
  )

  Write-Host "[dev-up] Running quick API smoke..." -ForegroundColor Cyan

  $login = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/auth/login" -Body @{
    username = $DemoUsername
    password = $DemoPassword
  }

  $token = ""
  if ($null -ne $login -and $null -ne $login.access_token -and -not [string]::IsNullOrWhiteSpace([string]$login.access_token)) {
    $token = [string]$login.access_token
  }
  elseif ($null -ne $login -and $null -ne $login.token -and -not [string]::IsNullOrWhiteSpace([string]$login.token)) {
    $token = [string]$login.token
  }
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Login failed in test mode: token/access_token is missing."
  }

  $authHeaders = @{
    Authorization = "Bearer $token"
  }

  # Validate default run config contract.
  [void](Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/config/default" -Headers $authHeaders)

  $topicsResponse = Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/topics" -Headers $authHeaders
  $topicId = $null
  $topicItems = @()
  if ($null -ne $topicsResponse -and $null -ne $topicsResponse.items) {
    $topicItems = @($topicsResponse.items)
  }
  if ($topicItems.Count -gt 0) {
    $topicId = [string]$topicItems[0].topicId
  }

  if ([string]::IsNullOrWhiteSpace($topicId)) {
    $topicTitle = "quick-test-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    $created = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/topics" -Headers $authHeaders -Body @{
      name = $topicTitle
      description = "Auto-created by dev-up.ps1 -Test"
    }
    $topicId = [string]$created.topicId
  }

  $run = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/topics/$topicId/runs" -Headers $authHeaders -Body @{
    prompt = "Quick smoke run triggered by dev-up.ps1 -Test"
  }

  $runId = if ($null -ne $run -and $null -ne $run.runId) { [string]$run.runId } else { "" }
  $launchUrl = if ([string]::IsNullOrWhiteSpace($runId)) {
    "$FrontendBaseUrl/app/$topicId"
  }
  else {
    "$FrontendBaseUrl/app/$topicId?runId=$([System.Uri]::EscapeDataString($runId))"
  }

  return @{
    topicId = $topicId
    runId = $runId
    launchUrl = $launchUrl
  }
}

function Show-DevStatus {
  $backendHealthy = Test-HttpReadyOnce -Url "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2
  $frontendHealthy = Test-HttpReadyOnce -Url "http://127.0.0.1:$FrontendPort" -TimeoutSec 2
  $backendOwners = @(Get-PortOwnerPids -Port $BackendPort)
  $frontendOwners = @(Get-PortOwnerPids -Port $FrontendPort)
  $tracked = Load-Pids

  Write-Host "[dev-up] Status" -ForegroundColor Cyan
  Write-Host ("  backend  : {0} (port {1}, owners: {2})" -f ($(if ($backendHealthy) { "up" } else { "down" }), $BackendPort, $(if ($backendOwners.Count -gt 0) { $backendOwners -join "," } else { "none" })))
  Write-Host ("  frontend : {0} (port {1}, owners: {2})" -f ($(if ($frontendHealthy) { "up" } else { "down" }), $FrontendPort, $(if ($frontendOwners.Count -gt 0) { $frontendOwners -join "," } else { "none" })))

  if ($null -ne $tracked) {
    Write-Host ("  tracked  : backendPid={0}, frontendPid={1}" -f $tracked.backendPid, $tracked.frontendPid)
  }
  else {
    Write-Host "  tracked  : none"
  }
}

if ($Stop) {
  Stop-DevProcesses
  Stop-PortOwnersIfLikely -Port $BackendPort -Label "backend"
  Stop-PortOwnersIfLikely -Port $FrontendPort -Label "frontend"
  Remove-PidFile
  Write-Host "[dev-up] Stop complete." -ForegroundColor Yellow
  exit 0
}

if ($Status) {
  Show-DevStatus
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
Require-Command -Name "npm"
$NpmCmd = Get-NpmCommand
$BackendPythonCmd = Get-BackendPythonCommand
if ($BackendPythonCmd -eq "python") {
  Require-Command -Name "python"
}
elseif (-not (Test-Path $BackendPythonCmd)) {
  throw "Backend Python executable not found: $BackendPythonCmd"
}

$deepseekKey = Resolve-DeepSeekApiKey
$DemoLoginUser = Resolve-EnvValue -Name "DEMO_EMAIL" -DefaultValue "demo"
$DemoLoginPass = Resolve-EnvValue -Name "DEMO_PASSWORD" -DefaultValue "demo"
$AdminLoginUser = Resolve-EnvValue -Name "ADMIN_EMAIL" -DefaultValue "admin"
$AdminLoginPass = Resolve-EnvValue -Name "ADMIN_PASSWORD" -DefaultValue "admin"

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

  if ($AutoRestart) {
    Stop-PortOwnersIfLikely -Port $BackendPort -Label "backend"
    Stop-PortOwnersIfLikely -Port $FrontendPort -Label "frontend"
  }
}

$backendRequirements = Join-Path $BackendDir "requirements.txt"
$frontendNodeModules = Join-Path $FrontendDir "node_modules"

$needBackendDeps = $InstallDeps
$needFrontendDeps = $InstallDeps
$requiredBackendModules = @("uvicorn", "alembic", "sqlmodel", "psycopg2", "bcrypt")
$missingBackendModules = @()

if (-not $InstallDeps) {
  $missingBackendModules = @(Get-MissingPythonModules -ModuleNames $requiredBackendModules -PythonCommand $BackendPythonCmd)
  if ($missingBackendModules.Count -gt 0) {
    $needBackendDeps = $true
  }
  if (-not (Test-Path $frontendNodeModules)) {
    $needFrontendDeps = $true
  }

  if ($needBackendDeps -or $needFrontendDeps) {
    Write-Host "[dev-up] Missing dependencies detected. Auto-installing required packages..." -ForegroundColor Yellow
    if ($missingBackendModules.Count -gt 0) {
      Write-Host "[dev-up] Missing Python modules: $($missingBackendModules -join ', ')" -ForegroundColor DarkYellow
    }
  }
}

if ($DryRun -and ($needBackendDeps -or $needFrontendDeps)) {
  if ($needBackendDeps) {
    Write-Host "[dry-run] Backend dependencies would be installed from: $backendRequirements" -ForegroundColor Yellow
  }
  if ($needFrontendDeps) {
    Write-Host "[dry-run] Frontend dependencies would be installed via: $NpmCmd install" -ForegroundColor Yellow
  }
  $needBackendDeps = $false
  $needFrontendDeps = $false
}

if ($needBackendDeps) {
  Write-Host "[setup] Installing backend dependencies..." -ForegroundColor Cyan
  & $BackendPythonCmd -m pip install -r $backendRequirements
  if ($LASTEXITCODE -ne 0) {
    throw "Backend dependency install failed."
  }
}

if ($needFrontendDeps) {
  Write-Host "[setup] Installing frontend dependencies..." -ForegroundColor Cyan
  Push-Location $FrontendDir
  try {
    & $NpmCmd install
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend dependency install failed."
    }
  }
  finally {
    Pop-Location
  }
}

$ReuseBackend = $false
$ReuseFrontend = $false

if (-not $DryRun -and $EffectiveDockerBootstrap) {
  Start-PostgresIfNeeded
}

if (-not $DryRun) {
  if (Test-PortBindable -Port $BackendPort) {
    # Backend port is free, start a new backend process.
  }
  elseif ($AllowReuseExisting -and (Test-HttpReadyOnce -Url "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2)) {
    $ReuseBackend = $true
    Write-Host "[dev-up] Reusing existing backend on http://localhost:$BackendPort" -ForegroundColor DarkYellow
  }
  else {
    Ensure-PortAvailable -Port $BackendPort -Label "backend" -Force:$EffectiveForceCleanPorts
  }

  if (Test-PortBindable -Port $FrontendPort) {
    # Frontend port is free, start a new frontend process.
  }
  elseif ($AllowReuseExisting -and (Test-HttpReadyOnce -Url "http://127.0.0.1:$FrontendPort" -TimeoutSec 2)) {
    $ReuseFrontend = $true
    Write-Host "[dev-up] Reusing existing frontend on http://localhost:$FrontendPort" -ForegroundColor DarkYellow
  }
  else {
    Ensure-PortAvailable -Port $FrontendPort -Label "frontend" -Force:$EffectiveForceCleanPorts
  }
}

if (-not $DryRun -and $EffectiveAutoMigrate) {
  if ($ReuseBackend) {
    Write-Host "[dev-up] Backend is being reused. Skipping automatic migration step." -ForegroundColor DarkYellow
  }
  else {
    Run-AlembicUpgrade
  }
}

$BackendPythonEscaped = $BackendPythonCmd.Replace("'", "''")
$backendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Backend'
Set-Location -Path '$BackendDir'
& '$BackendPythonEscaped' -m uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort
"@

$frontendCommand = @"
`$host.UI.RawUI.WindowTitle = 'SciAgentDemo Frontend'
Set-Location -Path '$FrontendDir'
& '$($NpmCmd.Replace("'", "''"))' run dev -- --host 0.0.0.0 --port $FrontendPort
"@

if ($DryRun) {
  if ($EffectiveDockerBootstrap) {
    Write-Host "[dry-run] DB bootstrap: docker compose up -d postgres" -ForegroundColor Yellow
  }
  if ($EffectiveAutoMigrate) {
    Write-Host "[dry-run] DB migrate: cd backend && $(Get-BackendPythonCommand) -m alembic upgrade head" -ForegroundColor Yellow
  }
  Write-Host "[dry-run] Backend command:" -ForegroundColor Yellow
  Write-Host $backendCommand
  Write-Host "[dry-run] Frontend command:" -ForegroundColor Yellow
  Write-Host $frontendCommand
  Write-Host "[dry-run] Ready timeout: $ReadyTimeoutSec s"
  Write-Host "[dry-run] Script validation complete."
  exit 0
}

$backendProc = $null
$frontendProc = $null

if (-not $ReuseBackend) {
  $backendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -PassThru
  Start-Sleep -Milliseconds 500
}

if (-not $ReuseFrontend) {
  $frontendProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -PassThru
}

$backendPid = if ($null -ne $backendProc) { [int]$backendProc.Id } elseif ($ReuseBackend) { Get-TrackedPortOwnerPid -Port $BackendPort } else { 0 }
$frontendPid = if ($null -ne $frontendProc) { [int]$frontendProc.Id } elseif ($ReuseFrontend) { Get-TrackedPortOwnerPid -Port $FrontendPort } else { 0 }
Save-Pids -BackendPid $backendPid -FrontendPid $frontendPid

if ($backendPid -gt 0) {
  if ($null -ne $backendProc) {
    Write-Host "[dev-up] Backend PID:  $backendPid" -ForegroundColor Green
  }
  else {
    Write-Host "[dev-up] Backend PID:  reused-existing ($backendPid)" -ForegroundColor Green
  }
}
else {
  Write-Host "[dev-up] Backend PID:  reused-existing" -ForegroundColor Green
}

if ($frontendPid -gt 0) {
  if ($null -ne $frontendProc) {
    Write-Host "[dev-up] Frontend PID: $frontendPid" -ForegroundColor Green
  }
  else {
    Write-Host "[dev-up] Frontend PID: reused-existing ($frontendPid)" -ForegroundColor Green
  }
}
else {
  Write-Host "[dev-up] Frontend PID: reused-existing" -ForegroundColor Green
}

Write-Host "[dev-up] Backend URL:  http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "[dev-up] Frontend URL: http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "[dev-up] Stop command: .\dev-up.ps1 -Stop" -ForegroundColor Green
Write-Host "[dev-up] Demo users: $DemoLoginUser/$DemoLoginPass , $AdminLoginUser/$AdminLoginPass" -ForegroundColor Green

$watchPids = @()
if ($backendPid -gt 0) {
  $watchPids += $backendPid
}
if ($frontendPid -gt 0) {
  $watchPids += $frontendPid
}

if ($ReuseBackend) {
  $backendReady = Test-HttpReadyOnce -Url "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 5
}
else {
  $backendReady = Wait-HttpReady -Url "http://127.0.0.1:$BackendPort/api/health" -Label "backend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids
}

if ($ReuseFrontend) {
  $frontendReady = Test-HttpReadyOnce -Url "http://127.0.0.1:$FrontendPort" -TimeoutSec 5
}
else {
  $frontendReady = Wait-HttpReady -Url "http://127.0.0.1:$FrontendPort" -Label "frontend" -TimeoutSec $ReadyTimeoutSec -WatchPids $watchPids
}

if ($backendReady -and $frontendReady) {
  Write-Host "[dev-up] Services are ready." -ForegroundColor Green
}
else {
  Write-Warning "[dev-up] Services did not become ready in $ReadyTimeoutSec seconds. Check the opened terminals."
}

$BrowserUrl = if ($EffectiveOpenAdmin -and -not $Test) {
  "http://localhost:$FrontendPort/admin"
}
elseif ($EffectiveOpenClassic -and -not $Test) {
  "http://localhost:$FrontendPort/app"
}
elseif ($EffectiveOpenAppCenter -and -not $Test) {
  "http://localhost:$FrontendPort/app-center"
}
else {
  "http://localhost:$FrontendPort"
}

if ($Test) {
  if ($backendReady -and $frontendReady) {
    try {
      $testResult = Invoke-QuickUiTest -BackendBaseUrl "http://127.0.0.1:$BackendPort" -FrontendBaseUrl "http://localhost:$FrontendPort" -DemoUsername $DemoLoginUser -DemoPassword $DemoLoginPass
      $topicId = [string]$testResult.topicId
      $runId = [string]$testResult.runId
      $BrowserUrl = [string]$testResult.launchUrl

      if ([string]::IsNullOrWhiteSpace($runId)) {
        Write-Host "[dev-up] Test run created topic=$topicId (runId unavailable)." -ForegroundColor Green
      }
      else {
        Write-Host "[dev-up] Test run created topic=$topicId runId=$runId" -ForegroundColor Green
      }
      Write-Host "[dev-up] Test launch URL: $BrowserUrl" -ForegroundColor Green
    }
    catch {
      Write-Warning "[dev-up] Test mode smoke failed: $($_.Exception.Message)"
      Write-Warning "[dev-up] Falling back to default frontend URL."
      $BrowserUrl = "http://localhost:$FrontendPort"
    }
  }
  else {
    Write-Warning "[dev-up] Skipping test-mode smoke because services are not ready."
  }
}

if ($EffectiveOpenBrowser) {
  Start-Process $BrowserUrl
}
