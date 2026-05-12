# Proxmox LXC install

Run this from the Proxmox host after extracting the project folder:

```bash
chmod +x install-proxmox-lxc.sh
./install-proxmox-lxc.sh
```

Defaults:

- VMID: `230`
- Hostname: `omada-status`
- Bridge: `vmbr0`
- IP: DHCP
- RAM: 1024 MB
- CPU: 2 cores
- Disk: 8 GB
- App path inside container: `/opt/omada-event-status`
- Dashboard port: `3000`

You can override values:

```bash
VMID=240 HOSTNAME=event-omada-status STORAGE=local-lvm BRIDGE=vmbr0 ./install-proxmox-lxc.sh
```

After install, edit the Omada settings:

```bash
pct exec 230 -- nano /opt/omada-event-status/.env
pct exec 230 -- bash -lc 'cd /opt/omada-event-status && docker compose restart'
```

Open:

```text
http://CONTAINER-IP:3000
```
