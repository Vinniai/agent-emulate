// Direct Uptick tests — they drive `uptickPlugin` in-process via a bare Hono
// app (no @emulators/nango / proxy / connection layer). Each `describe` is one
// red-green TDD feature filling a real Uptick JSON:API gap the emulator did
// not implement: resource DELETE (clients/properties/assets/defects), create
// endpoints for the read-only reference resources (assettypes/users),
// compound documents (`?include=`), JSON:API bracket-notation filters
// (`?filter[...]`), a `severity` defect filter, and the nested
// `/assets/:id/defects/` sub-resource list.
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createTestApp, BASE, VER, auth, getAccessToken } from "./helpers.js";

interface ListResponse {
  data: Array<{ type: string; id: string; attributes: Record<string, unknown> }>;
  included?: Array<{ type: string; id: string }>;
}

async function token(app: Hono): Promise<string> {
  return getAccessToken(app);
}

describe("Uptick direct — Feature 1: DELETE /api/:ver/clients/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes the client (204) and a later GET 404s", async () => {
    const t = await token(app);
    const del = await app.request(`${BASE}/api/${VER}/clients/1`, { method: "DELETE", headers: auth(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${BASE}/api/${VER}/clients/1`, { headers: auth(t) });
    expect(get.status).toBe(404);
  });
});

describe("Uptick direct — Feature 2: DELETE /api/:ver/properties/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes the property (204)", async () => {
    const t = await token(app);
    const del = await app.request(`${BASE}/api/${VER}/properties/1`, { method: "DELETE", headers: auth(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${BASE}/api/${VER}/properties/1`, { headers: auth(t) });
    expect(get.status).toBe(404);
  });
});

describe("Uptick direct — Feature 3: DELETE /api/:ver/assets/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes the asset (204)", async () => {
    const t = await token(app);
    const del = await app.request(`${BASE}/api/${VER}/assets/1`, { method: "DELETE", headers: auth(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${BASE}/api/${VER}/assets/1`, { headers: auth(t) });
    expect(get.status).toBe(404);
  });
});

describe("Uptick direct — Feature 4: DELETE /api/:ver/defects/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes the defect (204) and a later GET 404s", async () => {
    const t = await token(app);
    const del = await app.request(`${BASE}/api/${VER}/defects/1`, { method: "DELETE", headers: auth(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${BASE}/api/${VER}/defects/1`, { headers: auth(t) });
    expect(get.status).toBe(404);
  });
});

describe("Uptick direct — Feature 5: POST /api/:ver/assettypes/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("creates an asset type and returns a 201 JSON:API resource", async () => {
    const t = await token(app);
    const res = await app.request(`${BASE}/api/${VER}/assettypes/`, {
      method: "POST",
      headers: auth(t),
      body: JSON.stringify({
        data: { type: "AssetType", attributes: { name: "Fire Door", description: "Rated door" } },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { type: string; id: string; attributes: { name: string } } };
    expect(body.data.type).toBe("AssetType");
    expect(body.data.attributes.name).toBe("Fire Door");

    const list = (await (
      await app.request(`${BASE}/api/${VER}/assettypes/`, { headers: auth(t) })
    ).json()) as ListResponse;
    expect(list.data.some((r) => r.attributes.name === "Fire Door")).toBe(true);
  });
});

describe("Uptick direct — Feature 6: POST /api/:ver/users/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("creates a user and returns a 201 JSON:API resource", async () => {
    const t = await token(app);
    const res = await app.request(`${BASE}/api/${VER}/users/`, {
      method: "POST",
      headers: auth(t),
      body: JSON.stringify({
        data: {
          type: "User",
          attributes: { username: "tech2", email: "tech2@agent-emulate.dev", first_name: "Sam", last_name: "Stone" },
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { type: string; attributes: { username: string } } };
    expect(body.data.type).toBe("User");
    expect(body.data.attributes.username).toBe("tech2");
  });
});

describe("Uptick direct — Feature 7: GET /api/:ver/defects/?include=asset", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("returns a top-level included array with the related asset", async () => {
    const t = await token(app);
    const res = await app.request(`${BASE}/api/${VER}/defects/?include=asset`, { headers: auth(t) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(Array.isArray(body.included)).toBe(true);
    expect(body.included!.some((r) => r.type === "Asset")).toBe(true);
  });
});

describe("Uptick direct — Feature 8: GET /api/:ver/defects/?filter[status]=", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("treats filter[status] like the bare status filter", async () => {
    const t = await token(app);
    const open = (await (
      await app.request(`${BASE}/api/${VER}/defects/?filter[status]=open`, { headers: auth(t) })
    ).json()) as ListResponse;
    expect(open.data.length).toBe(1);

    const closed = (await (
      await app.request(`${BASE}/api/${VER}/defects/?filter[status]=closed`, { headers: auth(t) })
    ).json()) as ListResponse;
    expect(closed.data.length).toBe(0);
  });
});

describe("Uptick direct — Feature 9: GET /api/:ver/defects/?severity=", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("filters defects by severity (bare and bracket notation)", async () => {
    const t = await token(app);
    const high = (await (
      await app.request(`${BASE}/api/${VER}/defects/?severity=high`, { headers: auth(t) })
    ).json()) as ListResponse;
    expect(high.data.length).toBe(1);

    const low = (await (
      await app.request(`${BASE}/api/${VER}/defects/?filter[severity]=low`, { headers: auth(t) })
    ).json()) as ListResponse;
    expect(low.data.length).toBe(0);
  });
});

describe("Uptick direct — Feature 10: GET /api/:ver/assets/:id/defects/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("lists the defects belonging to that asset", async () => {
    const t = await token(app);
    const res = await app.request(`${BASE}/api/${VER}/assets/1/defects/`, { headers: auth(t) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(body.data.length).toBe(1);
    expect(body.data[0].type).toBe("Defect");
    expect(body.data[0].attributes.asset_id).toBe("1");
  });
});
