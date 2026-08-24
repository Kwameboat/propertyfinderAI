docker logs jabhub_evolution_api --since 15m 2>&1 | grep -iE 'webhook|8787|3000|error|send.*http' | tail -25
journalctl -u jab-hub-bridge --since "10 min ago" --no-pager | tail -15
