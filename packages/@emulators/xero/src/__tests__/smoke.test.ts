import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { xeroPlugin } from "../index.js";

const base = "http://localhost:4000";

function mk() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const app = new Hono();
  xeroPlugin.register(app as never, store, webhooks, base);
  return { app, store };
}

const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});
const json = (o: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer xero_at" },
  body: JSON.stringify(o),
});

describe("xero standalone direct-to-source", () => {
  let app: Hono;
  beforeEach(() => {
    app = mk().app;
  });

  it("serves the OAuth token at the native /connect/token (no /xero-emu prefix)", async () => {
    const r = await app.request(`${base}/connect/token`, form({ grant_type: "client_credentials" }));
    expect(r.status).toBe(200);
    const b = (await r.json()) as { access_token: string };
    expect(typeof b.access_token).toBe("string");
  });

  it("creates and lists an invoice at the native /api.xro/2.0 path", async () => {
    const c = await app.request(`${base}/api.xro/2.0/Invoices`, json({ Total: 42 }));
    expect(c.status).toBeLessThan(300);
    const created = (await c.json()) as { Invoices?: Array<{ InvoiceID: string }> };
    const id = created.Invoices?.[0]?.InvoiceID;
    expect(id).toBeTruthy();

    const l = await app.request(`${base}/api.xro/2.0/Invoices`, {
      headers: { Authorization: "Bearer xero_at" },
    });
    expect(l.status).toBe(200);
  });
});
