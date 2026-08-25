# Railway Station Display

Local Ubuntu appliance for Indian Railways passenger displays: **Platform**, **Coach position**, and **Admin**.

This repository is the station PC software only. It does not include AWS, Lambda, or cloud deploys.

Default station in the sample licence: **BG / Bhongir**. Sample licence is valid **2026-08-25 to 2027-08-25** for platform and coach. The signing **private key is not in this repo** and must never be copied onto the appliance.

## Install on Ubuntu Server 24.04

Proof of success is **nginx on port 80**. Do not use `npm start` as the production path.

SSH into the Ubuntu machine (UTM VM or physical PC), then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/zasyaonline/railway-station-display.git
cd railway-station-display
sudo bash deployment/ubuntu/install.sh
```

The installer installs Node.js 22, nginx, Chromium (for kiosk), runs tests, applies the sample licence, starts systemd services, and prints LAN URLs.

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
sudo systemctl status zasya-railway.target
curl -fsS http://127.0.0.1/health
sudo journalctl -u zasya-railway-platform -u zasya-railway-coach -u zasya-railway-admin -u zasya-railway-ntes -n 80
```

If Chromium is missing on this Ubuntu/arch, kiosk/display units may fail while Platform/Coach/Admin on `:80` still work.

After a reboot, systemd target `zasya-railway.target` starts the four processes and nginx again.
