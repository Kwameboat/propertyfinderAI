# Fetch a fresh WhatsApp QR from Evolution API and open it as a PNG.
# Bypasses the Manager UI (which often shows an empty spinner).
param(
  [Parameter(Mandatory = $false)]
  [string]$InstanceName = "jab-whatsapp",

  [Parameter(Mandatory = $false)]
  [int]$MaxAttempts = 8,

  [Parameter(Mandatory = $false)]
  [int]$RetrySeconds = 3
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Get-EvolutionApiKey {
  $line = Get-Content .env | Where-Object { $_ -match '^AUTHENTICATION_API_KEY=' } | Select-Object -First 1
  if (-not $line) { throw "AUTHENTICATION_API_KEY not found in .env" }
  return ($line -replace '^AUTHENTICATION_API_KEY=', '').Trim()
}

function Invoke-Evo {
  param(
    [string]$Method,
    [string]$Path,
    [string]$ApiKey,
    [object]$Body = $null
  )
  $uri = "http://localhost:8080$Path"
  $headers = @{ apikey = $ApiKey }
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  }
  $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json
}

$apiKey = Get-EvolutionApiKey
$enc = [uri]::EscapeDataString($InstanceName)
$outDir = Join-Path (Get-Location) "tmp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outPng = Join-Path $outDir "$InstanceName-qr.png"

Write-Host "Preparing QR for instance '$InstanceName'..."

# Soft reset: logout if possible, then reconnect for a fresh QR.
try {
  Invoke-Evo -Method DELETE -Path "/instance/logout/$enc" -ApiKey $apiKey | Out-Null
  Write-Host "Logged out previous session."
  Start-Sleep -Seconds 2
} catch {
  Write-Host "Logout skipped (not connected)."
}

try {
  Invoke-Evo -Method PUT -Path "/instance/restart/$enc" -ApiKey $apiKey | Out-Null
  Write-Host "Restart requested."
  Start-Sleep -Seconds 2
} catch {
  try {
    Invoke-Evo -Method POST -Path "/instance/restart/$enc" -ApiKey $apiKey | Out-Null
    Write-Host "Restart requested (POST)."
    Start-Sleep -Seconds 2
  } catch {
    Write-Host "Restart skipped."
  }
}

$qr = $null
for ($i = 1; $i -le $MaxAttempts; $i++) {
  Write-Host "Connect attempt $i/$MaxAttempts..."
  try {
    $qr = Invoke-Evo -Method GET -Path "/instance/connect/$enc" -ApiKey $apiKey
  } catch {
    Write-Host "  connect failed: $($_.Exception.Message)"
    Start-Sleep -Seconds $RetrySeconds
    continue
  }

  if ($qr.base64 -and $qr.base64 -match '^data:image/png;base64,') {
    break
  }

  # Some Evolution responses put QR under nested keys.
  if ($qr.qrcode -and $qr.qrcode.base64) {
    $qr = $qr.qrcode
    if ($qr.base64 -match '^data:image/png;base64,') { break }
  }

  Write-Host "  no QR yet (count=$($qr.count) pairingCode=$($qr.pairingCode))"
  Start-Sleep -Seconds $RetrySeconds
}

if (-not $qr -or -not $qr.base64) {
  throw "Could not get a QR code for '$InstanceName'. Check docker logs jabhub_evolution_api."
}

$b64 = $qr.base64 -replace '^data:image/png;base64,', ''
[IO.File]::WriteAllBytes($outPng, [Convert]::FromBase64String($b64))

Write-Host ""
Write-Host "QR saved: $outPng"
Write-Host "QR count: $($qr.count)"
if ($qr.pairingCode) { Write-Host "Pairing code: $($qr.pairingCode)" }
Write-Host ""
Write-Host "Scan now with WhatsApp > Linked Devices > Link a device"
Start-Process $outPng

# Poll connection state briefly so the user knows when it succeeds.
Write-Host "Waiting up to 90s for connection..."
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  try {
    $state = Invoke-Evo -Method GET -Path "/instance/connectionState/$enc" -ApiKey $apiKey
    $status = $state.instance.state
    if (-not $status) { $status = $state.state }
    Write-Host "  state: $status"
    if ($status -eq "open") {
      Write-Host "CONNECTED."
      exit 0
    }
  } catch {
    Write-Host "  state check failed"
  }
  Start-Sleep -Seconds 5
}

Write-Host "Still not connected after 90s. Re-run: .\scripts\get-qr.ps1 -InstanceName $InstanceName"
exit 1
