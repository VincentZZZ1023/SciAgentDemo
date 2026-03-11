[CmdletBinding()]
param(
  [string]$BackendBaseUrl = "http://127.0.0.1:8000",
  [string]$FrontendBaseUrl = "http://localhost:5173",
  [string]$Username = "demo",
  [string]$Password = "demo",
  [switch]$OpenBrowser,
  [switch]$NoBrowser,
  [switch]$ReuseFirstTopic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-JsonRequest {
  param(
    [ValidateSet("GET", "POST", "PUT", "PATCH", "DELETE")]
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [int]$TimeoutSec = 20
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

  Invoke-RestMethod @params
}

function Resolve-Token {
  param([object]$LoginResponse)

  if ($null -ne $LoginResponse -and $null -ne $LoginResponse.access_token -and -not [string]::IsNullOrWhiteSpace([string]$LoginResponse.access_token)) {
    return [string]$LoginResponse.access_token
  }
  if ($null -ne $LoginResponse -and $null -ne $LoginResponse.token -and -not [string]::IsNullOrWhiteSpace([string]$LoginResponse.token)) {
    return [string]$LoginResponse.token
  }

  throw "Login succeeded but token/access_token is missing."
}

Write-Host "[smoke-user] Logging in as '$Username'..." -ForegroundColor Cyan
$login = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/auth/login" -Body @{
  username = $Username
  password = $Password
}
$token = Resolve-Token -LoginResponse $login
$authHeaders = @{ Authorization = "Bearer $token" }

Write-Host "[smoke-user] Validating default run config..." -ForegroundColor Cyan
[void](Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/config/default" -Headers $authHeaders)

$topicId = $null
if ($ReuseFirstTopic) {
  $topics = Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/topics" -Headers $authHeaders
  $topicItems = if ($null -ne $topics.items) { @($topics.items) } else { @($topics) }
  if ($topicItems.Count -gt 0) {
    $topicId = [string]$topicItems[0].topicId
    Write-Host "[smoke-user] Reusing topic $topicId" -ForegroundColor DarkYellow
  }
}

if ([string]::IsNullOrWhiteSpace($topicId)) {
  $topicTitle = "smoke-user-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  Write-Host "[smoke-user] Creating topic '$topicTitle'..." -ForegroundColor Cyan
  $createdTopic = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/topics" -Headers $authHeaders -Body @{
    name = $topicTitle
    description = "Auto-created by scripts/smoke-user.ps1"
  }
  $topicId = [string]$createdTopic.topicId
}

Write-Host "[smoke-user] Creating run..." -ForegroundColor Cyan
$run = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/topics/$topicId/runs" -Headers $authHeaders -Body @{
  prompt = "Quick smoke run triggered by scripts/smoke-user.ps1"
}
$runId = if ($null -ne $run -and $null -ne $run.runId) { [string]$run.runId } else { "" }

$launchQueryParts = @("view=classic", "tab=chat")
if (-not [string]::IsNullOrWhiteSpace($runId)) {
  $launchQueryParts += "runId=$([System.Uri]::EscapeDataString($runId))"
}
$launchQuery = $launchQueryParts -join "&"
$launchUrl = "$FrontendBaseUrl/app/$($topicId)?$launchQuery"

Write-Host "[smoke-user] topicId = $topicId" -ForegroundColor Green
if (-not [string]::IsNullOrWhiteSpace($runId)) {
  Write-Host "[smoke-user] runId   = $runId" -ForegroundColor Green
}
Write-Host "[smoke-user] launch  = $launchUrl" -ForegroundColor Green

if ($OpenBrowser -and -not $NoBrowser) {
  Start-Process $launchUrl
}
