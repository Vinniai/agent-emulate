#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const token = String(args.githubToken ?? process.env.GITHUB_TOKEN ?? "");

if (args.help || !token) {
  console.log(`Usage:
  GITHUB_TOKEN=ghp_... node tools/search-uptick-public-code.mjs --out documentation/uptick-public-code-search.json

Options:
  --query         Add a GitHub code search query. May be repeated.
  --out           Output JSON path. Defaults to documentation/uptick-public-code-search.json
  --github-token  GitHub token. Can also use GITHUB_TOKEN.

This searches public GitHub code only. Results are hints, not canonical Uptick
documentation. Use an authorized tenant discovery crawl for the real endpoint
catalogue.
`);
  process.exit(args.help ? 0 : 1);
}

const queries = normalizeArray(args.query);
if (!queries.length) {
  queries.push(
    '"onuptick.com/api/v2"',
    '"onuptick.com" "api/v2"',
    '"api/oauth2/token/" "onuptick"',
    '"api/v2/clients/" "Uptick"',
    '"api/v2/properties/" "Uptick"',
    '"page[limit]" "onuptick"',
  );
}

const outPath = resolve(String(args.out ?? "documentation/uptick-public-code-search.json"));
const seenFiles = new Set();
const findings = [];

for (const query of queries) {
  const result = await searchCode(query);
  for (const item of result.items ?? []) {
    if (seenFiles.has(item.url)) continue;
    seenFiles.add(item.url);
    const file = await fetchJson(item.url);
    const text = decodeContent(file);
    findings.push({
      query,
      repository: item.repository?.full_name,
      path: item.path,
      html_url: item.html_url,
      endpoints: extractEndpoints(text),
    });
  }
}

const endpointCounts = new Map();
for (const finding of findings) {
  for (const endpoint of finding.endpoints) {
    endpointCounts.set(endpoint, (endpointCounts.get(endpoint) ?? 0) + 1);
  }
}

const output = {
  searched_at: new Date().toISOString(),
  source: "public GitHub code search",
  caveat: "Public code search is incomplete and non-authoritative. Prefer authorized /api/<version>/ plus OPTIONS discovery.",
  queries,
  endpoints: [...endpointCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path, occurrences]) => ({ path, occurrences })),
  findings,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.endpoints.length} public-code endpoint hints from ${findings.length} files to ${outPath}`);

async function searchCode(query) {
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=20`;
  return fetchJson(url);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "emulate-source-audit",
    },
  });
  if (!res.ok) throw new Error(`GitHub request failed with ${res.status}: ${await res.text()}`);
  return res.json();
}

function decodeContent(file) {
  if (file.encoding === "base64" && typeof file.content === "string") {
    return Buffer.from(file.content, "base64").toString("utf8");
  }
  return "";
}

function extractEndpoints(text) {
  const out = new Set();
  for (const match of text.matchAll(/\/api\/v[0-9][0-9.]*\/[A-Za-z0-9_./?&=[\]-]+/g)) {
    out.add(cleanEndpoint(match[0]));
  }
  for (const match of text.matchAll(/\/api\/oauth2\/token\/?/g)) {
    out.add(cleanEndpoint(match[0]));
  }
  return [...out].sort();
}

function cleanEndpoint(value) {
  return value
    .replace(/[)"'`,;]+$/g, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "/");
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
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
    } else if (out[key] === undefined) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = [...normalizeArray(out[key]), next];
      i += 1;
    }
  }
  return out;
}
