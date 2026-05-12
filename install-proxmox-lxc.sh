#!/usr/bin/env bash
set -euo pipefail

# Omada Event Status Dashboard - Proxmox LXC installer
# Run this script on the Proxmox HOST from inside the extracted project folder.
# It creates a Debian 12 LXC container, installs Docker/Compose, copies this app,
# and starts it on port 3000.

APP_NAME="omada-event-status"
VMID="${VMID:-230}"
HOSTNAME="${HOSTNAME:-omada-status}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
IP_CONFIG="${IP_CONFIG:-dhcp}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-1024}"
DISK_SIZE="${DISK_SIZE:-8}"
PASSWORD="${PASSWORD:-}"
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE_PATH="/var/lib/vz/template/cache/${TEMPLATE}"
APP_DIR="/opt/${APP_NAME}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root on the Proxmox host."
  exit 1
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "This must be run on a Proxmox host with pct available."
  exit 1
fi

if [[ ! -f "package.json" || ! -f "server.js" || ! -f "docker-compose.yml" ]]; then
  echo "Run this script from inside the extracted ${APP_NAME} project folder."
  exit 1
fi

if pct status "$VMID" >/dev/null 2>&1; then
  echo "Container VMID ${VMID} already exists. Choose another VMID, e.g.: VMID=231 ./install-proxmox-lxc.sh"
  exit 1
fi

if [[ -z "$PASSWORD" ]]; then
  PASSWORD="$(openssl rand -base64 18)"
  echo "Generated temporary root password for CT ${VMID}: ${PASSWORD}"
fi

echo "Updating Proxmox template list..."
pveam update >/dev/null

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Downloading Debian 12 LXC template..."
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

echo "Creating LXC ${VMID} (${HOSTNAME})..."
pct create "$VMID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$HOSTNAME" \
  --storage "$STORAGE" \
  --rootfs "${STORAGE}:${DISK_SIZE}" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IP_CONFIG}" \
  --features "nesting=1,keyctl=1" \
  --unprivileged 1 \
  --password "$PASSWORD" \
  --start 1

echo "Waiting for container boot..."
sleep 8

echo "Installing Docker inside LXC..."
pct exec "$VMID" -- bash -lc 'apt-get update && apt-get install -y ca-certificates curl gnupg'
pct exec "$VMID" -- bash -lc 'install -m 0755 -d /etc/apt/keyrings'
pct exec "$VMID" -- bash -lc 'curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg'
pct exec "$VMID" -- bash -lc 'chmod a+r /etc/apt/keyrings/docker.gpg'
pct exec "$VMID" -- bash -lc 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list'
pct exec "$VMID" -- bash -lc 'apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'

echo "Copying app into container..."
tmp_tar="/tmp/${APP_NAME}.tar.gz"
tar --exclude='./node_modules' --exclude='./.git' --exclude='./install-proxmox-lxc.sh' -czf "$tmp_tar" .
pct exec "$VMID" -- mkdir -p "$APP_DIR"
pct push "$VMID" "$tmp_tar" "/tmp/${APP_NAME}.tar.gz"
pct exec "$VMID" -- bash -lc "tar -xzf /tmp/${APP_NAME}.tar.gz -C ${APP_DIR} && rm /tmp/${APP_NAME}.tar.gz"
rm -f "$tmp_tar"

pct exec "$VMID" -- bash -lc "cd ${APP_DIR} && if [ ! -f .env ]; then cp .env.example .env; fi"

echo "Starting dashboard..."
pct exec "$VMID" -- bash -lc "cd ${APP_DIR} && docker compose up -d --build"

CT_IP="$(pct exec "$VMID" -- bash -lc "hostname -I | awk '{print \$1}'" || true)"

echo ""
echo "Install complete."
echo "Container: ${VMID} / ${HOSTNAME}"
echo "Dashboard: http://${CT_IP:-CONTAINER-IP}:3000"
echo ""
echo "Edit Omada settings inside the container:"
echo "  pct exec ${VMID} -- nano ${APP_DIR}/.env"
echo "Then restart:"
echo "  pct exec ${VMID} -- bash -lc 'cd ${APP_DIR} && docker compose restart'"
