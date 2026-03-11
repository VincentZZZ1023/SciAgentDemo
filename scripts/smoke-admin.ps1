[CmdletBinding()]
param(
  [string]$BackendBaseUrl = "http://127.0.0.1:8000",
  [string]$FrontendBaseUrl = "http://localhost:5173",
  [string]$Username = "admin",
  [string]$Password = "admin",
  [switch]$OpenBrowser,
  [switch]$NoBrowser
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

Write-Host "[smoke-admin] Logging in as '$Username'..." -ForegroundColor Cyan
$login = Invoke-JsonRequest -Method "POST" -Url "$BackendBaseUrl/api/auth/login" -Body @{
  username = $Username
  password = $Password
}
$token = Resolve-Token -LoginResponse $login
$authHeaders = @{ Authorization = "Bearer $token" }

Write-Host "[smoke-admin] Querying /api/admin/overview ..." -ForegroundColor Cyan
$overview = Invoke-JsonRequest -Method "GET" -Url "$BackendBaseUrl/api/admin/overview" -Headers $authHeaders

$activeRuns = if ($null -ne $overview.activeRuns) { [int]$overview.activeRuns } else { 0 }
$approvalsPending = if ($null -ne $overview.approvalsPending) { [int]$overview.approvalsPending } else { 0 }
$eventsLast5m = if ($null -ne $overview.eventsLast5m) { [int]$overview.eventsLast5m } else { 0 }
$errorRateLast5m = if ($null -ne $overview.errorRateLast5m) { [double]$overview.errorRateLast5m } else { 0 }

Write-Host "[smoke-admin] activeRuns       = $activeRuns" -ForegroundColor Green
Write-Host "[smoke-admin] approvalsPending = $approvalsPending" -ForegroundColor Green
Write-Host "[smoke-admin] eventsLast5m     = $eventsLast5m" -ForegroundColor Green
Write-Host ("[smoke-admin] errorRateLast5m = {0:P2}" -f $errorRateLast5m) -ForegroundColor Green
Write-Host "[smoke-admin] launch          = $FrontendBaseUrl/admin" -ForegroundColor Green

if ($OpenBrowser -and -not $NoBrowser) {
  Start-Process "$FrontendBaseUrl/admin"
}
