# Deploy Resilience Testing Dashboard ke VPS Sendiri

Panduan deploy ke **Ubuntu 22.04 VPS** kamu sendiri (Hetzner / Vultr / DigitalOcean / OVH dll) supaya **IPv6 source rotation jalan beneran**.

> Di environment preview Emergent, IPv6 cuma jalan di **simulation mode** karena container Kubernetes nggak punya `CAP_NET_ADMIN` dan nggak punya IPv6 connectivity. Di VPS sendiri (root + IPv6 /64 subnet), rotation jalan **real** — kamu bisa generate jutaan source IP unique dari 1 VPS aja.

---

## 📋 Prerequisites

1. **VPS Ubuntu 22.04+** dengan root access
2. **IPv6 /64 subnet** (default untuk Hetzner/Vultr/Linode/OVH — gratis)
3. Minimum **2 vCPU / 4 GB RAM** (rekomendasi: 4 vCPU / 8 GB)
4. Domain (opsional, kalau mau pakai HTTPS pakai Caddy/Cloudflare Tunnel)

### Provider yang tested:
- ✅ **Hetzner Cloud** — CPX21 (3 vCPU / 4 GB / 1 IPv4 + /64 IPv6) — €5.83/bulan
- ✅ **Vultr** — High Frequency 2vCPU/4GB ($24/bulan, Jakarta region available)
- ✅ **DigitalOcean** — Premium 4GB ($24/bulan, enable IPv6 in droplet settings)
- ✅ **OVH** — VPS Comfort 4GB (€5.04/bulan)

---

## 🚀 Quick Deploy (single-script)

```bash
# 1. SSH ke VPS kamu sebagai root
ssh root@<your-vps-ip>

# 2. Update + install deps
apt update && apt upgrade -y
apt install -y git curl python3.11 python3.11-venv python3-pip \
                nodejs npm nginx mongodb-org \
                iproute2 net-tools

# 3. Install k6 v0.55
curl -fsSL https://github.com/grafana/k6/releases/download/v0.55.2/k6-v0.55.2-linux-amd64.tar.gz | tar -xz -C /tmp
mv /tmp/k6-v0.55.2-linux-amd64/k6 /usr/local/bin/
chmod +x /usr/local/bin/k6

# 4. Clone the dashboard
mkdir -p /opt && cd /opt
git clone <your-repo-or-zip> resilience-lab
cd resilience-lab

# 5. Backend setup
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — set strong JWT_SECRET, ADMIN_EMAIL/PASSWORD
nano .env

# 6. Start MongoDB + backend (use systemd in real prod)
systemctl enable --now mongod
nohup uvicorn server:app --host 127.0.0.1 --port 8001 > /var/log/resilience-backend.log 2>&1 &

# 7. Frontend build
cd ../frontend
npm install -g yarn
yarn install
echo "REACT_APP_BACKEND_URL=https://your-vps-domain.com" > .env
yarn build

# 8. Nginx reverse proxy
cat > /etc/nginx/sites-available/resilience <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;
    root /opt/resilience-lab/frontend/build;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
ln -sf /etc/nginx/sites-available/resilience /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 9. Verify IPv6 capability
curl -s http://localhost:8001/api/system/ipv6 | python3 -m json.tool
# Expect: mode: "live", subnet: "2a01:4f9:c011:abcd::/64", can_rotate: true
```

---

## ✅ Verify IPv6 Rotation Works

Login ke dashboard → buka **NEW TEST** page → kamu harus liat:

```
// [04] IPV6_SOURCE_ROTATION                          ● LIVE
SUBNET: 2a01:4f9:c011:abcd::/64
IFACE: eth0 · MAX_POOL: 2,000
[x] ENABLE_IPV6_SOURCE_ROTATION   // 500 unique source IPs
```

Enable rotation, deploy test ke website kamu sendiri (yang udah verified), buka access log server target:

```bash
tail -f /var/log/nginx/access.log
```

Kamu bakal liat ratusan IPv6 unique masuk dari `/64` subnet VPS kamu — bukan dari 1 IP doang.

---

## 🛠️ Tuning untuk RPS maksimal

```bash
# /etc/sysctl.d/99-resilience.conf
fs.file-max = 1000000
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv6.conf.all.use_tempaddr = 0
net.ipv6.conf.default.use_tempaddr = 0
net.ipv6.conf.eth0.accept_ra = 2
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 30000
net.ipv4.tcp_max_syn_backlog = 30000

# Apply
sysctl --system

# ulimit for the backend service
echo '* soft nofile 1000000' >> /etc/security/limits.conf
echo '* hard nofile 1000000' >> /etc/security/limits.conf
```

Then restart the backend.

---

## 🔐 Security checklist

- [ ] `.env` JWT_SECRET sudah diganti dari default
- [ ] `ADMIN_PASSWORD` strong (min 16 char, mixed case)
- [ ] Firewall: `ufw allow 22,80,443/tcp` only
- [ ] HTTPS via Let's Encrypt: `certbot --nginx -d your-domain.com`
- [ ] Set CORS_ORIGINS to explicit domain (not `*`)
- [ ] Fail2Ban on SSH + nginx
- [ ] MongoDB bind hanya ke `127.0.0.1`
- [ ] Backup database weekly: `mongodump --out /backup/$(date +%F)`

---

## 🐛 Troubleshooting

### `mode: "simulation"` walaupun udah di VPS
- Pastikan backend dijalankan sebagai **root** atau dengan `CAP_NET_ADMIN`:
  ```bash
  setcap cap_net_admin,cap_net_raw+eip /opt/resilience-lab/backend/.venv/bin/python3.11
  ```
- Verify: `getcap /opt/resilience-lab/backend/.venv/bin/python3.11`

### `mode: "unavailable"` (no IPv6 detected)
- Cek: `ip -6 addr show scope global` — harus ada IPv6 address
- Cek provider VPS: enable IPv6 di control panel (Hetzner/DO/Vultr default ON)
- Re-probe via API: `curl -X POST http://localhost/api/system/ipv6/reprobe`

### IPv6 addresses added tapi server target nggak liat
- Cek default gateway IPv6: `ip -6 route show default`
- Cek firewall outbound: `ip6tables -L OUTPUT -v`
- Test: `curl -6 https://ifconfig.co --interface 2a01:4f9:c011:abcd::dead:beef`

---

## 📊 Capacity per VPS

| VPS spec | Realistic RPS | Max IPv6 source pool |
|---|---|---|
| 1 vCPU / 1 GB | 3,500 | 500 |
| 2 vCPU / 4 GB | 7,000 | 1,000 |
| **4 vCPU / 8 GB** (rec.) | **14,000** | **2,000** |
| 8 vCPU / 16 GB | 28,000 | 2,000 (kernel cap) |

Kalau butuh lebih besar dari ini → **Phase 3 (multi-VPS distributed)**.
