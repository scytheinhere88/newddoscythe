#!/usr/bin/env bash
# =============================================================================
# Resilience Testing Dashboard — Auto Installer for Ubuntu 22.04
#
# Usage (as root):
#   git clone https://github.com/USER/REPO.git
#   cd REPO
#   sudo ./install.sh
#
# Re-runnable & idempotent.
# =============================================================================
set -eo pipefail

# --- Config (override via env) -----------------------------------------------
INSTALL_DIR_DEFAULT="/opt/resilience-lab"
INSTALL_DIR="${INSTALL_DIR:-}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@resilience.lab}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
REPO_URL="${REPO_URL:-}"
SKIP_NGINX="${SKIP_NGINX:-0}"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"
K6_VERSION="${K6_VERSION:-v0.55.2}"

# --- Colors ------------------------------------------------------------------
GREEN='\033[1;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; CYAN='\033[1;36m'; NC='\033[0m'
log()   { printf "${GREEN}[ok]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!!]${NC} %s\n" "$*"; }
err()   { printf "${RED}[xx]${NC} %s\n" "$*"; }
step()  { printf "\n${CYAN}=== %s ===${NC}\n" "$*"; }

[ "$(id -u)" -eq 0 ] || { err "Run as root (sudo ./install.sh)"; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  K6_ARCH="amd64" ;;
  aarch64) K6_ARCH="arm64" ;;
  *) err "Unsupported arch: $ARCH"; exit 1 ;;
esac

# --- 1. Source code (auto-detect: run from inside repo, or clone) -----------
step "1/9  Source code"

# Auto-detect: are we currently inside the source repo?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ]; then
  INSTALL_DIR="${INSTALL_DIR:-$SCRIPT_DIR}"
  log "Detected source in $INSTALL_DIR (running from inside repo)"
elif [ -n "$REPO_URL" ]; then
  INSTALL_DIR="${INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating existing checkout at $INSTALL_DIR"
    cd "$INSTALL_DIR" && git pull --rebase || warn "git pull failed; continuing"
  else
    apt-get update -qq && apt-get install -y -qq git
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
else
  err "No source code found."
  err "Either run this script from inside a cloned repo (which contains backend/ + frontend/),"
  err "or set REPO_URL: REPO_URL=https://github.com/user/repo.git ./install.sh"
  exit 1
fi
cd "$INSTALL_DIR"
log "Using source dir: $INSTALL_DIR"

# --- 2. System packages ------------------------------------------------------
step "2/9  System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Try requested python first, fall back to python3 if not present
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
  apt-get update -qq
  if ! apt-get install -y -qq "$PYTHON_BIN" "${PYTHON_BIN}-venv" "${PYTHON_BIN}-dev"; then
    warn "$PYTHON_BIN not available — falling back to system python3"
    PYTHON_BIN="python3"
  fi
fi

apt-get install -y -qq \
  curl wget gnupg ca-certificates lsb-release \
  build-essential pkg-config \
  software-properties-common \
  nginx iproute2 net-tools jq unzip openssl \
  "$PYTHON_BIN" "${PYTHON_BIN}-venv" "${PYTHON_BIN}-dev" python3-pip \
  || warn "Some packages may already be installed"
log "Base packages installed ($PYTHON_BIN $(${PYTHON_BIN} --version 2>&1 | awk '{print $2}'))"

# --- 3. Node.js 20 + Yarn ----------------------------------------------------
step "3/9  Node.js 20 + Yarn"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 18 ]; then NEED_NODE=0; fi
fi
if [ "$NEED_NODE" = "1" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
npm install -g yarn >/dev/null 2>&1 || true
log "Node $(node -v) · Yarn $(yarn -v 2>/dev/null || echo missing)"

# --- 4. MongoDB 7 ------------------------------------------------------------
step "4/9  MongoDB 7"
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
    gpg -o /usr/share/keyrings/mongodb-7.gpg --dearmor --yes
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-7.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-7.list
  apt-get update -qq
  apt-get install -y -qq mongodb-org
fi
systemctl enable mongod >/dev/null 2>&1 || true
systemctl start mongod
sleep 2
if mongosh --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
  log "MongoDB up"
else
  err "MongoDB failed to start"
  journalctl -u mongod -n 30 --no-pager
  exit 1
fi

# --- 5. k6 -------------------------------------------------------------------
step "5/9  k6 $K6_VERSION ($K6_ARCH)"
if ! command -v k6 >/dev/null 2>&1 || ! k6 version 2>/dev/null | grep -q "$K6_VERSION"; then
  curl -fsSL "https://github.com/grafana/k6/releases/download/$K6_VERSION/k6-$K6_VERSION-linux-$K6_ARCH.tar.gz" -o /tmp/k6.tgz
  tar -xzf /tmp/k6.tgz -C /tmp/
  mv "/tmp/k6-$K6_VERSION-linux-$K6_ARCH/k6" /usr/local/bin/k6
  chmod +x /usr/local/bin/k6
  rm -rf /tmp/k6.tgz "/tmp/k6-$K6_VERSION-linux-$K6_ARCH"
fi
log "k6 $(k6 version 2>&1 | head -1)"

# --- 6. Backend setup --------------------------------------------------------
step "6/9  Backend (FastAPI venv)"
cd "$INSTALL_DIR/backend"
if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip wheel
pip install --quiet -r requirements.txt
deactivate
log "Python deps installed"

# .env
if [ ! -f .env ]; then
  GEN_PW="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '+/=\n' | cut -c1-20)}"
  GEN_JWT="$(openssl rand -hex 32)"
  cat > .env <<EOF
MONGO_URL="mongodb://localhost:27017"
DB_NAME="resilience_db"
CORS_ORIGINS="*"
JWT_SECRET="$GEN_JWT"
ADMIN_EMAIL="$ADMIN_EMAIL"
ADMIN_PASSWORD="$GEN_PW"
MAX_RPS="200000"
MAX_DURATION_SEC="900"
MAX_VUS="20000"
EOF
  echo "$GEN_PW" > /root/.resilience_admin_password
  chmod 600 /root/.resilience_admin_password
  log "Wrote $INSTALL_DIR/backend/.env  (admin password saved to /root/.resilience_admin_password)"
else
  log "Reusing existing .env"
fi

# --- 7. systemd service ------------------------------------------------------
step "7/9  systemd service (resilience-backend)"
VENV_PY="$INSTALL_DIR/backend/.venv/bin/python"
[ -L "$VENV_PY" ] && VENV_PY="$(readlink -f "$VENV_PY")"

cat > /etc/systemd/system/resilience-backend.service <<EOF
[Unit]
Description=Resilience Testing Dashboard - FastAPI Backend
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$INSTALL_DIR/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=3
LimitNOFILE=1000000
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_CHOWN CAP_DAC_OVERRIDE CAP_SETUID CAP_SETGID CAP_NET_BIND_SERVICE
StandardOutput=append:/var/log/resilience-backend.log
StandardError=append:/var/log/resilience-backend.log

[Install]
WantedBy=multi-user.target
EOF

setcap cap_net_admin,cap_net_raw+eip "$VENV_PY" 2>/dev/null || \
  warn "setcap failed (IPv6 rotation still works because service runs as root via systemd)"

systemctl daemon-reload
systemctl enable resilience-backend >/dev/null
systemctl restart resilience-backend
sleep 4
if curl -sf http://127.0.0.1:8001/api/ >/dev/null; then
  log "Backend running on 127.0.0.1:8001"
else
  err "Backend failed to start. Last 50 lines of log:"
  tail -n 50 /var/log/resilience-backend.log || true
  exit 1
fi

# --- 8. Frontend build -------------------------------------------------------
step "8/9  Frontend build"
cd "$INSTALL_DIR/frontend"
PUBLIC_IP="$(curl -s --max-time 4 ifconfig.io || curl -s --max-time 4 api.ipify.org || hostname -I | awk '{print $1}')"
if [ -n "$DOMAIN" ]; then
  PUBLIC_URL="https://$DOMAIN"
else
  PUBLIC_URL="http://$PUBLIC_IP"
fi
echo "REACT_APP_BACKEND_URL=$PUBLIC_URL" > .env

if [ ! -d node_modules ]; then
  yarn install --network-timeout 600000
else
  yarn install --network-timeout 600000 >/dev/null 2>&1 || yarn install --network-timeout 600000
fi
yarn build
log "Frontend built. PUBLIC_URL=$PUBLIC_URL"

# --- 9. Nginx ---------------------------------------------------------------
if [ "$SKIP_NGINX" != "1" ]; then
  step "9/9  Nginx reverse proxy"
  cat > /etc/nginx/sites-available/resilience <<NGINX_EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN:-_};

    root $INSTALL_DIR/frontend/build;
    index index.html;

    client_max_body_size 10M;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX_EOF
  ln -sf /etc/nginx/sites-available/resilience /etc/nginx/sites-enabled/resilience
  rm -f /etc/nginx/sites-enabled/default
  if nginx -t; then
    systemctl reload nginx || systemctl restart nginx
    log "Nginx configured"
  else
    err "Nginx config test failed"
    exit 1
  fi
fi

# --- Kernel tuning -----------------------------------------------------------
cat > /etc/sysctl.d/99-resilience.conf <<EOF
fs.file-max = 1000000
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 30000
net.ipv4.tcp_max_syn_backlog = 30000
EOF
sysctl --system >/dev/null 2>&1 || true

# --- Summary -----------------------------------------------------------------
echo ""
echo "==========================================================================="
log "Resilience Testing Dashboard installed successfully"
echo ""
echo "  Dashboard URL : $PUBLIC_URL"
echo "  Admin email   : $ADMIN_EMAIL"
if [ -f /root/.resilience_admin_password ]; then
  echo "  Admin password: $(cat /root/.resilience_admin_password)"
fi
echo ""
echo "  Logs          : tail -f /var/log/resilience-backend.log"
echo "  Service       : systemctl status resilience-backend"
echo "  Restart       : systemctl restart resilience-backend"
echo ""
echo "  IPv6 capability check:"
echo "    curl -s http://127.0.0.1:8001/api/ "
echo "    (login first via dashboard, then check /api/system/ipv6)"
echo "==========================================================================="
