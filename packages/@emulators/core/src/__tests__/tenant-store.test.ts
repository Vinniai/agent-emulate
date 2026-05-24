import { describe, it, expect } from "vitest";
import { TenantStore, withTenant, currentTenant, DEFAULT_TENANT } from "../tenant-store.js";
import { createServer } from "../server.js";
import type { ServicePlugin } from "../plugin.js";

interface Note {
  id: number;
  created_at: string;
  updated_at: string;
  text: string;
}

describe("withTenant / currentTenant", () => {
  it("defaults outside any scope", () => {
    expect(currentTenant()).toBe(DEFAULT_TENANT);
  });

  it("scopes the active tenant for the callback and restores after", () => {
    const seen = withTenant("acme", () => currentTenant());
    expect(seen).toBe("acme");
    expect(currentTenant()).toBe(DEFAULT_TENANT);
  });

  it("treats empty/undefined as the default tenant", () => {
    expect(withTenant(undefined, () => currentTenant())).toBe(DEFAULT_TENANT);
    expect(withTenant("", () => currentTenant())).toBe(DEFAULT_TENANT);
  });

  it("propagates across awaits", async () => {
    const seen = await withTenant("t1", async () => {
      await Promise.resolve();
      return currentTenant();
    });
    expect(seen).toBe("t1");
  });
});

describe("TenantStore", () => {
  it("isolates collections per tenant", () => {
    const store = new TenantStore();
    withTenant("a", () => store.collection<Note>("notes").insert({ text: "a-only" }));
    withTenant("b", () => store.collection<Note>("notes").insert({ text: "b-only" }));

    const a = withTenant("a", () => store.collection<Note>("notes").all());
    const b = withTenant("b", () => store.collection<Note>("notes").all());
    expect(a.map((n) => n.text)).toEqual(["a-only"]);
    expect(b.map((n) => n.text)).toEqual(["b-only"]);
  });

  it("isolates getData/setData per tenant", () => {
    const store = new TenantStore();
    withTenant("a", () => store.setData("k", 1));
    withTenant("b", () => store.setData("k", 2));
    expect(withTenant("a", () => store.getData("k"))).toBe(1);
    expect(withTenant("b", () => store.getData("k"))).toBe(2);
  });

  it("unscoped access resolves to the default tenant", () => {
    const store = new TenantStore();
    store.collection<Note>("notes").insert({ text: "unscoped" });
    const viaDefault = withTenant(DEFAULT_TENANT, () => store.collection<Note>("notes").all());
    expect(viaDefault.map((n) => n.text)).toEqual(["unscoped"]);
    expect(store.tenantIds()).toContain(DEFAULT_TENANT);
  });

  it("reset only clears the active tenant", () => {
    const store = new TenantStore();
    withTenant("a", () => store.collection<Note>("notes").insert({ text: "a" }));
    withTenant("b", () => store.collection<Note>("notes").insert({ text: "b" }));
    withTenant("a", () => store.reset());
    expect(withTenant("a", () => store.collection<Note>("notes").all())).toHaveLength(0);
    expect(withTenant("b", () => store.collection<Note>("notes").all())).toHaveLength(1);
  });
});

// A minimal provider that reads/writes the store per request — the common
// CRUD pattern that must isolate cleanly behind `createServer`.
const notesPlugin: ServicePlugin = {
  name: "notes",
  register(app, store) {
    app.post("/notes", async (c) => {
      const { text } = (await c.req.json()) as { text: string };
      return c.json(store.collection<Note>("notes").insert({ text }));
    });
    app.get("/notes", (c) => c.json(store.collection<Note>("notes").all()));
  },
};

describe("createServer multi-tenant wiring", () => {
  it("isolates tenants by X-Emulate-Tenant when enabled", async () => {
    const { app } = createServer(notesPlugin, { multiTenant: true });
    const mk = (tenant: string, text: string) =>
      app.request("/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Emulate-Tenant": tenant },
        body: JSON.stringify({ text }),
      });
    await mk("acme", "acme-note");
    await mk("globex", "globex-note");

    const acme = (await (await app.request("/notes", { headers: { "X-Emulate-Tenant": "acme" } })).json()) as Note[];
    const globex = (await (
      await app.request("/notes", { headers: { "X-Emulate-Tenant": "globex" } })
    ).json()) as Note[];

    expect(acme.map((n) => n.text)).toEqual(["acme-note"]);
    expect(globex.map((n) => n.text)).toEqual(["globex-note"]);
  });

  it("requests without the header share the default tenant", async () => {
    const { app } = createServer(notesPlugin, { multiTenant: true });
    await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "no-header" }),
    });
    const list = (await (await app.request("/notes")).json()) as Note[];
    expect(list.map((n) => n.text)).toEqual(["no-header"]);
  });

  it("is a single shared store when multiTenant is off (back-compat)", async () => {
    const { app } = createServer(notesPlugin);
    await app.request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Emulate-Tenant": "acme" },
      body: JSON.stringify({ text: "shared" }),
    });
    // A different tenant header still sees it — no isolation when off.
    const list = (await (await app.request("/notes", { headers: { "X-Emulate-Tenant": "globex" } })).json()) as Note[];
    expect(list.map((n) => n.text)).toEqual(["shared"]);
  });
});
