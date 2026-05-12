# Omada Event Status Dashboard

A small Docker-hosted web dashboard for showing Omada event-kit status.

It displays:

- Omada infrastructure devices: gateways, switches and access points
- Connected wired/wireless clients
- Online/offline totals
- Critical kit alerts based on names, MACs or IPs listed in `.env`

## Setup

1. Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

2. Edit `.env` with your Omada Controller details.

```bash
nano .env
```

3. Build and start.

```bash
docker compose up -d --build
```

4. Open:

```text
http://YOUR-SERVER-IP:3000
```

## Finding your controller ID

Log into the Omada Controller in a browser. The URL usually contains the controller ID after the port.

Example:

```text
https://192.168.1.10:8043/0123456789abcdef0123456789abcdef/
```

Use:

```text
OMADA_CONTROLLER_ID=0123456789abcdef0123456789abcdef
```

## Finding site name / site ID

After the container is running, visit:

```text
http://YOUR-SERVER-IP:3000/api/sites
```

Use the returned site name, key or ID in:

```text
OMADA_SITE=Default
```

## Notes

This uses the local Omada SDN Controller API style used by many self-hosted and OC200/OC300 deployments. Newer Omada versions also have an official Open API / Platform Integration option. If your controller blocks the local API endpoints, create an Open API app in Omada and adapt `server.js` to use your app client credentials.
