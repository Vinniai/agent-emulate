import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BASE, createTestApp, json } from "./helpers.js";

// ---------------------------------------------------------------------------
// Direct Xero — stateful write surface + the real end-to-end chain:
//   create invoice → Xero → signed webhook to our registered destination.
// Xero POSTs an events batch (eventCategory="INVOICE", eventType="CREATE")
// signed base64-HMAC-SHA256 of the exact body under `x-xero-signature`.
// ---------------------------------------------------------------------------

interface Captured {
  headers: Record<string, string>;
  body: string;
}

/** Throwaway HTTP destination; resolves once it captures one webhook. */
function receiver(): { url: string; next: () => Promise<Captured>; close: () => void } {
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
    url: `http://127.0.0.1:${port}/xero-hook`,
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

const X = `${BASE}/xero-emu`;
const API = `${X}/api.xro/2.0`;
const auth = { Authorization: "Bearer xero_test", "Content-Type": "application/json" };

let open: { close: () => void } | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

describe("Direct Xero — OAuth2 + tenants", () => {
  it("issues a Bearer token for client_credentials", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${X}/connect/token`, form({ grant_type: "client_credentials" }));
    expect(r.status).toBe(200);
    const t = (await r.json()) as { access_token: string; token_type: string };
    expect(t.token_type).toBe("Bearer");
    expect(t.access_token).toMatch(/^xero_at_/);
  });

  it("rejects an unsupported grant", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${X}/connect/token`, form({ grant_type: "weird" }));
    expect(r.status).toBe(400);
  });

  it("lists tenants with a stable tenantId", async () => {
    const { app } = createTestApp();
    const a = (await (await app.request(`${X}/connections`, { headers: auth })).json()) as Array<{
      tenantId: string;
      tenantType: string;
    }>;
    const b = (await (await app.request(`${X}/connections`, { headers: auth })).json()) as Array<{ tenantId: string }>;
    expect(a[0]!.tenantType).toBe("ORGANISATION");
    expect(a[0]!.tenantId).toBe(b[0]!.tenantId);
  });

  it("401s API calls without a Bearer token", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${API}/Invoices`);
    expect(r.status).toBe(401);
    expect((await r.json()) as object).toMatchObject({ Status: 401, Title: "Unauthorized" });
  });
});

describe("Direct Xero — create invoice + read-back", () => {
  it("creates an invoice in the Xero envelope, computing Total from LineItems", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${API}/Invoices`, {
      ...json({
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { Name: "Acme Pty Ltd" },
            LineItems: [
              { Description: "Inspection", Quantity: 2, UnitAmount: 150 },
              { Description: "Callout", LineAmount: 90 },
            ],
          },
        ],
      }),
      headers: auth,
    });
    expect(r.status).toBe(200);
    const env = (await r.json()) as { Status: string; Invoices: Array<Record<string, unknown>> };
    expect(env.Status).toBe("OK");
    const inv = env.Invoices[0]!;
    expect(typeof inv.InvoiceID).toBe("string");
    expect(inv.InvoiceNumber).toBe("INV-0001");
    expect(inv.Status).toBe("AUTHORISED");
    expect(inv.Total).toBe(2 * 150 + 90);

    const got = (await (await app.request(`${API}/Invoices/${inv.InvoiceID as string}`, { headers: auth })).json()) as {
      Invoices: Array<{ InvoiceID: string }>;
    };
    expect(got.Invoices[0]!.InvoiceID).toBe(inv.InvoiceID);

    const list = (await (await app.request(`${API}/Invoices`, { headers: auth })).json()) as {
      Invoices: unknown[];
    };
    expect(list.Invoices).toHaveLength(1);
  });

  it("accepts a bare invoice object (no Invoices wrapper)", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${API}/Invoices`, {
      ...json({ Type: "ACCREC", Total: 500 }),
      headers: auth,
    });
    const env = (await r.json()) as { Invoices: Array<{ Total: number }> };
    expect(env.Invoices[0]!.Total).toBe(500);
  });
});

describe("Direct Xero — invoice.create → webhook → our destination", () => {
  it("delivers a signed Xero events webhook to the registered URL", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp();
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "xero_whk" }));

    const created = (await (
      await app.request(`${API}/Invoices`, {
        ...json({ Invoices: [{ Contact: { Name: "Acme" }, LineItems: [{ LineAmount: 250 }] }] }),
        headers: auth,
      })
    ).json()) as { Invoices: Array<{ InvoiceID: string }> };
    const invoiceId = created.Invoices[0]!.InvoiceID;

    const hit = await rcv.next();
    const payload = JSON.parse(hit.body) as {
      events: Array<{ eventCategory: string; eventType: string; resourceId: string; resourceUrl: string }>;
      firstEventSequence: number;
    };
    expect(payload.events[0]).toMatchObject({
      eventCategory: "INVOICE",
      eventType: "CREATE",
      resourceId: invoiceId,
    });
    expect(payload.events[0]!.resourceUrl).toContain(`/Invoices/${invoiceId}`);
    expect(payload.firstEventSequence).toBe(1);

    // Faithful Xero signature: base64 HMAC-SHA256 of the exact body.
    expect(hit.headers["x-xero-signature"]).toBe(createHmac("sha256", "xero_whk").update(hit.body).digest("base64"));

    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: Array<{ event: string; url: string; success: boolean }>;
    };
    expect(list.deliveries).toHaveLength(1);
    expect(list.deliveries[0]).toMatchObject({ event: "provider", url: rcv.url, success: true });
  });

  it("create still succeeds (and records nothing) with no destination set", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${API}/Invoices`, { ...json({ Total: 10 }), headers: auth });
    expect(r.status).toBe(200);
    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as { deliveries: unknown[] };
    expect(list.deliveries).toHaveLength(0);
  });
});
