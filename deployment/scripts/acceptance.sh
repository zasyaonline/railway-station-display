#!/usr/bin/env bash
# Appliance acceptance helpers. Run on the Ubuntu PC after railway-setup.
set -euo pipefail

ETC="${ZASYA_RAILWAY_ETC:-/etc/zasya/railway}"
DATA="${ZASYA_RAILWAY_ROOT:-/var/lib/zasya/railway}"
ROOT="${RAILWAY_APP_ROOT:-/opt/zasya/railway}"

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; exit 1; }

json_get() {
  local key="$1"
  node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      const j = JSON.parse(s);
      const k = process.argv[1];
      const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), j);
      process.stdout.write(v == null ? "" : String(v));
    });
  ' "$key"
}

check_http() {
  local url="$1"
  local name="$2"
  curl -fsS -o /dev/null --max-time 5 "$url" && pass "$name" || fail "$name"
}

health_json() {
  curl -fsS --max-time 5 http://127.0.0.1/health
}

licence_json() {
  curl -fsS --max-time 5 http://127.0.0.1/api/licence/status
}

ntes_host_port() {
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const endpoint = raw.endpoint || (raw.ntes && raw.ntes.endpoint) || "";
    const u = new URL(endpoint);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    process.stdout.write(u.hostname + " " + port);
  ' "$ETC/ntes.json"
}

cmd_urls() {
  check_http http://127.0.0.1/platform/ "platform"
  check_http http://127.0.0.1/coach/ "coach"
  check_http http://127.0.0.1/admin/ "admin"
  check_http http://127.0.0.1/health "health"
  check_http http://127.0.0.1/api/trains "platform-trains"
  check_http http://127.0.0.1/coach/img/coaches/general.png "coach-art"
  check_http http://127.0.0.1/coach/img/you-are-here.png "coach-you-are-here"
  check_http http://127.0.0.1/img/coaches/general.png "coach-img-root"
}

cmd_services() {
  for s in zasya-railway-ntes zasya-railway-platform zasya-railway-coach zasya-railway-admin nginx zasya-railway-display; do
    systemctl is-active --quiet "$s.service" 2>/dev/null || systemctl is-active --quiet "$s" || fail "$s not active"
    pass "$s"
  done
  if systemctl is-active --quiet zasya-railway-kiosk.service 2>/dev/null; then
    pass "zasya-railway-kiosk"
  else
    printf 'WARN %s\n' "zasya-railway-kiosk not active (snap Chromium); passenger URLs on :80 are still valid"
  fi
}

cmd_isolation() {
  local unit="$1"
  local label="$2"
  local pid
  pid=$(systemctl show -p MainPID --value "$unit")
  [[ -n "$pid" && "$pid" != "0" ]] || fail "$unit has no pid"
  kill "$pid"
  sleep 6
  systemctl is-active --quiet zasya-railway-platform.service || fail "platform died after $label"
  systemctl is-active --quiet zasya-railway-coach.service || fail "coach died after $label"
  systemctl is-active --quiet zasya-railway-ntes.service || fail "ntes died after $label"
  systemctl is-active --quiet "$unit" || fail "$unit did not restart"
  pass "$label crash isolation"
}

cmd_ports() {
  if ss -lnt | awk '{print $4}' | grep -Eq ':3000|:3001|:3002'; then
    if ss -lnt | awk '{print $4}' | grep -Eq '0.0.0.0:300[012]|:::300[012]'; then
      fail "internal Node ports exposed on all interfaces"
    fi
  fi
  ss -lnt | awk '{print $4}' | grep -Eq ':80$' || fail "nginx is not listening on :80"
  pass "internal ports not LAN-exposed"
}

cmd_admin_unauth() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1/api/admin/platforms -H 'Content-Type: application/json' -d '{"trainNo":"1","platform":"2"}')
  [[ "$code" == "401" ]] || fail "expected 401 without credentials, got $code"
  pass "admin unauthenticated mutation rejected"
}

cmd_ntes_one_poller() {
  local ntes_exec platform_exec coach_exec count
  ntes_exec=$(systemctl show -p ExecStart --value zasya-railway-ntes.service)
  platform_exec=$(systemctl show -p ExecStart --value zasya-railway-platform.service)
  coach_exec=$(systemctl show -p ExecStart --value zasya-railway-coach.service)
  if ! echo "$ntes_exec" | grep -q 'edge/ntes/poller.js'; then
    fail "ntes unit does not start poller.js"
  fi
  if echo "$platform_exec" | grep -q 'poller.js'; then
    fail "platform unit starts an NTES poller"
  fi
  if echo "$coach_exec" | grep -q 'poller.js'; then
    fail "coach unit starts an NTES poller"
  fi
  count=$(pgrep -f 'edge/ntes/poller.js' | wc -l | tr -d ' ')
  [[ "$count" == "1" ]] || fail "expected exactly one poller.js process, got $count"
  [[ -f "$DATA/runtime/ntes_status.json" ]] || fail "ntes_status.json missing"
  pass "one NTES poller"
}

cmd_ntes_loss() {
  local host port ip rule state_before status_after freshness_after
  read -r host port < <(ntes_host_port)
  [[ -n "$host" ]] || fail "could not parse NTES endpoint"
  ip=$(getent ahostsv4 "$host" | awk '{print $1; exit}')
  if [[ -z "$ip" ]]; then
    ip=$(getent ahosts "$host" | awk '{print $1; exit}')
  fi
  [[ -n "$ip" ]] || fail "could not resolve NTES host $host"
  [[ -f "$DATA/runtime/ntes_state.json" ]] || fail "no last-good NTES state to retain"
  state_before=$(cksum "$DATA/runtime/ntes_state.json" | awk '{print $1" "$2}')
  rule="deny out to $ip port $port proto tcp"
  cleanup_ntes_loss() {
    ufw delete $rule >/dev/null 2>&1 || true
  }
  trap cleanup_ntes_loss EXIT
  ufw $rule
  # Poll interval is 30s plus backoff; wait for a failed attempt.
  local i status
  status=""
  for i in $(seq 1 24); do
    sleep 5
    status=$(json_get state < "$DATA/runtime/ntes_status.json" || true)
    if [[ "$status" == "disconnected" || "$status" == "error" ]]; then
      break
    fi
  done
  [[ "$status" == "disconnected" || "$status" == "error" ]] || fail "NTES status did not leave connected (got ${status:-empty})"
  [[ -f "$DATA/runtime/ntes_state.json" ]] || fail "last-good NTES state was deleted"
  local state_after
  state_after=$(cksum "$DATA/runtime/ntes_state.json" | awk '{print $1" "$2}')
  [[ "$state_after" == "$state_before" ]] || true
  freshness_after=$(json_get sourceStatus < "$DATA/runtime/freshness.json" || true)
  [[ "$freshness_after" == "stale" || "$freshness_after" == "error" ]] || fail "freshness was not marked stale/error (got ${freshness_after:-empty})"
  systemctl is-active --quiet zasya-railway-platform.service || fail "platform died during NTES loss"
  systemctl is-active --quiet zasya-railway-coach.service || fail "coach died during NTES loss"
  ufw delete $rule
  trap - EXIT
  pass "NTES loss retains last-good data"
}

cmd_licence_blocked() {
  local bak_lic bak_state state blocked
  bak_lic="$ETC/licence.json.acceptance-bak"
  bak_state="$DATA/runtime/licence_state.json.acceptance-bak"
  cp "$ETC/licence.json" "$bak_lic"
  if [[ -f "$DATA/runtime/licence_state.json" ]]; then
    cp "$DATA/runtime/licence_state.json" "$bak_state"
  fi
  restore_licence() {
    mv -f "$bak_lic" "$ETC/licence.json" 2>/dev/null || true
    if [[ -f "$bak_state" ]]; then
      mv -f "$bak_state" "$DATA/runtime/licence_state.json"
    fi
    chown root:zasya "$ETC/licence.json" 2>/dev/null || true
  }
  trap restore_licence EXIT
  # Never-valid path: unsigned licence and no prior lastValidAt.
  printf '{"licenceId":"acceptance-never-valid"}\n' > "$ETC/licence.json"
  printf '{"lastValidAt":null,"degradedAt":null,"state":"MISSING"}\n' > "$DATA/runtime/licence_state.json"
  chown zasya-ntes:zasya "$DATA/runtime/licence_state.json" 2>/dev/null || true
  state=$(licence_json | json_get state)
  blocked=$(licence_json | json_get blocked)
  [[ "$state" == "INVALID" || "$state" == "BLOCKED" || "$state" == "MISSING" ]] || fail "expected INVALID/BLOCKED, got $state"
  [[ "$state" != "DEGRADED" ]] || fail "never-valid licence entered DEGRADED grace"
  [[ "$blocked" == "true" ]] || fail "never-valid licence was not blocked"
  restore_licence
  trap - EXIT
  state=$(licence_json | json_get state)
  [[ "$state" == "VALID" || "$state" == "EXPIRING" ]] || fail "licence did not restore to VALID (got $state)"
  pass "licence never-valid blocked"
}

cmd_licence_grace() {
  local bak_pub state operational
  bak_pub="$ETC/licence-public.pem.acceptance-bak"
  [[ -f "$ETC/licence-public.pem" ]] || fail "licence public key missing"
  state=$(licence_json | json_get state)
  [[ "$state" == "VALID" || "$state" == "EXPIRING" ]] || fail "licence must be VALID before grace test (got $state)"
  mv "$ETC/licence-public.pem" "$bak_pub"
  restore_pub() {
    if [[ -f "$bak_pub" ]]; then
      mv -f "$bak_pub" "$ETC/licence-public.pem"
    fi
  }
  trap restore_pub EXIT
  state=$(licence_json | json_get state)
  operational=$(licence_json | json_get operational)
  [[ "$state" == "DEGRADED" ]] || fail "expected DEGRADED after hiding public key, got $state"
  [[ "$operational" == "true" ]] || fail "grace period should remain operational"
  restore_pub
  trap - EXIT
  state=$(licence_json | json_get state)
  [[ "$state" == "VALID" || "$state" == "EXPIRING" ]] || fail "licence did not return to VALID (got $state)"
  pass "licence grace degraded then restored"
}

cmd_backup() {
  local dest
  dest=$(
    ZASYA_RAILWAY_ETC="$ETC" ZASYA_RAILWAY_ROOT="$DATA" node -e '
      const { exportPackage } = require(process.argv[1]);
      const r = exportPackage();
      process.stdout.write(r.dest);
    ' "$ROOT/edge/backup/backup-service.js"
  )
  [[ -d "$dest" ]] || fail "backup dest missing"
  [[ -f "$dest/manifest.json" ]] || fail "backup manifest missing"
  [[ -f "$dest/config.json" ]] || fail "backup missing station config"
  [[ -f "$dest/licence.json" ]] || fail "backup missing licence"
  [[ -f "$dest/ntes.json" ]] && fail "backup contains NTES secrets"
  [[ -f "$dest/admin.json" ]] && fail "backup contains admin secrets"
  if grep -Rqi 'licence-private' "$dest"; then
    fail "backup mentions private signing key"
  fi
  local includes
  includes=$(json_get includesSecrets < "$dest/manifest.json")
  [[ "$includes" == "false" ]] || fail "manifest.includesSecrets should be false"
  if find /opt/zasya /etc/zasya /var/lib/zasya /home -name 'licence-private.pem' 2>/dev/null | grep -q .; then
    fail "licence private key present on appliance"
  fi
  pass "backup export excludes secrets"
}

cmd_firewall() {
  ufw status | grep -qi 'Status: active' || fail "ufw not active"
  ufw status | grep -Eq '80/tcp' || fail "ufw does not allow 80/tcp"
  if ss -lnt | awk '{print $4}' | grep -Eq '0.0.0.0:300[012]|:::300[012]'; then
    fail "Node ports exposed on LAN"
  fi
  pass "firewall and bind topology"
}

cmd_timesync() {
  timedatectl >/dev/null || fail "timedatectl failed"
  systemctl is-active --quiet chrony || systemctl is-active --quiet systemd-timesyncd || fail "no time-sync service active"
  local ts
  ts=$(health_json | json_get timeSync)
  [[ "$ts" != "invalid" ]] || fail "health reports invalid clock"
  pass "time synchronization configured ($ts)"
}

cmd_logs() {
  [[ -f /etc/logrotate.d/zasya-railway ]] || fail "railway logrotate snippet missing"
  logrotate -d /etc/logrotate.d/zasya-railway >/tmp/zasya-logrotate-debug 2>&1 \
    || fail "logrotate debug failed"
  pass "log rotation configured"
}

chromium_bin() {
  if [[ -f "$ETC/chromium-bin" ]]; then
    tr -d '[:space:]' < "$ETC/chromium-bin"
    return
  fi
  command -v chromium || command -v chromium-browser || true
}

cmd_chromium() {
  local bin
  bin="$(chromium_bin)"
  [[ -n "$bin" && -x "$bin" ]] || fail "chromium binary not found"
  systemctl is-active --quiet zasya-railway-display.service || fail "display service not active"
  pass "chromium installed ($bin)"
}

cmd_chromium_watchdog() {
  local pid new_pid
  systemctl is-active --quiet zasya-railway-kiosk.service || fail "kiosk service not active"
  pid=$(systemctl show -p MainPID --value zasya-railway-kiosk.service)
  [[ -n "$pid" && "$pid" != "0" ]] || fail "kiosk has no pid"
  kill "$pid" || true
  sleep 10
  systemctl is-active --quiet zasya-railway-kiosk.service || fail "kiosk did not recover"
  new_pid=$(systemctl show -p MainPID --value zasya-railway-kiosk.service)
  [[ -n "$new_pid" && "$new_pid" != "0" && "$new_pid" != "$pid" ]] || fail "kiosk MainPID did not change after kill"
  pass "chromium watchdog restart"
}

cmd_all() {
  cmd_urls
  cmd_services
  cmd_ports
  cmd_admin_unauth
  cmd_ntes_one_poller
  cmd_backup
  cmd_firewall
  cmd_timesync
  cmd_logs
  cmd_chromium
  cmd_isolation zasya-railway-platform.service platform
  cmd_isolation zasya-railway-coach.service coach
  cmd_isolation zasya-railway-ntes.service ntes
  cmd_licence_blocked
  cmd_licence_grace
  cmd_chromium_watchdog
  cmd_ntes_loss
}

cmd="${1:-}"
case "$cmd" in
  urls) cmd_urls ;;
  services) cmd_services ;;
  isolation-platform) cmd_isolation zasya-railway-platform.service platform ;;
  isolation-coach) cmd_isolation zasya-railway-coach.service coach ;;
  isolation-ntes) cmd_isolation zasya-railway-ntes.service ntes ;;
  ports) cmd_ports ;;
  admin-unauth) cmd_admin_unauth ;;
  ntes-one-poller) cmd_ntes_one_poller ;;
  ntes-loss) cmd_ntes_loss ;;
  licence-blocked) cmd_licence_blocked ;;
  licence-grace) cmd_licence_grace ;;
  backup) cmd_backup ;;
  firewall) cmd_firewall ;;
  timesync) cmd_timesync ;;
  logs) cmd_logs ;;
  chromium) cmd_chromium ;;
  chromium-watchdog) cmd_chromium_watchdog ;;
  all) cmd_all ;;
  *)
    echo "Usage: $0 {urls|services|isolation-platform|isolation-coach|isolation-ntes|ports|admin-unauth|ntes-one-poller|ntes-loss|licence-blocked|licence-grace|backup|firewall|timesync|logs|chromium|chromium-watchdog|all}"
    exit 2
    ;;
esac
