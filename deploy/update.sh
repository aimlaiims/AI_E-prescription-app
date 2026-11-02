#!/usr/bin/env bash
# Bring the server up to the latest version on GitHub (run as yourself, not root):
#
#   bash deploy/update.sh
#
# Backs up the database first; the backend applies any database changes when it
# restarts.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
[ "$(id -u)" -ne 0 ] || { echo "Run it as yourself: bash deploy/update.sh"; exit 1; }

echo "== Backup before updating"
sudo systemctl start cvf-backup.service
sudo ls -t /var/backups/cvf | head -1

echo "== Latest code"
git pull --ff-only

echo "== Python packages"
backend/venv/bin/pip install -q -r backend/requirements.txt
if [ -f /etc/systemd/system/cvf-backend.service.d/gpu.conf ]; then
  backend/venv/bin/pip install -q -r backend/requirements-local-whisper-gpu.txt
fi

echo "== Web pages"
(cd frontend && npm ci --no-audit --no-fund --loglevel=error && npm run build)

echo "== Restart"
# Services or Caddy settings changed in this update need: sudo bash deploy/setup.sh
sudo systemctl restart cvf-backend
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/health && echo && echo "Updated." \
  || echo "Not answering. Look at: sudo journalctl -u cvf-backend -n 50"
