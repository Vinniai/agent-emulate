import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { makeNativePlugin, type NativeSpec } from "../index.js";

const base = "http://localhost:4000";

const spec: NativeSpec = {
  name: "demo",
  tokenPath: "/oauth/token",
  tokenPrefix: "demo",
  models: [
    {
      model: "Widget",
      collectionPath: "/v1/widgets",
      idField: "id",
      rows: [
        { id: "w1", name: "Alpha" },
        { id: "w2", name: "Beta" },
      ],
    },
  ],
};

function mk() {
  const { plugin, seedFromConfig, storeToSeedConfig } = makeNativePlugin(spec);
  const store = new Store();
  const app = new Hono();
  plugin.register(app as never, store, new WebhookDispatcher(), base);
  return { app, store, plugin, seedFromConfig, storeToSeedConfig };
}

describe("native-kit makeNativePlugin", () => {
  it("issues a bearer token at the configured token path", async () => {
    const { app } = mk();
    const r = await app.request(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { access_token: string; token_type: string };
    expect(b.access_token.startsWith("demo_at_")).toBe(true);
    expect(b.token_type).toBe("bearer");
  });

  it("serves seeded rows at the native collection path and enforces bearer", async () => {
    const { app, store, plugin } = mk();
    plugin.seed?.(store, base);

    const unauth = await app.request(`${base}/v1/widgets`);
    expect(unauth.status).toBe(401);

    const r = await app.request(`${base}/v1/widgets`, { headers: { Authorization: "Bearer x" } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { data: unknown[]; total: number; model: string };
    expect(body.total).toBe(2);
    expect(body.model).toBe("Widget");
  });

  it("supports create / read / update / delete", async () => {
    const { app, store, plugin } = mk();
    plugin.seed?.(store, base);
    const auth = { Authorization: "Bearer x", "Content-Type": "application/json" };

    const c = await app.request(`${base}/v1/widgets`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: "w3", name: "Gamma" }),
    });
    expect(c.status).toBe(201);

    const g = await app.request(`${base}/v1/widgets/w3`, { headers: auth });
    expect(g.status).toBe(200);
    expect(((await g.json()) as { name: string }).name).toBe("Gamma");

    const p = await app.request(`${base}/v1/widgets/w3`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ name: "Gamma2" }),
    });
    expect(((await p.json()) as { name: string }).name).toBe("Gamma2");

    const d = await app.request(`${base}/v1/widgets/w3`, { method: "DELETE", headers: auth });
    expect(d.status).toBe(204);
    const gone = await app.request(`${base}/v1/widgets/w3`, { headers: auth });
    expect(gone.status).toBe(404);
  });

  it("storeToSeedConfig round-trips through seedFromConfig", async () => {
    const { app, store, plugin, seedFromConfig, storeToSeedConfig } = mk();
    plugin.seed?.(store, base);
    await app.request(`${base}/v1/widgets`, {
      method: "POST",
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "w9", name: "Zeta" }),
    });

    const exported = storeToSeedConfig(store, base);
    expect(exported.records?.Widget?.length).toBe(3);

    const fresh = new Store();
    seedFromConfig(fresh, base, exported);
    const fa = new Hono();
    plugin.register(fa as never, fresh, new WebhookDispatcher(), base);
    const r = await fa.request(`${base}/v1/widgets`, { headers: { Authorization: "Bearer x" } });
    expect(((await r.json()) as { total: number }).total).toBe(3);
  });
});

// Phase 3.1 — per-provider response parity. Each dialect must emit the exact
// list envelope, pagination contract and error body the provider's real SDK
// strict-parses (deserialization fails otherwise).
const rows = (n: number, field = "id"): Array<Record<string, unknown>> =>
  Array.from({ length: n }, (_, i) => ({ [field]: i + 1, name: `r${i + 1}` }));

function mkDialect(s: NativeSpec) {
  const { plugin } = makeNativePlugin(s);
  const store = new Store();
  const app = new Hono();
  plugin.register(app as never, store, new WebhookDispatcher(), base);
  plugin.seed?.(store, base);
  const auth = { Authorization: "Bearer x" };
  return { app, auth };
}

describe("native-kit response dialects", () => {
  it("jira: search-style { startAt, maxResults, total, issues } + offset paging", async () => {
    const { app, auth } = mkDialect({
      name: "jira",
      dialect: "jira",
      models: [{ model: "Issue", collectionPath: "/rest/api/3/issue", idField: "id", rows: rows(5) }],
    });

    const r = await app.request(`${base}/rest/api/3/issue?startAt=2&maxResults=2`, { headers: auth });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { startAt: number; maxResults: number; total: number; issues: unknown[] };
    expect(b.startAt).toBe(2);
    expect(b.maxResults).toBe(2);
    expect(b.total).toBe(5);
    // native-kit stringifies row ids on seed; assert the page window, not types.
    expect(b.issues.map((x) => String((x as { id: unknown }).id))).toEqual(["3", "4"]);

    const u = await app.request(`${base}/rest/api/3/issue`);
    expect(u.status).toBe(401);
    expect((await u.json()) as { errorMessages: string[] }).toHaveProperty("errorMessages");
  });

  it("zendesk: { tickets, count, next_page, previous_page } cursor URLs", async () => {
    const { app, auth } = mkDialect({
      name: "zendesk",
      dialect: "zendesk",
      models: [{ model: "Ticket", collectionPath: "/api/v2/tickets", idField: "id", rows: rows(3) }],
    });

    const r = await app.request(`${base}/api/v2/tickets?page=1&per_page=2`, { headers: auth });
    const b = (await r.json()) as {
      tickets: unknown[];
      count: number;
      next_page: string | null;
      previous_page: string | null;
    };
    expect(b.tickets.length).toBe(2);
    expect(b.count).toBe(3);
    expect(b.previous_page).toBeNull();
    expect(b.next_page).toContain("page=2");

    const r2 = await app.request(`${base}/api/v2/tickets?page=2&per_page=2`, { headers: auth });
    const b2 = (await r2.json()) as { tickets: unknown[]; next_page: string | null; previous_page: string | null };
    expect(b2.tickets.length).toBe(1);
    expect(b2.next_page).toBeNull();
    expect(b2.previous_page).toContain("page=1");

    const u = await app.request(`${base}/api/v2/tickets`);
    expect(u.status).toBe(401);
    expect((await u.json()) as { error: string }).toEqual({ error: "Couldn't authenticate you" });
  });

  it("shopify: { products } body + Link header cursor pagination", async () => {
    const { app, auth } = mkDialect({
      name: "shopify",
      dialect: "shopify",
      models: [{ model: "Product", collectionPath: "/admin/api/2024-01/products", idField: "id", rows: rows(3) }],
    });

    const r = await app.request(`${base}/admin/api/2024-01/products?limit=2`, { headers: auth });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { products: unknown[]; data?: unknown };
    expect(b.products.length).toBe(2);
    expect(b.data).toBeUndefined();
    const link = r.headers.get("Link") ?? "";
    expect(link).toContain('rel="next"');
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    expect(next).toBeTruthy();

    const r2 = await app.request(next!, { headers: auth });
    const b2 = (await r2.json()) as { products: unknown[] };
    expect(b2.products.length).toBe(1);
    expect(r2.headers.get("Link") ?? "").toContain('rel="previous"');

    const u = await app.request(`${base}/admin/api/2024-01/products`);
    expect(u.status).toBe(401);
    expect((await u.json()) as { errors: string }).toHaveProperty("errors");
  });

  it("default dialect is unchanged ({ data, total, model })", async () => {
    const { app, auth } = mkDialect({
      name: "demo2",
      models: [{ model: "Widget", collectionPath: "/v1/widgets", idField: "id", rows: rows(2) }],
    });
    const r = await app.request(`${base}/v1/widgets`, { headers: auth });
    const b = (await r.json()) as { data: unknown[]; total: number; model: string };
    expect(b.total).toBe(2);
    expect(b.model).toBe("Widget");
    expect(b.data.length).toBe(2);
  });
});

describe("native-kit token endpoint grant validation", () => {
  const token = (body: string) =>
    mk().app.request(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

  it("keeps the lax happy path: no credentials still mints a token", async () => {
    const r = await token("grant_type=client_credentials");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { access_token: string }).access_token.startsWith("demo_at_")).toBe(true);
  });

  it("mints a token for a well-formed authorization_code / refresh_token / password grant", async () => {
    expect((await token("grant_type=authorization_code&code=abc123")).status).toBe(200);
    expect((await token("grant_type=refresh_token&refresh_token=demo_rt_x")).status).toBe(200);
    expect((await token("grant_type=password&username=a&password=b")).status).toBe(200);
  });

  it("rejects an unknown grant_type with unsupported_grant_type (400)", async () => {
    const r = await token("grant_type=magic");
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("requires code for authorization_code and refresh_token for refresh_token", async () => {
    const a = await token("grant_type=authorization_code");
    expect(a.status).toBe(400);
    expect(((await a.json()) as { error: string }).error).toBe("invalid_request");
    const b = await token("grant_type=refresh_token");
    expect(b.status).toBe(400);
    expect(((await b.json()) as { error: string }).error).toBe("invalid_request");
  });

  it("returns invalid_client (401) for a sentinel client credential", async () => {
    const r = await token("grant_type=client_credentials&client_id=invalid&client_secret=x");
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe("invalid_client");
  });

  it("returns invalid_grant (400) for a sentinel code / refresh_token / password", async () => {
    const c1 = await token("grant_type=authorization_code&code=invalid_code");
    expect(c1.status).toBe(400);
    expect(((await c1.json()) as { error: string }).error).toBe("invalid_grant");

    const c2 = await token("grant_type=refresh_token&refresh_token=invalid-token");
    expect(((await c2.json()) as { error: string }).error).toBe("invalid_grant");

    const c3 = await token("grant_type=password&username=u&password=invalid");
    expect(((await c3.json()) as { error: string }).error).toBe("invalid_grant");
  });
});
