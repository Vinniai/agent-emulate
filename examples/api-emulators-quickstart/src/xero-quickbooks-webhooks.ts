// Direct Xero + QuickBooks — the full "create invoice → provider → signed
// webhook to OUR destination" chain, end to end, no Nango envelope anywhere.
//
// Both emulators live under the nango plugin as *direct* native surfaces
// (alongside directSalesforce / directHubspot). This demo:
//
//   1. stands up a throwaway HTTP destination (a real listening socket),
//   2. registers it via POST /webhook-settings (url + signing secret),
//   3. obtains an OAuth2 token from each provider's real token endpoint,
//   4. creates an invoice through each provider's native write API,
//   5. proves the provider POSTed our destination its *own* webhook shape —
//      Xero's `events[]` batch under `x-xero-signature`, QuickBooks'
//      `eventNotifications[]` under `intuit-signature` — each signed
//      base64-HMAC-SHA256 of the exact body with our secret,
//   6. follows the webhook's resource pointer back to GET the new invoice,
//   7. confirms /webhook-deliveries logged both as successful.
//
// Every signature is re-derived locally and compared byte-for-byte. Exits
// non-zero on any failed assertion so it doubles as a contract test.
//
//   pnpm --filter api-emulators-quickstart xero-quickbooks-webhooks
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nangoPlugin } from "@emulators/nango";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4040";
const XERO = `${BASE}/xero-emu`;
const XERO_API = `${XERO}/api.xro/2.0`;
const QB = `${BASE}/quickbooks-emu`;
const REALM = "9341452148978632";
const QB_CO = `${QB}/v3/company/${REALM}`;
const SECRET = "whk_shared_secret";

interface Captured {
  headers: Record<string, string>;
  body: string;
}

/** A real HTTP destination — the provider webhook is delivered over a socket. */
function receiver(path: string): { url: string; next: () => Promise<Captured>; close: () => void } {
  const queue: Captured[] = [];
  const waiters: ((c: Captured) => void)[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const cap: Captured = {
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
        ),
        body,
      };
      const w = waiters.shift();
      if (w) w(cap);
      else queue.push(cap);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  srv.listen(0);
  const port = (srv.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}${path}`,
    next: () =>
      new Promise<Captured>((resolve) => {
        const q = queue.shift();
        if (q) resolve(q);
        else waiters.push(resolve);
      }),
    close: () => srv.close(),
  };
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

const jsonInit = (body: unknown, token: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

const checks: Array<[string, boolean, string]> = [];
const assert = (name: string, pass: boolean, detail: string): void => {
  checks.push([name, pass, detail]);
  console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(40)} (${detail})`);
};

async function main(): Promise<void> {
  const emu = mount(nangoPlugin, BASE);
  const rcv = receiver("/inbound-hook");

  try {
    heading("Register our destination (POST /webhook-settings)");
    const ws = await emu.app.request(`${BASE}/webhook-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: rcv.url, secret: SECRET }),
    });
    console.log(`  POST /webhook-settings → ${ws.status}  (url=${rcv.url})`);

    // ---------------- Xero: token → create invoice → webhook --------------
    heading("Xero — OAuth2 token, create invoice, await signed webhook");

    const xTok = (await (
      await emu.app.request(`${XERO}/connect/token`, form({ grant_type: "client_credentials" }))
    ).json()) as { access_token: string };
    console.log(`  POST /xero-emu/connect/token → access_token ${xTok.access_token.slice(0, 16)}…`);

    const xCreated = (await (
      await emu.app.request(
        `${XERO_API}/Invoices`,
        jsonInit(
          {
            Invoices: [
              {
                Type: "ACCREC",
                Contact: { Name: "Acme Pty Ltd" },
                LineItems: [
                  { Description: "Annual fire inspection", Quantity: 2, UnitAmount: 150 },
                  { Description: "Callout", LineAmount: 90 },
                ],
              },
            ],
          },
          xTok.access_token,
        ),
      )
    ).json()) as { Invoices: Array<{ InvoiceID: string; InvoiceNumber: string; Total: number }> };
    const xInv = xCreated.Invoices[0]!;
    console.log(`  POST /api.xro/2.0/Invoices → ${xInv.InvoiceNumber} (Total ${xInv.Total})`);

    const xHit = await rcv.next();
    const xPayload = JSON.parse(xHit.body) as {
      events: Array<{ eventCategory: string; eventType: string; resourceId: string; resourceUrl: string }>;
      firstEventSequence: number;
    };
    const xEvent = xPayload.events[0]!;
    const xExpectedSig = createHmac("sha256", SECRET).update(xHit.body).digest("base64");
    console.log(`  ← webhook  events[0]=${xEvent.eventCategory}/${xEvent.eventType}  resourceId=${xEvent.resourceId}`);
    console.log(`    x-xero-signature: ${(xHit.headers["x-xero-signature"] ?? "").slice(0, 24)}…`);

    assert(
      "xero webhook category/type",
      xEvent.eventCategory === "INVOICE" && xEvent.eventType === "CREATE",
      `${xEvent.eventCategory}/${xEvent.eventType}`,
    );
    assert(
      "xero webhook points at new invoice",
      xEvent.resourceId === xInv.InvoiceID,
      `${xEvent.resourceId === xInv.InvoiceID}`,
    );
    assert(
      "xero signature is faithful base64 HMAC",
      xHit.headers["x-xero-signature"] === xExpectedSig,
      "byte-for-byte",
    );

    // Follow the webhook's resourceUrl back to pull the record (real flow).
    const xPath = new URL(xEvent.resourceUrl).pathname;
    const xRead = (await (
      await emu.app.request(`${BASE}${xPath}`, { headers: { Authorization: `Bearer ${xTok.access_token}` } })
    ).json()) as { Invoices: Array<{ InvoiceID: string }> };
    console.log(`  GET ${xPath} → InvoiceID ${xRead.Invoices[0]!.InvoiceID}`);
    assert("xero resourceUrl round-trips", xRead.Invoices[0]!.InvoiceID === xInv.InvoiceID, "GET via webhook pointer");

    // ------------- QuickBooks: token → create invoice → webhook -----------
    heading("QuickBooks — OAuth2 token, create invoice, await signed webhook");

    const qTok = (await (
      await emu.app.request(`${QB}/oauth2/v1/tokens/bearer`, form({ grant_type: "authorization_code" }))
    ).json()) as { access_token: string };
    console.log(`  POST /quickbooks-emu/oauth2/v1/tokens/bearer → access_token ${qTok.access_token.slice(0, 16)}…`);

    const qCreated = (await (
      await emu.app.request(
        `${QB_CO}/invoice`,
        jsonInit(
          {
            CustomerRef: { value: "1", name: "Acme" },
            Line: [
              { Amount: 150, DetailType: "SalesItemLineDetail" },
              { Amount: 90, DetailType: "SalesItemLineDetail" },
            ],
          },
          qTok.access_token,
        ),
      )
    ).json()) as { Invoice: { Id: string; DocNumber: string; TotalAmt: number } };
    const qInv = qCreated.Invoice;
    console.log(`  POST /v3/company/${REALM}/invoice → Doc ${qInv.DocNumber} (TotalAmt ${qInv.TotalAmt})`);

    const qHit = await rcv.next();
    const qPayload = JSON.parse(qHit.body) as {
      eventNotifications: Array<{
        realmId: string;
        dataChangeEvent: { entities: Array<{ name: string; id: string; operation: string }> };
      }>;
    };
    const qEntity = qPayload.eventNotifications[0]!.dataChangeEvent.entities[0]!;
    const qExpectedSig = createHmac("sha256", SECRET).update(qHit.body).digest("base64");
    console.log(
      `  ← webhook  entity=${qEntity.name}/${qEntity.operation}  id=${qEntity.id}  realmId=${qPayload.eventNotifications[0]!.realmId}`,
    );
    console.log(`    intuit-signature: ${(qHit.headers["intuit-signature"] ?? "").slice(0, 24)}…`);

    assert(
      "quickbooks webhook entity/op",
      qEntity.name === "Invoice" && qEntity.operation === "Create",
      `${qEntity.name}/${qEntity.operation}`,
    );
    assert("quickbooks webhook points at new invoice", qEntity.id === qInv.Id, `${qEntity.id === qInv.Id}`);
    assert("quickbooks realmId echoed", qPayload.eventNotifications[0]!.realmId === REALM, REALM);
    assert(
      "quickbooks signature is faithful base64 HMAC",
      qHit.headers["intuit-signature"] === qExpectedSig,
      "byte-for-byte",
    );

    const qRead = (await (
      await emu.app.request(`${QB_CO}/invoice/${qEntity.id}`, {
        headers: { Authorization: `Bearer ${qTok.access_token}` },
      })
    ).json()) as { Invoice: { Id: string } };
    console.log(`  GET /v3/company/${REALM}/invoice/${qEntity.id} → Id ${qRead.Invoice.Id}`);
    assert("quickbooks webhook id round-trips", qRead.Invoice.Id === qInv.Id, "GET by webhook id");

    // ------------------------ Delivery log -------------------------------
    heading("Delivery log (GET /webhook-deliveries)");
    const log = (await (await emu.app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: Array<{ event: string; url: string; success: boolean }>;
    };
    for (const d of log.deliveries) console.log(`  • ${d.event}  ${d.url}  success=${d.success}`);
    assert("both deliveries logged", log.deliveries.length === 2, `${log.deliveries.length} == 2`);
    assert(
      "every delivery succeeded to our destination",
      log.deliveries.every((d) => d.event === "provider" && d.success && d.url === rcv.url),
      "all provider/success",
    );

    heading("Result");
    const ok = checks.every(([, p]) => p);
    const passed = checks.filter(([, p]) => p).length;
    console.log(`  ${passed}/${checks.length} assertions passed`);
    console.log(
      `\n${ok ? "✅" : "❌"} create invoice → Xero/QuickBooks → signed webhook → our destination ${ok ? "verified end-to-end (both providers, signatures faithful, resource pointers round-trip)" : "FAILED"}.\n`,
    );
    if (!ok) process.exit(1);
  } finally {
    rcv.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
