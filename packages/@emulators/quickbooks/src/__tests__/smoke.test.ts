import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { quickbooksPlugin } from "../index.js";

const base = "http://localhost:4000";

function mk() {
  const store = new Store();
  const app = new Hono();
  quickbooksPlugin.register(app as never, store, new WebhookDispatcher(), base);
  return app;
}

describe("quickbooks standalone direct-to-source", () => {
  it("bearer token + invoice create/read at native /v3/company path", async () => {
    const app = mk();
    const t = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    expect(t.status).toBe(200);
    const { access_token } = (await t.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    const auth = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
    const c = await app.request(`${base}/v3/company/123/invoice`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ Line: [{ Amount: 100 }] }),
    });
    expect(c.status).toBeLessThan(300);
    const { Invoice } = (await c.json()) as { Invoice: { Id: string } };
    expect(Invoice.Id).toBeTruthy();

    const g = await app.request(`${base}/v3/company/123/invoice/${Invoice.Id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(g.status).toBe(200);

    const d = await app.request(`${base}/webhook-deliveries`);
    expect(d.status).toBe(200);
  });
});
