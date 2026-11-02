#!/usr/bin/env bash
# First-time setup of the prescription app on Ubuntu 24.04, from the cloned repo:
#
#   sudo bash deploy/setup.sh
#
# Safe to run again (e.g. after installing the NVIDIA driver). What it does:
# packages, an app user, Python + web-page builds, a PostgreSQL database, the
# services (backend, Caddy, nightly backup) and the firewall. It does not set up
# the tunnel (needs your ngrok token: deploy/README.md, step 5).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${SUDO_USER:-}"
step() { printf '\n== %s\n' "$1"; }
die() { printf '\nSTOPPED: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run it with sudo: sudo bash deploy/setup.sh"
[ -n "$OWNER" ] && [ "$OWNER" != root ] || die "run it with sudo from your own account, not as root"
[ -f "$APP_DIR/backend/app/main.py" ] || die "run it from inside the cloned repo"
case "$APP_DIR" in
  /home/*) die "the repo is in a home folder, which the app's service user cannot read.
Clone it to /opt/cvf instead (deploy/README.md, step 2)." ;;
esac

step "Ubuntu packages"
apt-get update -q
apt-get install -y -q python3-venv python3-dev postgresql caddy nodejs npm ufw curl openssl

step "App user 'cvf' (runs the backend; cannot log in)"
id cvf >/dev/null 2>&1 || useradd --system --home-dir /var/lib/cvf --create-home --shell /usr/sbin/nologin cvf
install -d -o cvf -g cvf -m 750 /var/lib/cvf /var/backups/cvf
sudo -u cvf test -r "$APP_DIR/backend/app/main.py" || die "user cvf cannot read $APP_DIR (folder permissions)"

step "Python packages (backend/venv)"
sudo -u "$OWNER" python3 -m venv "$APP_DIR/backend/venv"
PIP="$APP_DIR/backend/venv/bin/pip"
sudo -u "$OWNER" "$PIP" install -q --upgrade pip
sudo -u "$OWNER" "$PIP" install -q -r "$APP_DIR/backend/requirements.txt"

GPU=no
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  GPU=yes
  step "NVIDIA GPU found: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
  sudo -u "$OWNER" "$PIP" install -q -r "$APP_DIR/backend/requirements-local-whisper-gpu.txt"
  # cuBLAS / cuDNN come as pip packages; the service must find their libraries.
  LIBS=$("$APP_DIR/backend/venv/bin/python" -c "import nvidia.cublas, nvidia.cudnn; print(':'.join(list(m.__path__)[0] + '/lib' for m in (nvidia.cublas, nvidia.cudnn)))")
  install -d /etc/systemd/system/cvf-backend.service.d
  printf '[Service]\nEnvironment=LD_LIBRARY_PATH=%s\n' "$LIBS" > /etc/systemd/system/cvf-backend.service.d/gpu.conf
elif lspci 2>/dev/null | grep -qi nvidia; then
  echo "An NVIDIA card is present but its driver is not installed. For speech on this"
  echo "machine: sudo ubuntu-drivers install && sudo reboot, then run this script again."
fi

step "Web pages (frontend/dist)"
sudo -u "$OWNER" bash -c "cd '$APP_DIR/frontend' && npm ci --no-audit --no-fund --loglevel=error && npm run build"
sudo -u caddy test -r "$APP_DIR/frontend/dist/index.html" || die "Caddy cannot read $APP_DIR/frontend/dist"

step "PostgreSQL database 'cvf'"
ENV_FILE="$APP_DIR/backend/.env"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='cvf'" | grep -q 1; then
  echo "Already exists (its address is in $ENV_FILE)."
else
  PW=$(openssl rand -hex 24)
  sudo -u postgres psql -q -c "CREATE ROLE cvf LOGIN PASSWORD '$PW'"
  sudo -u postgres createdb -O cvf cvf
  # The port PostgreSQL really uses (5432 unless another PostgreSQL had it first).
  PGPORT=$(sudo -u postgres psql -tAc "SHOW port" | tr -d '[:space:]')
  URL="postgresql://cvf:$PW@localhost:$PGPORT/cvf"
  if [ -f "$ENV_FILE" ]; then
    if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
      sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$URL#" "$ENV_FILE"
    else
      printf '\nDATABASE_URL=%s\n' "$URL" >> "$ENV_FILE"
    fi
    echo "Created, and DATABASE_URL in backend/.env now points to it."
  else
    install -m 600 /dev/null /var/lib/cvf/database-url
    echo "DATABASE_URL=$URL" > /var/lib/cvf/database-url
    echo "Created. backend/.env is missing: copy yours in, then add the line in"
    echo "/var/lib/cvf/database-url (sudo cat /var/lib/cvf/database-url) and run this script again."
  fi
fi

step "Settings file (backend/.env)"
if [ -f "$ENV_FILE" ]; then
  chown root:cvf "$ENV_FILE"
  chmod 640 "$ENV_FILE"   # secrets: readable by the app only (edit with sudo)
  echo "OK (readable by the app user only)."
else
  echo "MISSING: copy your .env to $ENV_FILE (deploy/README.md, step 3)."
fi

step "Services"
for unit in cvf-backend.service cvf-backup.service cvf-backup.timer; do
  sed "s#@APP_DIR@#$APP_DIR#g" "$APP_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
done
sed "s#@APP_DIR@#$APP_DIR#g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || die "the Caddy configuration is not valid: caddy validate --config /etc/caddy/Caddyfile"
systemctl daemon-reload
systemctl enable --now caddy cvf-backup.timer >/dev/null
systemctl reload caddy
if [ -f "$ENV_FILE" ]; then
  systemctl enable cvf-backend >/dev/null
  systemctl restart cvf-backend
fi

step "Firewall: nothing comes in except SSH (the tunnel connects outwards)"
if dpkg -s openssh-server >/dev/null 2>&1; then
  ufw limit 22/tcp >/dev/null   # SSH, with repeated attempts slowed down
else
  echo "No SSH server installed, so no way in at all (sudo apt install openssh-server to manage it remotely, then run this again)."
fi
ufw --force enable >/dev/null
ufw status | head -6

step "Check"
if [ -f "$ENV_FILE" ]; then
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -fsS http://127.0.0.1:8080/api/health; then
    echo
    echo "The app answers on this machine. Next: the tunnel (deploy/README.md, step 5)."
  else
    echo "The backend is not answering yet. Look at: sudo journalctl -u cvf-backend -n 50"
  fi
fi
if [ "$GPU" = yes ]; then
  echo
  echo "For speech on this GPU, these lines belong in backend/.env (sudo nano $ENV_FILE):"
  echo "  WHISPER_BACKEND=local"
  echo "  LOCAL_WHISPER_MODEL=large-v3"
  echo "  LOCAL_WHISPER_DEVICE=cuda"
  echo "then: sudo systemctl restart cvf-backend"
fi
