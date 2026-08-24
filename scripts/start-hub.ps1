# Start the agency Hub dashboard (contacts + campaigns)
# Usage: .\scripts\start-hub.ps1

Set-Location "$PSScriptRoot\..\apps\hub"
if (-not (Test-Path "node_modules")) {
  npm install
}
Write-Host "JAB Hub dashboard → http://127.0.0.1:3000"
Write-Host "Password: HUB_ADMIN_PASSWORD from .env (default jab-hub-admin)"
node server.mjs
