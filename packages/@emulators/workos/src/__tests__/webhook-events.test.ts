// WorkOS webhook lifecycle events — proves the emulator emits org/user/membership
// events so a downstream sync (e.g. a Convex tenant model) has something to
// subscribe to. The real WorkOS fires these on the same lifecycle changes.
//
// Capture is done by injecting a fake `fetch` into the WebhookDispatcher: each
// delivery POSTs the event envelope `{ id, event, data, created_at }` as its
// body, so we collect bodies instead of standing up an HTTP listener.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher, createApiErrorHandler, createErrorHandler } from "@emulators/core";
import { workosPlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:14011";

interface Captured {
  event: string;
  data: Record<string, unknown>;
}

function createTestApp() {
  const captured: Captured[] = [];
  // 0ms backoff is irrelevant here (the sink always 200s) but keeps it snappy.
  const webhooks = new WebhookDispatcher({
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { event: string; data: Record<string, unknown> };
      captured.push({ event: body.event, data: body.data });
      return new Response(null, { status: 200 });
    },
  });
  const store = new Store();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  workosPlugin.register(app as any, store, webhooks, base);
  seedFromConfig(store, base, {
    organizations: [{ id: "org_a", name: "Acme", slug: "acme" }],
    users: [{ id: "user_1", email: "ann@agent-emulate.dev", first_name: "Ann" }],
  });
  // Subscribe to everything WorkOS emits.
  webhooks.register({ url: `${base}/sink`, events: ["*"], active: true, owner: "workos" });
  return { app, captured };
}

const POST = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("WorkOS webhook events — organization lifecycle", () => {
  let app: Hono;
  let captured: Captured[];
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    captured = t.captured;
  });

  it("emits organization.created on POST /user_management/organizations", async () => {
    const res = await app.request(`${base}/user_management/organizations`, POST({ name: "Globex" }));
    expect(res.status).toBe(201);
    const evt = captured.find((c) => c.event === "organization.created");
    expect(evt).toBeDefined();
    expect(evt?.data).toMatchObject({ object: "organization", name: "Globex" });
  });
});

describe("WorkOS webhook events — user lifecycle", () => {
  let app: Hono;
  let captured: Captured[];
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    captured = t.captured;
  });

  it("emits user.created on POST /user_management/users", async () => {
    const res = await app.request(`${base}/user_management/users`, POST({ email: "bob@agent-emulate.dev" }));
    expect(res.status).toBe(201);
    const evt = captured.find((c) => c.event === "user.created");
    expect(evt?.data).toMatchObject({ object: "user", email: "bob@agent-emulate.dev" });
  });

  it("emits user.updated on PUT", async () => {
    const res = await app.request(`${base}/user_management/users/user_1`, {
      ...POST({ first_name: "Annette" }),
      method: "PUT",
    });
    expect(res.status).toBe(200);
    const evt = captured.find((c) => c.event === "user.updated");
    expect(evt?.data).toMatchObject({ id: "user_1", first_name: "Annette" });
  });

  it("emits user.deleted on DELETE with the deleted user's identity", async () => {
    const res = await app.request(`${base}/user_management/users/user_1`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const evt = captured.find((c) => c.event === "user.deleted");
    expect(evt?.data).toMatchObject({ id: "user_1", email: "ann@agent-emulate.dev" });
  });
});

describe("WorkOS webhook events — membership lifecycle", () => {
  let app: Hono;
  let captured: Captured[];
  beforeEach(() => {
    const t = createTestApp();
    app = t.app;
    captured = t.captured;
  });

  it("emits organization_membership.created then .deleted", async () => {
    const create = await app.request(
      `${base}/user_management/organization_memberships`,
      POST({ user_id: "user_1", organization_id: "org_a", role_slug: "admin" }),
    );
    expect(create.status).toBe(201);
    const created = captured.find((c) => c.event === "organization_membership.created");
    expect(created?.data).toMatchObject({
      object: "organization_membership",
      user_id: "user_1",
      organization_id: "org_a",
    });
    const membershipId = (created?.data as { id: string }).id;

    const del = await app.request(`${base}/user_management/organization_memberships/${membershipId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    const deleted = captured.find((c) => c.event === "organization_membership.deleted");
    expect(deleted?.data).toMatchObject({ id: membershipId, status: "inactive" });
  });

  it("422s a membership create missing organization_id", async () => {
    const res = await app.request(`${base}/user_management/organization_memberships`, POST({ user_id: "user_1" }));
    expect(res.status).toBe(422);
  });
});
