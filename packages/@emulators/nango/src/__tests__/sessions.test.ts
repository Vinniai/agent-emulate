import { describe, it, expect } from "vitest";
import { BASE, createTestApp, json } from "./helpers.js";
import type { NangoConnection } from "../index.js";

// Connect sessions are the org-onboarding entry point: the dashboard creates
// a short-lived session, the user authorises in the hosted UI, and
// /connect/complete materialises the connection.
describe("Nango connect sessions", () => {
  it("POST /connect/sessions returns a session token + connect link", async () => {
    const { app } = createTestApp();

    const res = await app.request(
      `${BASE}/connect/sessions`,
      json({
        end_user: { id: "user_1", tags: { organizationId: "org_acme", provider: "xero" } },
        allowed_integrations: ["xero"],
      }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { token: string; connect_link: string; expires_at: string } };
    expect(data.token).toMatch(/^nango_session_[0-9a-f]+$/);
    expect(data.connect_link).toBe(`${BASE}/connect?token=${data.token}`);
    expect(new Date(data.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("POST /connect/sessions/reconnect threads the existing connection id", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${BASE}/connect/sessions/reconnect`,
      json({
        end_user: { id: "user_1", tags: { organizationId: "org_acme" } },
        connection_id: "xero-acme",
        integration_id: "xero",
      }),
    );
    const { data } = (await res.json()) as { data: { token: string; connect_link: string } };
    expect(data.connect_link).toBe(`${BASE}/connect?token=${data.token}&reconnect=1&connection_id=xero-acme`);
  });

  it("GET /connect renders the hosted UI for a live session, expired card otherwise", async () => {
    const { app } = createTestApp();
    const created = await app.request(
      `${BASE}/connect/sessions`,
      json({ end_user: { id: "u" }, allowed_integrations: ["quickbooks"] }),
    );
    const { data } = (await created.json()) as { data: { token: string } };

    const live = await app.request(`${BASE}/connect?token=${data.token}`);
    const liveHtml = await live.text();
    expect(liveHtml).toContain("Connect QuickBooks");

    const expired = await app.request(`${BASE}/connect?token=bogus`);
    expect(await expired.text()).toContain("Session Expired");
  });

  it("POST /connect/complete materialises a Xero connection (tenantId seeded)", async () => {
    const { app } = createTestApp();
    const created = await app.request(
      `${BASE}/connect/sessions`,
      json({
        end_user: { id: "user_42", tags: { organizationId: "org_acme" } },
        allowed_integrations: ["xero"],
      }),
    );
    const { data } = (await created.json()) as { data: { token: string } };

    const done = await app.request(`${BASE}/connect/complete`, json({ token: data.token }));
    expect(done.status).toBe(200);
    const result = (await done.json()) as { ok: boolean; connectionId: string; redirectUrl: string };
    expect(result.ok).toBe(true);
    expect(result.connectionId).toMatch(/^conn_emu_/);
    expect(result.redirectUrl).toBe("/");

    const conn = (await (await app.request(`${BASE}/connections/${result.connectionId}`)).json()) as NangoConnection;
    expect(conn.provider).toBe("xero");
    expect(conn.connection_config.tenantId).toBe("emu-xero-tenant-00000000-0000-0000-0000-000000000001");
    expect(conn.metadata).toMatchObject({ organizationId: "org_acme", userId: "user_42" });

    // Session is single-use — completing again is a 404.
    const again = await app.request(`${BASE}/connect/complete`, json({ token: data.token }));
    expect(again.status).toBe(404);
  });

  it("QuickBooks completion seeds realmId + companyName in connection_config", async () => {
    const { app } = createTestApp();
    const created = await app.request(
      `${BASE}/connect/sessions`,
      json({ end_user: { id: "u" }, allowed_integrations: ["quickbooks"] }),
    );
    const { data } = (await created.json()) as { data: { token: string } };
    const done = await app.request(`${BASE}/connect/complete`, json({ token: data.token }));
    const { connectionId } = (await done.json()) as { connectionId: string };

    const conn = (await (await app.request(`${BASE}/connections/${connectionId}`)).json()) as NangoConnection;
    expect(conn.connection_config).toMatchObject({ realmId: "9341453644728342", companyName: "Emulator Company" });
  });

  it("POST /connect/complete with an unknown token → 404", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/connect/complete`, json({ token: "nango_session_missing" }));
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: "Session not found or expired" });
  });
});
