#!/bin/bash
# Start a local X display for Chromium kiosk. Prefer a real console (UTM window);
# fall back to Xvfb so watchdog tests still work without HDMI.
set -euo pipefail

if [[ -e /dev/dri/card0 ]] && command -v xinit >/dev/null 2>&1; then
  if /usr/bin/xinit /usr/bin/openbox -- :0 vt7 -nolisten tcp -ac; then
    exit 0
  fi
  echo "xinit failed; falling back to Xvfb" >&2
fi

if command -v Xvfb >/dev/null 2>&1; then
  exec /usr/bin/Xvfb :0 -screen 0 1920x1080x24 -ac +extension GLX
fi

echo "No Xorg GPU and no Xvfb" >&2
exit 1
