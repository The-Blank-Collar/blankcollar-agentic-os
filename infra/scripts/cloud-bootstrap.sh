#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — cloud-bootstrap.sh
# -----------------------------------------------------------------------------
# One-shot setup script. Runs ON THE HETZNER SERVER (not your laptop) the
# first time you SSH in. Brings the server from "fresh Ubuntu 24.04" to
# "Coolify is up and ready to deploy our compose stack."
#
# Idempotent: safe to re-run if anything fails partway through.
#
# Usage (FROM ON THE SERVER, not your laptop):
#     curl -fsSL https://raw.githubusercontent.com/The-Blank-Collar/blankcollar-agentic-os/main/infra/scripts/cloud-bootstrap.sh | sudo bash
#   …or if you've already cloned the repo on the server:
#     sudo bash ./infra/scripts/cloud-bootstrap.sh
#
# What it does (in order):
#   1. apt update + upgrade  (security patches)
#   2. Adds a 4 GB swap file (insurance against memory bursts on the 8 GB box)
#   3. Configures the UFW firewall:
#        - 22/tcp   SSH       (so you can keep getting in)
#        - 80/tcp   HTTP      (Coolify's Caddy issues + serves Let's Encrypt)
#        - 443/tcp  HTTPS     (Coolify's Caddy serves the apps)
#        - 8000/tcp Coolify   (the Coolify admin UI itself)
#   4. Installs fail2ban (auto-bans IPs that brute-force SSH)
#   5. Installs Docker via Docker's official one-liner
#   6. Installs Coolify via Coolify's official one-liner
#   7. Prints the next steps + the URL you'll visit in your browser
#
# Total runtime: ~3–5 minutes on a CPX31, almost entirely the Coolify install.
# -----------------------------------------------------------------------------
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "✗ this script must be run as root (use 'sudo bash …')" >&2
  exit 1
fi

step() {
  echo
  echo "─── $* ────────────────────────────────────────────────────────────"
}

# -----------------------------------------------------------------------------
# 1. apt update + upgrade
# -----------------------------------------------------------------------------
step "1/7  apt update + upgrade (security patches)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates ufw fail2ban unattended-upgrades

# Future security patches install themselves overnight without rebooting.
dpkg-reconfigure -f noninteractive unattended-upgrades

# -----------------------------------------------------------------------------
# 2. Swap (4 GB) — insurance against bursts on the 8 GB box
# -----------------------------------------------------------------------------
step "2/7  Adding 4 GB swap file (if not already present)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q "^/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
  echo "  ✓ 4 GB swap added + persisted in /etc/fstab"
else
  echo "  · /swapfile already exists; skipping"
fi
# Lower swappiness so swap is used as a safety net, not first-line storage.
if ! grep -q "^vm.swappiness" /etc/sysctl.conf; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
  sysctl -p >/dev/null
fi

# -----------------------------------------------------------------------------
# 3. UFW firewall
# -----------------------------------------------------------------------------
step "3/7  Firewall — UFW (default-deny, allow 22 + 80 + 443 + 8000)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Coolify Caddy)'
ufw allow 443/tcp comment 'HTTPS (Coolify Caddy)'
ufw allow 8000/tcp comment 'Coolify admin UI'
ufw --force enable
ufw status verbose

# -----------------------------------------------------------------------------
# 4. fail2ban
# -----------------------------------------------------------------------------
step "4/7  fail2ban — auto-ban SSH brute-force"
systemctl enable --now fail2ban
fail2ban-client status sshd 2>/dev/null || true

# -----------------------------------------------------------------------------
# 5. Docker (official one-liner)
# -----------------------------------------------------------------------------
step "5/7  Docker — install via official get.docker.com"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "  ✓ docker installed: $(docker --version)"
else
  echo "  · docker already installed: $(docker --version)"
fi

# -----------------------------------------------------------------------------
# 6. Coolify (official one-liner)
# -----------------------------------------------------------------------------
step "6/7  Coolify — install via official installer"
if [[ ! -d /data/coolify ]]; then
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
else
  echo "  · /data/coolify already present; skipping installer"
fi

# -----------------------------------------------------------------------------
# 7. Next steps
# -----------------------------------------------------------------------------
PUBLIC_IP="$(curl -fsSL https://ipv4.icanhazip.com 2>/dev/null || echo '<your-server-ip>')"

step "7/7  Done. Next steps"
cat <<EOF

✓ Server is bootstrapped.

Open Coolify in your browser:

    http://${PUBLIC_IP}:8000

The first time you load that page, Coolify asks you to create the admin
account. Pick a strong password — that's how you'll log in from now on.

Once you're in, follow docs/HETZNER_DEPLOY.md from "Stage 4 — Coolify
admin" onward. The repo is already public on GitHub, so the only
remaining task on the server is wiring Coolify to deploy from it.

EOF
