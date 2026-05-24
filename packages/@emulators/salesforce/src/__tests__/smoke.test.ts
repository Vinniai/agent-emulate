import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { salesforcePlugin } from "../index.js";

const base = "http://localhost:4000";

function mk() {
  const store = new Store();
  const app = new Hono();
  salesforcePlugin.register(app as never, store, new WebhookDispatcher(), base);
  return app;
}

describe("salesforce standalone direct-to-source", () => {
  it("password-grant token + sObject create/read at native /services/data path", async () => {
    const app = mk();
    const t = await app.request(`${base}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", username: "u", password: "p" }).toString(),
    });
    expect(t.status).toBe(200);
    const { access_token } = (await t.json()) as { access_token: string };
    expect(access_token).toMatch(/^00D/);

    const auth = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
    const c = await app.request(`${base}/services/data/v59.0/sobjects/Account`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ Name: "Acme" }),
    });
    expect(c.status).toBe(201);
    const { id } = (await c.json()) as { id: string };
    expect(id).toBeTruthy();

    const g = await app.request(`${base}/services/data/v59.0/sobjects/Account/${id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(g.status).toBe(200);
  });

  it("rejects unauthenticated sObject create", async () => {
    const app = mk();
    const r = await app.request(`${base}/services/data/v59.0/sobjects/Account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(401);
  });
});
