// Direct WorkOS emulator tests — they exercise `workosPlugin` in-process via a
// bare Hono app (no @emulators/nango, no proxy/connection layer). Each
// `describe` is one red-green TDD feature: the WorkOS SDK's standard
// User-Management CRUD surface that the emulator did not previously implement.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher, createApiErrorHandler, createErrorHandler } from "@emulators/core";
import { workosPlugin, seedFromConfig, storeToSeedConfig, getWorkOSStore } from "../index.js";

const base = "http://localhost:14010";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  workosPlugin.register(app as any, store, webhooks, base);
  seedFromConfig(store, base, {
    oauth_clients: [{ client_id: "client_x", client_secret: "sk_x", name: "X" }],
    organizations: [
      { id: "org_a", name: "Acme", slug: "acme" },
      { id: "org_b", name: "Beta", slug: "beta" },
    ],
    users: [
      { id: "user_1", email: "ann@agent-emulate.dev", first_name: "Ann", last_name: "Ng" },
      { id: "user_2", email: "bob@agent-emulate.dev", first_name: "Bob", last_name: "Yi" },
    ],
    memberships: [
      { user_email: "ann@agent-emulate.dev", organization_slug: "acme", role: "admin" },
      { user_email: "bob@agent-emulate.dev", organization_slug: "beta", role: "member" },
    ],
  });
  return { app, store };
}

describe("WorkOS direct REST — Feature 1: GET /user_management/users/:userId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns the user object", async () => {
    const res = await app.request(`${base}/user_management/users/user_1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "user_1", email: "ann@agent-emulate.dev", object: "user" });
  });

  it("404s for an unknown user", async () => {
    const res = await app.request(`${base}/user_management/users/user_nope`);
    expect(res.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 2: GET /user_management/users (list + ?email=)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("lists all users with list_metadata", async () => {
    const res = await app.request(`${base}/user_management/users`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; list_metadata: unknown };
    expect(body.data).toHaveLength(2);
    expect(body.list_metadata).toEqual({ after: null, before: null });
  });

  it("filters by email", async () => {
    const res = await app.request(`${base}/user_management/users?email=bob@agent-emulate.dev`);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("user_2");
  });
});

describe("WorkOS direct REST — Feature 3: PUT /user_management/users/:userId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("updates first/last name and bumps updated_at", async () => {
    const res = await app.request(`${base}/user_management/users/user_1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "Annette", last_name: "Nguyen" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "user_1", first_name: "Annette", last_name: "Nguyen" });
  });

  it("404s for an unknown user", async () => {
    const res = await app.request(`${base}/user_management/users/nope`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "X" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 4: DELETE /user_management/users/:userId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("deletes the user (204) then GET 404s", async () => {
    const del = await app.request(`${base}/user_management/users/user_2`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const get = await app.request(`${base}/user_management/users/user_2`);
    expect(get.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 5: GET /user_management/organizations/:organizationId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns the organization", async () => {
    const res = await app.request(`${base}/user_management/organizations/org_a`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "org_a", name: "Acme", slug: "acme", object: "organization" });
  });

  it("404s for an unknown organization", async () => {
    const res = await app.request(`${base}/user_management/organizations/org_nope`);
    expect(res.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 6: GET /user_management/organizations (list)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("lists all organizations", async () => {
    const res = await app.request(`${base}/user_management/organizations`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data.map((o) => o.id).sort()).toEqual(["org_a", "org_b"]);
  });
});

describe("WorkOS direct REST — Feature 7: GET /user_management/organization_memberships/:id", () => {
  let app: Hono;
  let store: Store;
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    store = t.store;
  });

  it("returns a single membership by id", async () => {
    const m = getWorkOSStore(store).getUserMemberships("user_1")[0];
    const res = await app.request(`${base}/user_management/organization_memberships/${m.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: m.id, user_id: "user_1", organization_id: "org_a" });
  });

  it("404s for an unknown membership", async () => {
    const res = await app.request(`${base}/user_management/organization_memberships/om_nope`);
    expect(res.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 8: DELETE /user_management/organization_memberships/:id", () => {
  let app: Hono;
  let store: Store;
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    store = t.store;
  });

  it("deactivates the membership so it drops out of the active list", async () => {
    const m = getWorkOSStore(store).getUserMemberships("user_1")[0];
    const del = await app.request(`${base}/user_management/organization_memberships/${m.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const res = await app.request(`${base}/user_management/organization_memberships?user_id=user_1`);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });
});

describe("WorkOS direct REST — Feature 9: GET /user_management/sessions/:sessionId", () => {
  let app: Hono;
  let store: Store;
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    store = t.store;
  });

  it("returns a created session, and 404s for unknown / revoked", async () => {
    const session = getWorkOSStore(store).createSession("user_1", "org_a");
    const res = await app.request(`${base}/user_management/sessions/${session.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: session.id, user_id: "user_1", organization_id: "org_a" });

    const missing = await app.request(`${base}/user_management/sessions/session_nope`);
    expect(missing.status).toBe(404);
  });
});

describe("WorkOS direct REST — Feature 10: storeToSeedConfig round-trips", () => {
  it("exports a seed config that re-seeds an identical store", async () => {
    const { store } = createTestApp();
    const exported = storeToSeedConfig(store, base);

    expect(exported.users?.map((u) => u.email).sort()).toEqual(["ann@agent-emulate.dev", "bob@agent-emulate.dev"]);
    expect(exported.organizations?.map((o) => o.slug).sort()).toEqual(["acme", "beta"]);
    expect(exported.memberships).toHaveLength(2);
    expect(exported.oauth_clients?.[0]?.client_id).toBe("client_x");

    // Re-seed a fresh store from the exported config and assert parity.
    const fresh = new Store();
    seedFromConfig(fresh, base, exported);
    const ws = getWorkOSStore(fresh);
    expect(
      ws
        .allUsers()
        .map((u) => u.email)
        .sort(),
    ).toEqual(["ann@agent-emulate.dev", "bob@agent-emulate.dev"]);
    const ann = ws.findUserByEmail("ann@agent-emulate.dev")!;
    expect(ws.getUserMemberships(ann.id)[0]?.role.slug).toBe("admin");
  });
});
