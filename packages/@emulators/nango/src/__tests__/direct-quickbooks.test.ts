import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BASE, createTestApp, json } from "./helpers.js";

// ---------------------------------------------------------------------------
// Direct QuickBooks Online — stateful write surface + the real end-to-end
// chain: create invoice → QuickBooks → signed Event Notification to our
// registered destination. QuickBooks POSTs an `eventNotifications` batch
// (dataChangeEvent.entities[].operation="Create") signed base64-HMAC-SHA256
// of the exact body under `intuit-signature`.
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
    url: `http://127.0.0.1:${port}/qb-hook`,
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

const QB = `${BASE}/quickbooks-emu`;
const REALM = "9341452148978632";
const COMPANY = `${QB}/v3/company/${REALM}`;
const auth = { Authorization: "Bearer qb_test", "Content-Type": "application/json" };

let open: { close: () => void } | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

describe("Direct QuickBooks — OAuth2", () => {
  it("issues a bearer token for authorization_code", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${QB}/oauth2/v1/tokens/bearer`, form({ grant_type: "authorization_code" }));
    expect(r.status).toBe(200);
    const t = (await r.json()) as { access_token: string; token_type: string; refresh_token: string };
    expect(t.token_type).toBe("bearer");
    expect(t.access_token).toMatch(/^qb_at_/);
    expect(t.refresh_token).toMatch(/^qb_rt_/);
  });

  it("rejects an unsupported grant", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${QB}/oauth2/v1/tokens/bearer`, form({ grant_type: "weird" }));
    expect(r.status).toBe(400);
  });

  it("401s API calls without a Bearer token (QuickBooks fault shape)", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${COMPANY}/query?query=SELECT * FROM Invoice`);
    expect(r.status).toBe(401);
    expect((await r.json()) as object).toMatchObject({ fault: { type: "AUTHENTICATION" } });
  });
});

describe("Direct QuickBooks — create invoice + read-back", () => {
  it("creates an invoice, computing TotalAmt/Balance from Line amounts", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${COMPANY}/invoice`, {
      ...json({
        Line: [
          { Amount: 150, DetailType: "SalesItemLineDetail" },
          { Amount: 90, DetailType: "SalesItemLineDetail" },
        ],
        CustomerRef: { value: "1", name: "Acme" },
      }),
      headers: auth,
    });
    expect(r.status).toBe(200);
    const env = (await r.json()) as { Invoice: Record<string, unknown> };
    const inv = env.Invoice;
    expect(typeof inv.Id).toBe("string");
    expect(inv.SyncToken).toBe("0");
    expect(inv.domain).toBe("QBO");
    expect(inv.TotalAmt).toBe(240);
    expect(inv.Balance).toBe(240);

    const got = (await (await app.request(`${COMPANY}/invoice/${inv.Id as string}`, { headers: auth })).json()) as {
      Invoice: { Id: string };
    };
    expect(got.Invoice.Id).toBe(inv.Id);

    const q = (await (
      await app.request(`${COMPANY}/query?query=${encodeURIComponent("SELECT * FROM Invoice")}`, { headers: auth })
    ).json()) as { QueryResponse: { Invoice: unknown[]; totalCount: number } };
    expect(q.QueryResponse.Invoice).toHaveLength(1);
    expect(q.QueryResponse.totalCount).toBe(1);
  });

  it("honours a caller-supplied TotalAmt", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${COMPANY}/invoice`, { ...json({ TotalAmt: 500 }), headers: auth });
    const env = (await r.json()) as { Invoice: { TotalAmt: number } };
    expect(env.Invoice.TotalAmt).toBe(500);
  });

  it("404s an unknown invoice with the QuickBooks fault shape", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${COMPANY}/invoice/does-not-exist`, { headers: auth });
    expect(r.status).toBe(404);
    expect((await r.json()) as object).toMatchObject({ fault: { type: "ValidationFault" } });
  });
});

describe("Direct QuickBooks — invoice.create → webhook → our destination", () => {
  it("delivers a signed QuickBooks Event Notification to the registered URL", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp();
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "qb_whk" }));

    const created = (await (
      await app.request(`${COMPANY}/invoice`, {
        ...json({ Line: [{ Amount: 250 }], CustomerRef: { value: "1" } }),
        headers: auth,
      })
    ).json()) as { Invoice: { Id: string } };
    const invoiceId = created.Invoice.Id;

    const hit = await rcv.next();
    const payload = JSON.parse(hit.body) as {
      eventNotifications: Array<{
        realmId: string;
        dataChangeEvent: { entities: Array<{ name: string; id: string; operation: string }> };
      }>;
    };
    const note = payload.eventNotifications[0]!;
    expect(note.realmId).toBe(REALM);
    expect(note.dataChangeEvent.entities[0]).toMatchObject({
      name: "Invoice",
      id: invoiceId,
      operation: "Create",
    });

    // Faithful QuickBooks signature: base64 HMAC-SHA256 of the exact body.
    expect(hit.headers["intuit-signature"]).toBe(createHmac("sha256", "qb_whk").update(hit.body).digest("base64"));

    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: Array<{ event: string; url: string; success: boolean }>;
    };
    expect(list.deliveries).toHaveLength(1);
    expect(list.deliveries[0]).toMatchObject({ event: "provider", url: rcv.url, success: true });
  });

  it("create still succeeds (and records nothing) with no destination set", async () => {
    const { app } = createTestApp();
    const r = await app.request(`${COMPANY}/invoice`, { ...json({ TotalAmt: 10 }), headers: auth });
    expect(r.status).toBe(200);
    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as { deliveries: unknown[] };
    expect(list.deliveries).toHaveLength(0);
  });
});
