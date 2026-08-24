# Wire every Evolution instance to the OpenClaw bridge webhook.
# Safe to re-run: skips instances already pointing at the bridge URL.
param(
  [string]$BridgeUrl = "http://host.docker.internal:8787/evolution"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Get-EnvValue([string]$Key) {
  $line = Get-Content .env | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$Key=", "").Trim()
}

$apiKey = Get-EnvValue "AUTHENTICATION_API_KEY"
if (-not $apiKey) { throw "AUTHENTICATION_API_KEY not found in .env" }

$hookToken = $null
$ocPath = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
if (Test-Path $ocPath) {
  $oc = Get-Content $ocPath -Raw | ConvertFrom-Json
  $hookToken = $oc.hooks.token
}
if (-not $hookToken) { throw "hooks.token missing in ~/.openclaw/openclaw.json" }

$raw = Invoke-RestMethod -Method GET -Uri "http://localhost:8080/instance/fetchInstances" -Headers @{ apikey = $apiKey }
$instances = @()
if ($raw -is [System.Array]) { $instances = $raw }
elseif ($raw.value) { $instances = @($raw.value) }
elseif ($raw.name) { $instances = @($raw) }

if ($instances.Count -eq 0) {
  Write-Host "No Evolution instances found."
  exit 0
}

foreach ($inst in $instances) {
  $name = [string]$inst.name
  $token = [string]$inst.token
  if (-not $name -or -not $token) {
    Write-Host "Skipping incomplete instance record."
    continue
  }

  $enc = [uri]::EscapeDataString($name)
  Write-Host "Wiring '$name' -> $BridgeUrl"

  $body = @{
    webhook = @{
      enabled = $true
      url     = $BridgeUrl
      headers = @{
        Authorization  = "Bearer $hookToken"
        "Content-Type" = "application/json"
      }
      byEvents = $false
      base64   = $false
      events   = @("MESSAGES_UPSERT", "CONNECTION_UPDATE")
    }
  } | ConvertTo-Json -Depth 8

  try {
    Invoke-RestMethod -Method POST -Uri "http://localhost:8080/webhook/set/$enc" `
      -Headers @{ apikey = $token } `
      -ContentType "application/json" `
      -Body $body | Out-Null
    Write-Host "  OK ($($inst.connectionStatus))"
  } catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "Done. New Manager-created instances are also covered by WEBHOOK_GLOBAL_* in .env"
Write-Host "and by the bridge auto-sync loop."
