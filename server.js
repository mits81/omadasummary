import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const OMADA_URL = (process.env.OMADA_URL || "").replace(/\/$/, "");
const CONTROLLER_ID = process.env.OMADA_CONTROLLER_ID || "";
const OMADA_SITE = process.env.OMADA_SITE || "Default";
const USERNAME = process.env.OMADA_USERNAME || "";
const PASSWORD = process.env.OMADA_PASSWORD || "";
const ALLOW_SELF_SIGNED = String(process.env.OMADA_ALLOW_SELF_SIGNED || "true").toLowerCase() === "true";
const REFRESH_SECONDS = Number(process.env.REFRESH_SECONDS || 10);
const CRITICAL_DEVICES = (process.env.CRITICAL_DEVICES || "")
  .split(",")
  .map(x => x.trim().toLowerCase())
  .filter(Boolean);

const agent = new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED });

let auth = {
  token: null,
  cookies: "",
  expiresAt: 0
};

function now() {
  return Date.now();
}

function headers(extra = {}) {
  const h = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...extra
  };
  if (auth.cookies) h.Cookie = auth.cookies;
  if (auth.token) h.Csrf-Token = auth.token;
  return h;
}

async function omadaFetch(path, opts = {}) {
  const url = `${OMADA_URL}${path}`;
  const res = await fetch(url, { ...opts, agent, headers: headers(opts.headers || {}) });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) auth.cookies = setCookie.split(",").map(c => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Omada HTTP ${res.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function login() {
  if (!OMADA_URL || !CONTROLLER_ID || !USERNAME || !PASSWORD) {
    throw new Error("Missing OMADA_URL, OMADA_CONTROLLER_ID, OMADA_USERNAME or OMADA_PASSWORD in .env");
  }

  // Local Omada SDN controller API style.
  const result = await omadaFetch(`/${CONTROLLER_ID}/api/v2/login`, {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });

  auth.token = result?.result?.token || result?.value || result?.token || null;
  auth.expiresAt = now() + 20 * 60 * 1000;
  return result;
}

async function ensureLogin() {
  if (!auth.cookies || now() > auth.expiresAt) await login();
}

function pickArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result?.data)) return data.result.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function tryPaths(paths) {
  let lastErr;
  for (const p of paths) {
    try {
      const data = await omadaFetch(p);
      return { path: p, data };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getSites() {
  await ensureLogin();
  const r = await tryPaths([
    `/${CONTROLLER_ID}/api/v2/sites`,
    `/${CONTROLLER_ID}/api/v2/sites?currentPage=1&currentPageSize=100`
  ]);
  return pickArray(r.data);
}

async function resolveSiteId() {
  const sites = await getSites();
  const wanted = OMADA_SITE.toLowerCase();
  const match = sites.find(s =>
    String(s.name || s.siteName || s.key || s.id || "").toLowerCase() === wanted
  );
  return match?.key || match?.id || match?.siteId || OMADA_SITE;
}

function normaliseDevice(d) {
  const name = d.name || d.deviceName || d.hostname || d.model || d.mac || "Unknown device";
  const statusRaw = String(d.status || d.state || d.deviceStatus || "").toLowerCase();
  const connected = d.connected === true || d.online === true || statusRaw.includes("connected") || statusRaw.includes("online") || statusRaw === "1";
  const ip = d.ip || d.ipAddress || d.lanIp || d.managementIp || "";
  const mac = d.mac || d.macAddress || d.deviceMac || "";
  const type = d.type || d.deviceType || d.category || (d.model?.includes("EAP") ? "AP" : "Device");
  const uptime = d.uptime || d.runTime || "";
  return {
    kind: "infrastructure",
    name, type, ip, mac,
    model: d.model || d.deviceModel || "",
    status: connected ? "online" : "offline",
    uptime,
    clients: d.clientNum ?? d.clients ?? d.wirelessClients ?? "",
    raw: d
  };
}

function normaliseClient(c) {
  const name = c.name || c.hostname || c.clientName || c.mac || "Unknown client";
  const statusRaw = String(c.status || c.state || "").toLowerCase();
  const connected = c.connected !== false && !statusRaw.includes("offline");
  return {
    kind: "client",
    name,
    type: c.radioId !== undefined || c.ssid ? "Wi-Fi client" : "Wired client",
    ip: c.ip || c.ipAddress || "",
    mac: c.mac || c.macAddress || "",
    model: c.os || c.vendor || c.deviceType || "",
    status: connected ? "online" : "offline",
    ap: c.apName || c.apMac || "",
    ssid: c.ssid || c.ssidName || "",
    rx: c.rxRate || c.download || "",
    tx: c.txRate || c.upload || "",
    raw: c
  };
}

function isCritical(item) {
  const blob = `${item.name} ${item.mac} ${item.ip} ${item.model} ${item.type}`.toLowerCase();
  return CRITICAL_DEVICES.some(x => blob.includes(x));
}

async function getStatus() {
  await ensureLogin();
  const siteId = await resolveSiteId();

  const devicesResult = await tryPaths([
    `/${CONTROLLER_ID}/api/v2/sites/${encodeURIComponent(siteId)}/devices?currentPage=1&currentPageSize=500`,
    `/${CONTROLLER_ID}/api/v2/sites/${encodeURIComponent(siteId)}/devices`
  ]);

  const clientsResult = await tryPaths([
    `/${CONTROLLER_ID}/api/v2/sites/${encodeURIComponent(siteId)}/clients?currentPage=1&currentPageSize=1000`,
    `/${CONTROLLER_ID}/api/v2/sites/${encodeURIComponent(siteId)}/clients`
  ]);

  const infrastructure = pickArray(devicesResult.data).map(normaliseDevice);
  const clients = pickArray(clientsResult.data).map(normaliseClient);

  const all = [...infrastructure, ...clients].map(x => ({ ...x, critical: isCritical(x) }));
  const online = all.filter(x => x.status === "online").length;
  const offline = all.length - online;
  const criticalOffline = all.filter(x => x.critical && x.status !== "online");

  return {
    generatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_SECONDS,
    site: siteId,
    counts: {
      total: all.length,
      online,
      offline,
      infrastructure: infrastructure.length,
      clients: clients.length,
      criticalOffline: criticalOffline.length
    },
    infrastructure,
    clients,
    criticalOffline
  };
}

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/sites", async (req, res) => {
  try { res.json({ sites: await getSites() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/status", async (req, res) => {
  try { res.json(await getStatus()); }
  catch (e) {
    auth.expiresAt = 0;
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Omada Event Status running on http://0.0.0.0:${PORT}`);
});
