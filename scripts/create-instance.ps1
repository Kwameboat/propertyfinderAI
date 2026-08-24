# Create a clean Baileys WhatsApp instance on local Evolution API.
# Hardened defaults:
# - no trailing spaces in name
# - no phone number on create (number forces flaky pairing and blank Manager QR)
# - always request QR
# - optionally register OpenClaw bridge webhook
param(
  [Parameter(Mandatory = $false, Position = 0)]
  [string]$InstanceName = "jab-whatsapp",

  [Parameter(Mandatory = $false)]
  [switch]$SkipWebhook,

  [Parameter(Mandatory = $false)]
  [switch]$OpenQr
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$InstanceName = $InstanceName.Trim()
if ([string]::IsNullOrWhiteSpace($InstanceName)) {
  throw "InstanceName cannot be empty."
}
if ($InstanceName -match '\s$|^\s') {
  throw "InstanceName cannot start/end with whitespace."
}
if ($InstanceName -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]{0,48}[A-Za-z0-9]$' -and $InstanceName.Length -gt 1) {
  # Allow short single-token names too.
  if ($InstanceName -notmatch '^[A-Za-z0-9_-]+$') {
    throw "Use a simple instance name (letters, numbers, spaces, _ or -)."
  }
}

function Get-EnvValue([string]$Key) {
  $line = Get-Content .env | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$Key=", "").Trim()
}

$apiKey = Get-EnvValue "AUTHENTICATION_API_KEY"
if (-not $apiKey) { throw "AUTHENTICATION_API_KEY not found in .env" }

$enc = [uri]::EscapeDataString($InstanceName)

# If it already exists, do not recreate blindly.
try {
  $existing = Invoke-RestMethod -Method GET -Uri "http://localhost:8080/instance/fetchInstances" -Headers @{ apikey = $apiKey }
  $list = @()
  if ($existing -is [System.Array]) { $list = $existing }
  elseif ($existing.value) { $list = $existing.value }
  elseif ($existing) { $list = @($existing) }

  $match = $list | Where-Object { $_.name -eq $InstanceName } | Select-Object -First 1
  if ($match) {
    Write-Host "Instance '$InstanceName' already exists (status=$($match.connectionStatus))."
    Write-Host "Use: .\scripts\get-qr.ps1 -InstanceName `"$InstanceName`""
    if ($OpenQr) {
      & "$PSScriptRoot\get-qr.ps1" -InstanceName $InstanceName
    }
    exit 0
  }
} catch {
  Write-Host "Could not list instances first: $($_.Exception.Message)"
}

$body = @{
  instanceName = $InstanceName
  qrcode       = $true
  integration  = "WHATSAPP-BAILEYS"
} | ConvertTo-Json

Write-Host "Creating instance '$InstanceName' (QR mode, no phone number)..."
$result = Invoke-RestMethod -Method POST -Uri "http://localhost:8080/instance/create" `
  -Headers @{ apikey = $apiKey } `
  -ContentType "application/json" `
  -Body $body

$metaPath = Join-Path $PSScriptRoot "last-instance.json"
$result | ConvertTo-Json -Depth 10 | Set-Content -Path $metaPath -Encoding UTF8
Write-Host "Saved response: $metaPath"

$instanceToken = $null
if ($result.hash) { $instanceToken = $result.hash }
elseif ($result.instance -and $result.instance.token) { $instanceToken = $result.instance.token }
elseif ($result.token) { $instanceToken = $result.token }

Write-Host ""
Write-Host "Instance created."
if ($instanceToken) {
  Write-Host "Instance token: $instanceToken"
  Write-Host "Set this as EVO_API_KEY / EVO_INSTANCE in OpenClaw when ready."
}

if (-not $SkipWebhook) {
  $hookToken = $null
  $ocPath = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
  if (Test-Path $ocPath) {
    $oc = Get-Content $ocPath -Raw | ConvertFrom-Json
    $hookToken = $oc.hooks.token
  }

  if ($hookToken -and $instanceToken) {
    Write-Host "Registering webhook -> http://host.docker.internal:8787/evolution"
    $webhookBody = @{
      webhook = @{
        enabled = $true
        url     = "http://host.docker.internal:8787/evolution"
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
        -Headers @{ apikey = $instanceToken } `
        -ContentType "application/json" `
        -Body $webhookBody | Out-Null
      Write-Host "Webhook registered."
    } catch {
      Write-Host "Webhook registration failed: $($_.Exception.Message)"
    }
  } else {
    Write-Host "Skipping webhook (missing hooks.token or instance token)."
  }
}

Write-Host ""
Write-Host "Open Manager only for status: http://localhost:8080/manager"
Write-Host "For QR, prefer: .\scripts\get-qr.ps1 -InstanceName `"$InstanceName`""

if ($OpenQr) {
  & "$PSScriptRoot\get-qr.ps1" -InstanceName $InstanceName
}
