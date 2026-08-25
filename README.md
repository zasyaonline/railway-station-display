# Railway Station Display

Local Ubuntu appliance for Indian Railways passenger displays: **Platform**, **Coach position**, and **Admin**.

This repository is the station PC software only. It does not include AWS, Lambda, or cloud deploys.

Default station in the sample licence: **BG / Bhongir**. Sample licence is valid **2026-08-25 to 2027-08-25** for platform and coach. The signing **private key is not in this repo** and must never be copied onto the appliance.

## Zero-touch install (Ubuntu 24.04)

On the station PC or VM, as a user with sudo (git is installed for you):

```bash
curl -fsSL https://raw.githubusercontent.com/zasyaonline/railway-station-display/main/deployment/ubuntu/bootstrap.sh | sudo bash
```

That command installs **git**, clones this repo, installs Node.js 22 / nginx / Chromium, sets **Asia/Kolkata (UTC+5:30)** and NTP via chrony, runs tests, applies the sample licence, and starts systemd + nginx on **port 80**.

Proof of success is **nginx on port 80**. Do not use `npm start` as the production path. Local X/kiosk (HDMI Chromium) is best-effort; Platform, Coach, and Admin on `:80` are the install gate.

### Already cloned

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/zasyaonline/railway-station-display.git
cd railway-station-display
sudo bash deployment/ubuntu/install.sh
```

### Update an existing VM or physical PC

Home clone (`~/railway-station-display`):

```bash
cd ~/railway-station-display && git pull --ff-only origin main && sudo bash deployment/ubuntu/install.sh
```

Bootstrap clone (`/opt/zasya/railway-src`):

```bash
sudo bash -c 'git -C /opt/zasya/railway-src pull --ff-only origin main && bash /opt/zasya/railway-src/deployment/ubuntu/install.sh'
```

`install.sh` reuses `/root/zasya-admin-password` if present. After install, hard-refresh the coach URL. Confirm clock:

```bash
timedatectl show -p Timezone --value   # Asia/Kolkata
sudo railway-acceptance timesync
curl -fsS http://127.0.0.1/health
```

### Zip instead of git clone

1. Download https://github.com/zasyaonline/railway-station-display/archive/refs/heads/main.zip
2. Unzip on the Ubuntu machine
3. `cd railway-station-display-main`
4. `sudo bash deployment/ubuntu/install.sh`

## URLs after install

Replace `VM_IP` with the Ubuntu LAN address (`hostname -I` on the guest):

| Surface | URL |
| --- | --- |
| Platform | `http://VM_IP/platform/` |
| Coach | `http://VM_IP/coach/?station=BG&display=entrance-main` |
| Admin | `http://VM_IP/admin/` |
| Health | `http://VM_IP/health` |

Admin password is printed once at the end of install and saved as `/root/zasya-admin-password`.

The appliance clock is **Asia/Kolkata (UTC+5:30)** and is kept in sync with the Indian NTP pool (`chrony`). Health `/health` reports `timeSync` from chrony (Leap Normal), not only `timedatectl NTPSynchronized`.

## Manual steps (if you do not want the one-shot installer)

```bash
sudo bash deployment/ubuntu/packages.sh
npm install --omit=dev
(cd coach-position && npm install --omit=dev)
npm test
sudo bash deployment/scripts/railway-setup
```

Interactive setup asks for station, licence paths, NTES credentials (optional), grace hours, and admin password. For a scripted install, use `--non-interactive` (see `railway-setup --help`).

## What must stay off the appliance

- `keys/licence-private.pem` (never copy this file to the station PC)
- NTES passwords in git
- Binding passenger apps to `0.0.0.0` — they listen on `127.0.0.1`; nginx serves LAN `:80`

## Troubleshooting

```bash
sudo railway-setup --validate-only
sudo railway-acceptance urls
sudo railway-acceptance services
sudo railway-acceptance timesync
sudo systemctl status zasya-railway.target
curl -fsS http://127.0.0.1/health
sudo journalctl -u zasya-railway-display -u zasya-railway-kiosk -n 80
sudo journalctl -u zasya-railway-platform -u zasya-railway-coach -u zasya-railway-admin -u zasya-railway-ntes -n 80
```

Coach sprites load from `/coach/img/...` (nginx prefix). A fresh clone includes that mapping plus `/img/` → coach as a fallback.

Display/kiosk units use a real X console when HDMI is connected, otherwise **Xvfb**. If Chromium snap cannot start under systemd, kiosk may warn while Platform/Coach/Admin on `:80` still work.

After a reboot, systemd target `zasya-railway.target` starts the four processes and nginx again.
