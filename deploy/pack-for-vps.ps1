# Prepare cutover from this Windows lab to a VPS.
# Usage:
#   .\deploy\pack-for-vps.ps1 -VpsIp 1.2.3.4 -SshUser root
param(
  [Parameter(Mandatory = $true)]
  [string]$VpsIp,

  [Parameter(Mandatory = $false)]
  [string]$SshUser = "root",

  [Parameter(Mandatory = $false)]
  [string]$RemoteDir = "~/jab-hub"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host ""
Write-Host "=== JAB Hub → VPS cutover commands ==="
Write-Host "VPS: ${SshUser}@${VpsIp}"
Write-Host ""
Write-Host "1) Copy project:"
Write-Host "   scp -r `"$Root`" ${SshUser}@${VpsIp}:${RemoteDir}"
Write-Host ""
Write-Host "2) SSH and install:"
Write-Host "   ssh ${SshUser}@${VpsIp}"
Write-Host "   cd jab-hub"
Write-Host "   sudo VPS_IP=$VpsIp bash deploy/install.sh"
Write-Host ""
Write-Host "3) Copy OpenClaw keys (after install creates jabhub user):"
Write-Host "   scp -r `"$env:USERPROFILE\.openclaw`" jabhub@${VpsIp}:/home/jabhub/.openclaw"
Write-Host "   ssh ${SshUser}@${VpsIp} `"chown -R jabhub:jabhub /home/jabhub/.openclaw && systemctl restart jab-openclaw-gateway jab-hub-bridge`""
Write-Host ""
Write-Host "4) On VPS: create instance + QR + verify"
Write-Host "   cd /opt/jab-hub"
Write-Host "   sudo -u jabhub bash deploy/create-instance.sh jab-whatsapp"
Write-Host "   sudo -u jabhub bash deploy/get-qr.sh jab-whatsapp"
Write-Host "   bash deploy/verify.sh"
Write-Host ""
Write-Host "5) Copy QR home and scan:"
Write-Host "   scp ${SshUser}@${VpsIp}:/tmp/jab-whatsapp-qr.png .\qr.png"
Write-Host ""
Write-Host "Full guide: deploy\DEPLOY.md"
Write-Host ""

$out = Join-Path $Root "deploy\CUTOVER-COMMANDS.txt"
@(
  "VPS=$VpsIp USER=$SshUser",
  "scp -r `"$Root`" ${SshUser}@${VpsIp}:${RemoteDir}",
  "ssh ${SshUser}@${VpsIp}",
  "cd jab-hub && sudo VPS_IP=$VpsIp bash deploy/install.sh",
  "scp -r `"$env:USERPROFILE\.openclaw`" jabhub@${VpsIp}:/home/jabhub/.openclaw",
  "ssh ${SshUser}@${VpsIp} `"chown -R jabhub:jabhub /home/jabhub/.openclaw && systemctl restart jab-openclaw-gateway jab-hub-bridge`"",
  "cd /opt/jab-hub && sudo -u jabhub bash deploy/create-instance.sh jab-whatsapp",
  "sudo -u jabhub bash deploy/get-qr.sh jab-whatsapp",
  "bash deploy/verify.sh",
  "scp ${SshUser}@${VpsIp}:/tmp/jab-whatsapp-qr.png .\qr.png"
) | Set-Content -Path $out -Encoding UTF8

Write-Host "Saved: $out"
