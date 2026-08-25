#!/bin/bash
# Install appliance OS packages on Ubuntu Server. Safe to rerun.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg nginx ufw openssh-server chrony rsync \
  xserver-xorg xinit openbox dbus-x11 xvfb snapd \
  logrotate dnsutils iproute2 openssl

install_node22() {
  local major
  if command -v node >/dev/null 2>&1; then
    major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
    if [[ "${major:-0}" -ge 22 ]]; then
      echo "Node.js $(node --version) already installed"
      return 0
    fi
  fi
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
}

install_chromium() {
  local bin=""
  if command -v chromium >/dev/null 2>&1; then
    bin="$(command -v chromium)"
  elif command -v chromium-browser >/dev/null 2>&1; then
    bin="$(command -v chromium-browser)"
  elif [[ -x /snap/bin/chromium ]]; then
    bin=/snap/bin/chromium
  fi

  if [[ -z "$bin" ]]; then
    if apt-get install -y --no-install-recommends chromium 2>/dev/null; then
      bin="$(command -v chromium || true)"
    elif apt-get install -y --no-install-recommends chromium-browser 2>/dev/null; then
      bin="$(command -v chromium-browser || true)"
    elif command -v snap >/dev/null 2>&1; then
      snap install chromium
      bin=/snap/bin/chromium
    fi
  fi

  if [[ -z "$bin" ]]; then
    echo "WARN: Chromium package not found for this Ubuntu/arch. Kiosk will fail until Chromium is installed." >&2
    return 0
  fi

  mkdir -p /etc/zasya/railway
  printf '%s\n' "$bin" > /etc/zasya/railway/chromium-bin
  chmod 0644 /etc/zasya/railway/chromium-bin
  echo "Chromium binary: $bin"
}

install_node22
install_chromium

systemctl enable chrony nginx
systemctl disable --now bluetooth cups avahi-daemon 2>/dev/null || true
