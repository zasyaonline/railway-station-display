#!/bin/bash
set -euo pipefail
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
# SSH stays open for Mac/station administration. Password login is controlled by ssh.sh.
if [[ "${RAILWAY_ALLOW_SSH:-1}" == "1" ]]; then
  ufw allow OpenSSH
fi
ufw --force enable
