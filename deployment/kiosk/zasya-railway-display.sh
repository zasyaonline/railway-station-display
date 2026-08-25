#!/bin/bash
# Keep a local X display for Chromium kiosk.
# Ubuntu Server often has /dev/dri/card0 with no usable HDMI/VT, so xinit exits
# and a naive Xvfb :0 then fails on leftover locks. Prefer an existing display,
# then a short xinit probe when a monitor is connected, then Xvfb on a free slot.
set -uo pipefail

ENV_FILE=/etc/zasya/railway/display.env
mkdir -p /etc/zasya/railway /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

write_env() {
  printf 'DISPLAY=%s\n' "$1" > "$ENV_FILE"
  chmod 0644 "$ENV_FILE"
}

socket_for() {
  local n="${1#:}"
  [[ -S "/tmp/.X11-unix/X${n}" ]]
}

stale_cleanup() {
  local n="${1#:}"
  if socket_for ":$n"; then
    return 0
  fi
  rm -f "/tmp/.X${n}-lock" "/tmp/.X11-unix/X${n}"
}

monitor_connected() {
  local f
  shopt -s nullglob
  for f in /sys/class/drm/*/status; do
    if [[ "$(tr -d '[:space:]' < "$f" 2>/dev/null)" == connected ]]; then
      return 0
    fi
  done
  return 1
}

# GDM or a previous Xorg already owns a display — stay active so kiosk can attach.
for n in 0 1 2; do
  if socket_for ":$n"; then
    echo "Using existing X display :${n}"
    write_env ":${n}"
    exec sleep infinity
  fi
done

try_xinit() {
  command -v xinit >/dev/null 2>&1 || return 1
  monitor_connected || return 1
  [[ -e /dev/dri/card0 || -e /dev/dri/card1 ]] || return 1
  [[ -e /dev/tty7 || -e /dev/tty1 ]] || return 1
  stale_cleanup :0
  echo "Trying xinit on :0"
  /usr/bin/xinit /usr/bin/openbox -- :0 vt7 -nolisten tcp -ac &
  local pid=$!
  local i
  for i in $(seq 1 8); do
    if socket_for :0; then
      write_env :0
      wait "$pid"
      return $?
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      echo "xinit exited before :0 was ready" >&2
      return 1
    fi
    sleep 1
  done
  echo "xinit did not create :0; stopping it" >&2
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  stale_cleanup :0
  return 1
}

try_xvfb() {
  command -v Xvfb >/dev/null 2>&1 || return 1
  local n
  for n in 0 1 2; do
    if socket_for ":$n"; then
      continue
    fi
    stale_cleanup ":$n"
    echo "Starting Xvfb :${n}"
    write_env ":${n}"
    exec /usr/bin/Xvfb ":${n}" -screen 0 1920x1080x24 -ac
  done
  echo "No free X display slot for Xvfb" >&2
  return 1
}

try_xinit || try_xvfb
echo "No Xorg GPU console and no Xvfb" >&2
exit 1
