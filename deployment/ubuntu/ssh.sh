#!/bin/bash
# Harden SSH. Does not disable password login unless keys are present
# or RAILWAY_SSH_HARDEN=1 (after authorized_keys is installed).
set -euo pipefail
SSHD=/etc/ssh/sshd_config
if [[ ! -f "$SSHD" ]]; then
  echo "sshd_config missing" >&2
  exit 0
fi

has_keys=0
if [[ -s /home/zasya/.ssh/authorized_keys ]] || [[ -s /root/.ssh/authorized_keys ]]; then
  has_keys=1
fi

sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD"
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD"

if [[ "${RAILWAY_SSH_HARDEN:-0}" == "1" || "$has_keys" == "1" ]]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD"
else
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' "$SSHD"
  echo "SSH password authentication left enabled (no authorized_keys / RAILWAY_SSH_HARDEN!=1)"
fi

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
