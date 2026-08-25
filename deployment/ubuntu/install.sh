#!/usr/bin/env bash
# One-shot Ubuntu appliance install from a git clone or unzipped GitHub zip.
# Proof of success is nginx on port 80 — not npm start.
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADMIN_PW_FILE=""

cleanup() {
  if [[ -n "$ADMIN_PW_FILE" && -f "$ADMIN_PW_FILE" ]]; then
    rm -f "$ADMIN_PW_FILE"
  fi
}
trap cleanup EXIT

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this installer on Ubuntu Server (the appliance), not on macOS." >&2
  exit 1
fi

LICENCE_JSON="${SOURCE}/keys/licence.json"
LICENCE_PUB="${SOURCE}/keys/licence-public.pem"
if [[ ! -f "$LICENCE_JSON" || ! -f "$LICENCE_PUB" ]]; then
  echo "Sample licence missing. Expected:" >&2
  echo "  $LICENCE_JSON" >&2
  echo "  $LICENCE_PUB" >&2
  exit 1
fi
if [[ -f "${SOURCE}/keys/licence-private.pem" ]]; then
  echo "Refuse to install while keys/licence-private.pem is present on the appliance." >&2
  exit 1
fi

echo "==> Installing Ubuntu packages"
bash "${SOURCE}/deployment/ubuntu/packages.sh"

echo "==> Application dependencies and tests"
cd "$SOURCE"
npm install --omit=dev
(cd "${SOURCE}/coach-position" && npm install --omit=dev)
npm test

ADMIN_PW_FILE="$(mktemp /tmp/zasya-admin-XXXXXX)"
chmod 600 "$ADMIN_PW_FILE"
if [[ -s /root/zasya-admin-password ]]; then
  tr -d '\r\n' < /root/zasya-admin-password > "$ADMIN_PW_FILE"
else
  openssl rand -hex 12 > "$ADMIN_PW_FILE"
  install -m 0600 "$ADMIN_PW_FILE" /root/zasya-admin-password
fi

echo "==> railway-setup (BG / Bhongir, sample licence)"
bash "${SOURCE}/deployment/scripts/railway-setup" \
  --non-interactive \
  --source "$SOURCE" \
  --station-code BG \
  --station-name Bhongir \
  --licence "$LICENCE_JSON" \
  --licence-public-key "$LICENCE_PUB" \
  --admin-password-file "$ADMIN_PW_FILE" \
  --grace-hours 24 \
  --kiosk-url http://127.0.0.1/platform/

echo "==> Acceptance (HTTP on :80)"
/usr/local/sbin/railway-acceptance urls
/usr/local/sbin/railway-acceptance services

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$IP" ]] || IP="127.0.0.1"

echo ""
echo "Admin password (also in /root/zasya-admin-password):"
cat /root/zasya-admin-password
echo ""
echo "Open from this Mac / LAN:"
echo "  Platform: http://${IP}/platform/"
echo "  Coach:    http://${IP}/coach/?station=BG&display=entrance-main"
echo "  Admin:    http://${IP}/admin/"
echo "  Health:   http://${IP}/health"
