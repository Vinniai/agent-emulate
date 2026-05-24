#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.baseUrl) {
  console.log(`Usage:
  node tools/discover-uptick-api.mjs --base-url https://tenant.onuptick.com --token <access-token> --out documentation/uptick-discovery.json
  node tools/discover-uptick-api.mjs --base-url https://tenant.onuptick.com --username user@agent-emulate.dev --password secret --out documentation/uptick-discovery.json

Options:
  --base-url       Authorized Uptick tenant origin, for example https://tenant.onuptick.com
  --version        API version to crawl. Defaults to /api/version/ latest, then v2.15
  --token          Bearer token. Can also use UPTICK_ACCESS_TOKEN
  --username       Username for password grant. Can also use UPTICK_USERNAME
  --password       Password for password grant. Can also use UPTICK_PASSWORD
  --client-id      OAuth client id for Basic auth. Can also use UPTICK_CLIENT_ID
  --client-secret  OAuth client secret for Basic auth. Can also use UPTICK_CLIENT_SECRET
  --out            Output JSON path. Defaults to documentation/uptick-discovery.json
`);
  process.exit(args.help ? 0 : 1);
}

const baseUrl = String(args.baseUrl).replace(/\/+$/, "");
const outPath = resolve(String(args.out ?? "documentation/uptick-discovery.json"));
const token = await resolveToken();
const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" } : {};

const versionInfo = await fetchJson(`${baseUrl}/api/version/`, headers).catch((error) => ({
  error: String(error instanceof Error ? error.message : error),
}));
const version = String(args.version ?? versionInfo.latest ?? "v2.15");
const index = await fetchJson(`${baseUrl}/api/${version}/`, headers);
const endpointEntries = Object.entries(index).filter(([, value]) => typeof value === "string");

const endpoints = [];
for (const [name, url] of endpointEntries) {
  const href = String(url).startsWith("http") ? String(url) : `${baseUrl}${url}`;
  const options = await fetchOptions(href, headers);
  endpoints.push({
    name,
    url: href.replace(baseUrl, ""),
    allow: options.allow,
    status: options.status,
    metadata: options.body,
  });
}

const result = {
  discovered_at: new Date().toISOString(),
  base_url_host: new URL(baseUrl).host,
  source: {
    version_url: "/api/version/",
    index_url: `/api/${version}/`,
    endpoint_metadata_method: "OPTIONS",
  },
  version,
  version_info: versionInfo,
  endpoints,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${endpoints.length} Uptick endpoints to ${outPath}`);

async function resolveToken() {
  if (args.token || process.env.UPTICK_ACCESS_TOKEN) return String(args.token ?? process.env.UPTICK_ACCESS_TOKEN);

  const username = args.username ?? process.env.UPTICK_USERNAME;
  const password = args.password ?? process.env.UPTICK_PASSWORD;
  if (!username || !password) return null;

  const clientId = String(args.clientId ?? process.env.UPTICK_CLIENT_ID ?? "");
  const clientSecret = String(args.clientSecret ?? process.env.UPTICK_CLIENT_SECRET ?? "");
  const auth =
    clientId || clientSecret ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` } : {};
  const res = await fetch(`${baseUrl}/api/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...auth },
    body: new URLSearchParams({
      grant_type: "password",
      username: String(username),
      password: String(password),
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed with ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (!body.access_token) throw new Error("Token response did not include access_token");
  return String(body.access_token);
}

async function fetchJson(url, requestHeaders) {
  const res = await fetch(url, { headers: requestHeaders });
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchOptions(url, requestHeaders) {
  const res = await fetch(url, { method: "OPTIONS", headers: requestHeaders });
  let body = null;
  const text = await res.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    status: res.status,
    allow: res.headers.get("Allow") ?? res.headers.get("allow"),
    body,
  };
}

function parseArgs(raw) {
  const out = {};
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    const next = raw[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}
