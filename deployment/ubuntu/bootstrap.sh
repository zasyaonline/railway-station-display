#!/usr/bin/env bash
# Zero-touch Ubuntu bootstrap: install git, clone the appliance repo, run install.sh.
# Proof of success is nginx on port 80.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this on Ubuntu Server (the appliance), not on macOS." >&2
  exit 1
fi

echo "==> Installing git and clone tools"
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git

REPO="${RAILWAY_GIT_URL:-https://github.com/zasyaonline/railway-station-display.git}"
BRANCH="${RAILWAY_GIT_BRANCH:-main}"
SRC="${RAILWAY_SOURCE_DIR:-/opt/zasya/railway-src}"

echo "==> Cloning $REPO ($BRANCH) -> $SRC"
mkdir -p "$(dirname "$SRC")"
if [[ -d "$SRC/.git" ]]; then
  git -C "$SRC" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$SRC" reset --hard "origin/$BRANCH"
else
  rm -rf "$SRC"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC"
fi

exec bash "$SRC/deployment/ubuntu/install.sh"
