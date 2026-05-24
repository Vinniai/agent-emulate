import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { hubspotPlugin } from "../index.js";

const base = "http://localhost:4000";

function mk() {
  const store = new Store();
  const app = new Hono();
  hubspotPlugin.register(app as never, store, new WebhookDispatcher(), base);
  return app;
}

describe("hubspot standalone direct-to-source", () => {
  it("token exchange + CRM object create/read at native /crm/v3 path", async () => {
    const app = mk();
    const cb = await app.request(`${base}/oauth/authorize/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "x",
        redirect_uri: "https://app.example.com/cb",
        scope: "crm.objects.contacts.write",
        state: "s1",
      }).toString(),
      redirect: "manual",
    });
    expect(cb.status).toBe(302);
    const code = new URL(cb.headers.get("location") ?? "").searchParams.get("code") ?? "";
    expect(code).toBeTruthy();

    const t = await app.request(`${base}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    });
    expect(t.status).toBe(200);
    const { access_token } = (await t.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    const auth = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
    const c = await app.request(`${base}/crm/v3/objects/contacts`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ properties: { email: "a@agent-emulate.dev", firstname: "Ada" } }),
    });
    expect(c.status).toBe(201);
    const { id } = (await c.json()) as { id: string };
    expect(id).toBeTruthy();

    const g = await app.request(`${base}/crm/v3/objects/contacts/${id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(g.status).toBe(200);
  });
});
