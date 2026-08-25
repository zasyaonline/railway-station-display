#!/bin/bash
set -euo pipefail
export HOME="${HOME:-/home/zasya-kiosk}"
URL="${1:-http://127.0.0.1/platform/}"
BIN="${CHROMIUM_BIN:-}"
if [[ -z "$BIN" && -f /etc/zasya/railway/chromium-bin ]]; then
  BIN="$(tr -d '[:space:]' < /etc/zasya/railway/chromium-bin)"
fi
if [[ -z "$BIN" ]]; then
  BIN="$(command -v chromium || command -v chromium-browser || true)"
fi
if [[ -z "$BIN" ]]; then
  echo "chromium not installed" >&2
  exit 1
fi
PROFILE="${CHROMIUM_USER_DATA:-$HOME/chromium-profile}"
mkdir -p "$PROFILE"
exec "$BIN" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 --disable-features=TranslateUI \
  --disable-gpu --disable-dev-shm-usage --no-first-run --no-sandbox \
  --user-data-dir="$PROFILE" "$URL"
