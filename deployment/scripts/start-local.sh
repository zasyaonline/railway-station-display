#!/usr/bin/env bash
# Start the Railway Local MVP on this machine (no systemd/nginx).
# Usage: bash deployment/scripts/start-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ETC="${ZASYA_RAILWAY_ETC:-$ROOT/.zasya/etc}"
DATA="${ZASYA_RAILWAY_ROOT:-$ROOT/.zasya/data}"
LOG="${ZASYA_RAILWAY_LOG:-$ROOT/.zasya/log}"
STATION_CODE="${STATION_CODE:-BG}"
STATION_NAME="${STATION_NAME:-Bhongir}"
ADMIN_PASS="${ADMIN_PASS:-local-dev-admin}"
TODAY="$(date -u +%Y-%m-%d)"
UNTIL="$(date -u -v+1y +%Y-%m-%d 2>/dev/null || date -u -d '+1 year' +%Y-%m-%d)"

mkdir -p "$ETC" "$DATA"/{runtime,config,licence,platform,coach,backup,audit} "$LOG" "$ROOT/.zasya/keys"

if [[ ! -d "$ROOT/node_modules" ]]; then
  npm install --silent
fi
if [[ ! -d "$ROOT/coach-position/node_modules" ]]; then
  (cd "$ROOT/coach-position" && npm install --silent)
fi

if [[ ! -f "$ROOT/.zasya/keys/licence-private.pem" ]]; then
  node "$ROOT/deployment/scripts/licence-issue.js" --gen-keys --out-dir "$ROOT/.zasya/keys"
fi

cp "$ROOT/.zasya/keys/licence-public.pem" "$ETC/licence-public.pem"

ZASYA_RAILWAY_ETC="$ETC" node "$ROOT/deployment/scripts/write-station-files.js" \
  --station-code "$STATION_CODE" \
  --station-name "$STATION_NAME" \
  --ntes-endpoint "https://enquiry.indianrail.gov.in/crisns/AppServAnd" \
  --ntes-user "" \
  --ntes-pass "" \
  --grace "24" \
  --kiosk "http://127.0.0.1:3000/platform/"

node "$ROOT/deployment/scripts/licence-issue.js" \
  --station "$STATION_CODE" \
  --valid-from "$TODAY" \
  --valid-until "$UNTIL" \
  --key "$ROOT/.zasya/keys/licence-private.pem" \
  --out "$ETC/licence.json" \
  --id "ZSY-LOCAL-${STATION_CODE}"

ZASYA_RAILWAY_ETC="$ETC" ZASYA_RAILWAY_ROOT="$DATA" \
  node -e "require('./edge/admin/auth').saveAdminSecret(process.argv[1])" "$ADMIN_PASS"

export RAILWAY_APPLIANCE=1
export ZASYA_RAILWAY_ETC="$ETC"
export ZASYA_RAILWAY_ROOT="$DATA"
export ZASYA_RAILWAY_LOG="$LOG"
export BIND_HOST=127.0.0.1
export PORT

echo "Local appliance dirs:"
echo "  etc  $ETC"
echo "  data $DATA"
echo "  log  $LOG"
echo "Admin password: $ADMIN_PASS"
echo ""
echo "URLs (no nginx on laptop):"
echo "  Platform  http://127.0.0.1:3000/platform/"
echo "  Coach     http://127.0.0.1:3001/coach/chart.html?station=${STATION_CODE}&display=entrance-main"
echo "  Admin     http://127.0.0.1:3002/admin/"
echo "  Verify    http://127.0.0.1:3002/admin/verify.html"
echo "  Health    http://127.0.0.1:3002/health"
echo ""
echo "Starting NTES, Platform, Coach, Admin…"
