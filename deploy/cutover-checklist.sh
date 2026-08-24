#!/usr/bin/env bash
# Interactive cutover helper once you have VPS SSH.
# Usage on VPS (as root): bash deploy/cutover-checklist.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== JAB Hub 24/7 cutover checklist ==="
echo ""
echo "[ ] 1. VPS Ubuntu 24.04, 2GB+ RAM, SSH working"
echo "[ ] 2. Project at /opt/jab-hub (or run install from a clone)"
echo "[ ] 3. sudo bash deploy/install.sh   (or VPS_IP=x.x.x.x sudo -E bash deploy/install.sh)"
echo "[ ] 4. Copy OpenClaw from your Windows PC:"
echo "        scp -r %USERPROFILE%\\.openclaw jabhub@VPS_IP:/home/jabhub/.openclaw"
echo "        ssh VPS 'chown -R jabhub:jabhub /home/jabhub/.openclaw'"
echo "[ ] 5. sudo systemctl restart jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard"
echo "[ ] 6. bash deploy/create-instance.sh jab-whatsapp"
echo "[ ] 7. bash deploy/get-qr.sh jab-whatsapp   # scp PNG home and scan"
echo "[ ] 8. bash deploy/verify.sh"
echo "[ ] 9. Send a WhatsApp test message; confirm AI reply"
echo "[ ] 10. Turn off Windows lab — VPS keeps running"
echo ""
echo "Run verify now? [y/N]"
read -r ans || true
if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
  bash "$ROOT/deploy/verify.sh"
fi
