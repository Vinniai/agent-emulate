// Nango unified read-back — proves the simulator engine can now drive Nango's
// `/proxy/*` reads, which require `Connection-Id` + `Provider-Config-Key`
// request headers the engine's native send didn't set before.
//
// Real Nango exposes a *unified read* surface: `GET /proxy/<provider-path>`
// with those two headers, and Nango forwards to the provider, returning its
// native JSON. Records are read out of Nango's own store — populated here via
// the connection + records-ingestion API (`POST /connections/:id/records/:model`),
// exactly the path the engine's `kind: "sync"` streams use.
//
// Flow:
//   1. seed — create a connection per provider, append a few unified records;
//   2. read — register `kind: "native"` GET generators that carry the proxy
//      headers, then run them through the **Simulator engine**. The engine now
//      merges those per-tick headers onto the request (see engine.ts), so the
//      proxy resolves the seeded records instead of returning empty;
//   3. show — an injected fetch captures each proxy response so we can print
//      the native envelope each provider returns.
//
// This is the read counterpart to nango-generators.ts (the write routes).

import { loadScenario, registerGenerator, Simulator } from "@emulators/simulator";
import type { PersonaData } from "./profiles.js";

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length];
const localPart = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

/** A stable demo realm/company id for the QuickBooks path. */
const QB_REALM = "9130000000";
const QB_QUERY = "SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100";

interface ReadbackProvider {
  /** Generator key + stream name stem. */
  key: string;
  label: string;
  /** Nango connection id + provider config key (sent as the proxy headers). */
  connectionId: string;
  providerConfigKey: string;
  /** The Nango model the records are seeded under. */
  model: string;
  /** Build the unified records to seed for this provider. */
  seed: (data: PersonaData, n: number) => Record<string, unknown>[];
  /** Provider-relative `/proxy` read path (the engine prepends `/nango`). */
  readPath: string;
  /** Pull the row array out of the provider's native response envelope. */
  extract: (body: unknown) => Record<string, unknown>[];
  /** One-line summary of a returned row, for the printout. */
  summarise: (row: Record<string, unknown>) => string;
}

const get = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    obj,
  );

const PROVIDERS: ReadbackProvider[] = [
  {
    key: "salesforce",
    label: "Salesforce · Lead",
    connectionId: "sim-nango-salesforce",
    providerConfigKey: "salesforce",
    model: "Lead",
    readPath: "/proxy/services/data/v60.0/sobjects/Lead",
    seed: (data, n) =>
      Array.from({ length: n }, (_, i) => {
        const [first, ...rest] = pick(data.people, i).split(" ");
        return {
          Id: `00Q${String(i).padStart(12, "0")}`,
          FirstName: first,
          LastName: rest.join(" ") || "Lead",
          Company: pick(data.companies, i),
          Email: `${localPart(pick(data.people, i))}@${pick(data.emailDomains, i)}`,
          LeadSource: "Nango",
        };
      }),
    extract: (body) => (Array.isArray(get(body, "records")) ? (get(body, "records") as Record<string, unknown>[]) : []),
    summarise: (r) => `${String(r.FirstName)} ${String(r.LastName)} · ${String(r.Company)}`,
  },
  {
    key: "hubspot",
    label: "HubSpot · Contact",
    connectionId: "sim-nango-hubspot",
    providerConfigKey: "hubspot",
    model: "Contact",
    readPath: "/proxy/crm/v3/objects/contacts",
    seed: (data, n) =>
      Array.from({ length: n }, (_, i) => {
        const [first, ...rest] = pick(data.people, i).split(" ");
        return {
          id: String(2000 + i),
          properties: {
            email: `${localPart(pick(data.people, i))}@${pick(data.emailDomains, i)}`,
            firstname: first,
            lastname: rest.join(" ") || "—",
            company: pick(data.companies, i),
          },
        };
      }),
    extract: (body) => (Array.isArray(get(body, "records")) ? (get(body, "records") as Record<string, unknown>[]) : []),
    summarise: (r) => {
      const p = (r.properties ?? {}) as Record<string, unknown>;
      return `${String(p.firstname)} ${String(p.lastname)} · ${String(p.company)}`;
    },
  },
  {
    key: "xero",
    label: "Xero · Invoice",
    connectionId: "sim-nango-xero",
    providerConfigKey: "xero",
    model: "Invoice",
    readPath: "/proxy/api.xro/2.0/Invoices",
    seed: (data, n) =>
      Array.from({ length: n }, (_, i) => ({
        InvoiceID: `inv-${1000 + i}`,
        InvoiceNumber: `INV-${1000 + i}`,
        Type: "ACCREC",
        Contact: { Name: pick(data.companies, i) },
        LineItems: [{ Description: pick(data.dealTitles, i), Quantity: 1, UnitAmount: pick(data.amounts, i) }],
        Total: pick(data.amounts, i),
        Status: "AUTHORISED",
        CurrencyCode: "AUD",
      })),
    // Xero proxy returns { Invoices: [...], Status: "OK", ... }
    extract: (body) =>
      Array.isArray(get(body, "Invoices")) ? (get(body, "Invoices") as Record<string, unknown>[]) : [],
    summarise: (r) => `${String(r.InvoiceNumber)} · ${String(get(r, "Contact", "Name"))} · $${String(r.Total)}`,
  },
  {
    key: "quickbooks",
    label: "QuickBooks · Invoice",
    connectionId: "sim-nango-quickbooks",
    providerConfigKey: "quickbooks",
    model: "Invoice",
    readPath: `/proxy/v3/company/${QB_REALM}/query?query=${encodeURIComponent(QB_QUERY)}`,
    seed: (data, n) =>
      Array.from({ length: n }, (_, i) => ({
        Id: String(500 + i),
        TxnDate: new Date().toISOString().slice(0, 10),
        CustomerRef: { value: String(i + 1), name: pick(data.companies, i) },
        TotalAmt: pick(data.amounts, i),
        Line: [{ Amount: pick(data.amounts, i), Description: pick(data.dealTitles, i) }],
      })),
    // QuickBooks proxy returns { QueryResponse: { Invoice: [...] }, time }
    extract: (body) =>
      Array.isArray(get(body, "QueryResponse", "Invoice"))
        ? (get(body, "QueryResponse", "Invoice") as Record<string, unknown>[])
        : [],
    summarise: (r) => `${String(get(r, "CustomerRef", "name"))} · $${String(r.TotalAmt)}`,
  },
];

async function seedProvider(
  base: string,
  connectionId: string,
  p: ReadbackProvider,
  rows: Record<string, unknown>[],
): Promise<void> {
  const headers = { "Content-Type": "application/json", Authorization: "Bearer emulate-sim" };
  // 1. ensure the connection exists (records ingestion 404s without it)
  await fetch(`${base}/nango/connections`, {
    method: "POST",
    headers,
    body: JSON.stringify({ connection_id: connectionId, provider_config_key: p.providerConfigKey }),
  });
  // 2. append the unified records under the provider's model
  await fetch(`${base}/nango/connections/${encodeURIComponent(connectionId)}/records/${encodeURIComponent(p.model)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ records: rows }),
  });
}

/**
 * Seed Nango's store, then drive `/proxy` reads through the simulator engine
 * (carrying the required headers) and print the unified records returned.
 * Returns false if the server is unreachable.
 */
export async function nangoReadbackDemo(base: string, data: PersonaData, perProvider = 5): Promise<boolean> {
  // Run-scoped connection ids keep the demo deterministic: the records store is
  // in-memory and persists across persona runs, and ingestion *appends*, so a
  // stable id would accumulate. A fresh id per run reads back exactly what this
  // run seeded. The provider_config_key (sent as the proxy header) stays stable.
  const runId = Date.now().toString(36);
  const connFor = (p: ReadbackProvider): string => `${p.connectionId}-${runId}`;

  // Seed every provider's connection + records up front.
  const seeded = new Map<string, number>();
  for (const p of PROVIDERS) {
    const rows = p.seed(data, perProvider);
    try {
      await seedProvider(base, connFor(p), p, rows);
      seeded.set(p.key, rows.length);
    } catch {
      return false; // server down
    }
  }

  // Register a GET proxy-read generator per provider — each carries the headers
  // Nango's unified read surface requires. The engine merges them onto the
  // request alongside its own Authorization (the capability added in engine.ts).
  for (const p of PROVIDERS) {
    registerGenerator(`${p.key}-proxy-read`, () => ({
      kind: "native" as const,
      method: "GET",
      path: p.readPath,
      headers: { "Connection-Id": connFor(p), "Provider-Config-Key": p.providerConfigKey },
    }));
  }

  // Capture each proxy response so we can show what came back (the engine
  // itself is fire-and-forget; the injected fetch sees the body).
  const captured = new Map<string, unknown>();
  const realFetch = globalThis.fetch.bind(globalThis);
  const capturingFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const res = await realFetch(url, init);
    if ((init?.method ?? "GET") === "GET" && url.includes("/proxy/")) {
      try {
        captured.set(url, await res.clone().json());
      } catch {
        /* non-JSON — ignore */
      }
    }
    return res;
  };

  const yaml = [
    "streams:",
    ...PROVIDERS.map((p) =>
      [
        `  - name: read-${p.key}`,
        "    kind: native",
        `    provider: ${p.key}-proxy-read`,
        "    pathPrefix: /nango",
        "    ratePerMinute: 120",
      ].join("\n"),
    ),
  ].join("\n");

  // runOnce() ticks each stream sequentially and fully awaits each — one read
  // per provider, every response captured. (start()'s maxCount completion can
  // resolve before sibling reads settle, since the engine increments seq at
  // tick-start; runOnce sidesteps that for this deterministic one-shot demo.)
  const sim = new Simulator(loadScenario(yaml), { base, fetch: capturingFetch as never });
  await sim.runOnce();

  console.log(`\n  ── Nango unified read-back via /proxy (engine now forwards Connection-Id + Provider-Config-Key) ──`);
  for (const p of PROVIDERS) {
    // Match the captured response by this provider's read path.
    const probe = p.readPath.split("?")[0];
    let body: unknown;
    for (const [url, b] of captured) if (url.includes(probe)) body = b;
    const rows = body ? p.extract(body) : [];
    const seedN = seeded.get(p.key) ?? 0;
    const ok = rows.length > 0 ? "✓" : "·";
    console.log(
      `    ${ok} ${p.label.padEnd(24)} seeded ${String(seedN).padStart(2)} → proxy returned ${String(rows.length).padStart(2)}`,
    );
    if (rows[0]) console.log(`        e.g. ${p.summarise(rows[0])}`);
  }
  console.log(
    `\n    Each read was a GET /nango${PROVIDERS[0].readPath.split("?")[0]} … driven by the engine with the\n    Connection-Id + Provider-Config-Key headers — visible on ${base}/_activity as service \`nango\`.\n`,
  );
  return true;
}
