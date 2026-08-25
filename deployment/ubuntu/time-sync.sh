#!/bin/bash
# Set IST (Asia/Kolkata, UTC+5:30) and NTP via chrony. Safe to rerun.
set -euo pipefail

TZ_NAME="Asia/Kolkata"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if ! command -v timedatectl >/dev/null 2>&1; then
  echo "WARN: timedatectl missing; skip timezone/NTP" >&2
  exit 0
fi

echo "==> Timezone ${TZ_NAME} (UTC+5:30)"
timedatectl set-timezone "$TZ_NAME"

# Avoid two NTP clients fighting. Do not use timedatectl set-ntp (it can
# re-enable systemd-timesyncd and leave NTPSynchronized=no while chrony is fine).
systemctl disable --now systemd-timesyncd 2>/dev/null || true

if ! command -v chronyd >/dev/null 2>&1 && ! command -v chrony >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chrony
fi

mkdir -p /etc/chrony/conf.d
cat > /etc/chrony/conf.d/zasya-india.conf <<'EOF'
# Indian Railways appliance — prefer the Indian NTP pool.
server 0.in.pool.ntp.org iburst
server 1.in.pool.ntp.org iburst
server 2.in.pool.ntp.org iburst
server 3.in.pool.ntp.org iburst
makestep 1.0 3
EOF
chmod 0644 /etc/chrony/conf.d/zasya-india.conf

systemctl enable chrony 2>/dev/null || systemctl enable chronyd 2>/dev/null || true
systemctl restart chrony 2>/dev/null || systemctl restart chronyd 2>/dev/null || true
chronyc -a makestep >/dev/null 2>&1 || true

echo "Timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"
echo "Chrony:   $(systemctl is-active chrony 2>/dev/null || systemctl is-active chronyd 2>/dev/null || echo unknown)"
if command -v chronyc >/dev/null 2>&1; then
  chronyc tracking 2>/dev/null | grep -E 'Leap status|Ref time' || true
fi
