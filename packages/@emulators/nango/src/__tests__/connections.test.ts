import { describe, it, expect } from "vitest";
import { BASE, ORG_SEED, createTestApp, json, nangoStore } from "./helpers.js";
import type { NangoConnection } from "../index.js";

// Org-wide connection management: a single Nango account fans out to many
// linked SaaS accounts (QuickBooks / Xero / HubSpot / Salesforce / Slack).
describe("Nango connections — org-wide management", () => {
  it("lists every linked provider for the org and filters by provider_config_key", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const list = await app.request(`${BASE}/connection`);
    expect(list.status).toBe(200);
    const { connections } = (await list.json()) as { connections: NangoConnection[] };
    expect(connections.map((c) => c.provider_config_key).sort()).toEqual([
      "hubspot",
      "quickbooks",
      "salesforce",
      "slack",
      "xero",
    ]);

    const onlyXero = await app.request(`${BASE}/connection?provider_config_key=xero`);
    const filtered = (await onlyXero.json()) as { connections: NangoConnection[] };
    expect(filtered.connections).toHaveLength(1);
    expect(filtered.connections[0].id).toBe("xero-acme");
  });

  it("supports current /connections list filters without leaking credentials", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });
    await app.request(`${BASE}/connections/slack-acme?provider_config_key=slack`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: { Organization_ID: "org_acme", end_user_id: "u_1" } }),
    });

    const list = await app.request(`${BASE}/connections?tags[organization_id]=org_acme&search=u_1`);
    const body = (await list.json()) as { connections: Array<NangoConnection & { credentials?: unknown }> };
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ id: "slack-acme", tags: { organization_id: "org_acme" } });
    expect(body.connections[0].credentials).toBeUndefined();
  });

  it("fetches one connection with OAuth2 credentials + provider config", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const res = await app.request(`${BASE}/connections/quickbooks-acme`);
    expect(res.status).toBe(200);
    const conn = (await res.json()) as NangoConnection;
    expect(conn).toMatchObject({
      id: "quickbooks-acme",
      connection_id: "quickbooks-acme",
      provider: "quickbooks",
      provider_config_key: "quickbooks",
      connection_config: { realmId: "9341453644728342" },
      metadata: { organizationId: "org_acme" },
    });
    expect(conn.credentials.type).toBe("OAuth2");
    expect(conn.credentials.access_token).toBe("emulator-token-quickbooks-acme");
    expect(typeof conn.credentials.expires_at).toBe("string");
    expect(typeof conn.last_fetched_at).toBe("string");
  });

  it("unknown connection → 404 envelope", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });
    const res = await app.request(`${BASE}/connections/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Connection not found", connection_id: "does-not-exist" });
  });

  it("POST /connection registers a new provider link (201)", async () => {
    const { app } = createTestApp();

    const res = await app.request(
      `${BASE}/connection`,
      json({
        connection_id: "notion-acme",
        provider_config_key: "notion",
        connection_config: { workspaceId: "ws_1" },
        metadata: { organizationId: "org_acme" },
      }),
    );
    expect(res.status).toBe(201);
    const conn = (await res.json()) as NangoConnection;
    expect(conn).toMatchObject({
      id: "notion-acme",
      connection_id: "notion-acme",
      provider: "notion",
      provider_config_key: "notion",
      connection_config: { workspaceId: "ws_1" },
      metadata: { organizationId: "org_acme" },
    });
    expect(conn.credentials.type).toBe("OAuth2");

    // Now discoverable via the list endpoint.
    const list = await app.request(`${BASE}/connection?provider_config_key=notion`);
    expect(((await list.json()) as { connections: unknown[] }).connections).toHaveLength(1);
  });

  it("POST /connections upserts a connection and DELETE removes it", async () => {
    const { app } = createTestApp();

    const created = await app.request(
      `${BASE}/connections`,
      json({
        connection_id: "linear-acme",
        provider_config_key: "linear",
        credentials: { type: "OAuth2", access_token: "lin-token" },
        tags: { Organization_ID: "org_acme" },
      }),
    );
    expect(created.status).toBe(200);
    expect((await created.json()) as NangoConnection).toMatchObject({
      id: "linear-acme",
      provider_config_key: "linear",
      tags: { organization_id: "org_acme" },
      credentials: { access_token: "lin-token" },
    });

    const removed = await app.request(`${BASE}/connections/linear-acme?provider_config_key=linear`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true });
    expect((await app.request(`${BASE}/connections/linear-acme?provider_config_key=linear`)).status).toBe(404);
  });

  it("supports current bulk metadata set and patch routes", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const set = await app.request(
      `${BASE}/connections/metadata`,
      json({ connection_id: "hubspot-acme", provider_config_key: "hubspot", metadata: { folder: "base" } }),
    );
    expect(set.status).toBe(201);
    expect((await app.request(`${BASE}/connections/hubspot-acme?provider_config_key=hubspot`)).status).toBe(200);

    const patch = await app.request(`${BASE}/connections/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection_id: "hubspot-acme",
        provider_config_key: "hubspot",
        metadata: { cursor: "c1" },
      }),
    });
    expect(patch.status).toBe(200);
    const conn = (await (
      await app.request(`${BASE}/connections/hubspot-acme?provider_config_key=hubspot`)
    ).json()) as NangoConnection;
    expect(conn.metadata).toEqual({ folder: "base", cursor: "c1" });
  });

  it("PATCH and PUT metadata merge into the existing record; unknown → 404", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const patched = await app.request(`${BASE}/connection/hubspot-acme/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncCursor: "abc", lastSyncedAt: "2026-01-01" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as NangoConnection).metadata).toEqual({
      organizationId: "org_acme",
      syncCursor: "abc",
      lastSyncedAt: "2026-01-01",
    });

    const put = await app.request(`${BASE}/connection/hubspot-acme/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncCursor: "def" }),
    });
    expect(((await put.json()) as NangoConnection).metadata).toMatchObject({
      organizationId: "org_acme",
      syncCursor: "def",
      lastSyncedAt: "2026-01-01",
    });

    const missing = await app.request(`${BASE}/connection/nope/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });
    expect(missing.status).toBe(404);
  });

  it("?force_refresh=true rotates the access token + expiry", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const before = (await (await app.request(`${BASE}/connections/xero-acme`)).json()) as NangoConnection;
    const refreshed = (await (
      await app.request(`${BASE}/connections/xero-acme?force_refresh=true`)
    ).json()) as NangoConnection;

    expect(refreshed.credentials.access_token).not.toBe(before.credentials.access_token);
    expect(refreshed.credentials.access_token).toMatch(/^nango-refreshed-/);
    expect(refreshed.credentials.raw?.token_type).toBe("Bearer");
    expect(typeof refreshed.credentials.raw?.refreshed_at).toBe("string");
  });

  it("auto-refreshes when the stored token has already expired", async () => {
    const { app, store } = createTestApp({ seed: ORG_SEED });
    const conn = nangoStore(store).getConnection("slack-acme")!;
    const staleToken = conn.credentials.access_token;
    conn.credentials.expires_at = new Date(Date.now() - 60_000).toISOString();

    const res = await app.request(`${BASE}/connections/slack-acme`);
    const fresh = (await res.json()) as NangoConnection;
    expect(fresh.credentials.access_token).not.toBe(staleToken);
    expect(new Date(fresh.credentials.expires_at!).getTime()).toBeGreaterThan(Date.now());
  });
});
