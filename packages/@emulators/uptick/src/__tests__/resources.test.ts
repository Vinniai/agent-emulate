import { describe, it, expect } from "vitest";
import { BASE, VER, auth, createTestApp, getAccessToken, DEFAULT_SEED } from "./helpers.js";

type JsonApiResource = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { type: string; id: string } | null }>;
};
type ListBody = { data: JsonApiResource[]; links: { next: string | null; prev: string | null } };
type SingleBody = { data: JsonApiResource };

describe("Uptick JSON:API envelope + resource CRUD", () => {
  it("OPTIONS exposes self-describing endpoint metadata", async () => {
    const { app } = createTestApp();

    const root = await app.request(`${BASE}/api/${VER}/`, { method: "OPTIONS" });
    expect(root.status).toBe(200);
    expect(root.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(await root.json()).toMatchObject({
      version: VER,
      endpoints: {
        clients: `/api/${VER}/clients/`,
        properties: `/api/${VER}/properties/`,
      },
    });

    const clients = await app.request(`${BASE}/api/${VER}/clients/`, { method: "OPTIONS" });
    expect(clients.status).toBe(200);
    expect(clients.headers.get("Allow")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
    expect(await clients.json()).toMatchObject({
      type: "Client",
      fields: { name: { type: "string", required: true } },
    });
  });

  it("list clients: { data: [...], links } with string ids and Client type", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/${VER}/clients/`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.links).toEqual({ next: null, prev: null });

    const client = body.data[0];
    expect(client.type).toBe("Client");
    expect(client.id).toBe("1");
    expect(typeof client.id).toBe("string");
    expect(client.attributes).toMatchObject({
      name: "Demo Property Group",
      company_name: "Demo Property Group",
      sector: "Commercial",
      ref: "DPG-001",
      is_active: true,
      archived: false,
      contact_email: "jane@agent-emulate.dev",
    });
    // contact_name is split into first/last for Nango sync compatibility
    expect(client.attributes.first_name).toBe("Jane");
    expect(client.attributes.last_name).toBe("Citizen");
    expect(typeof client.attributes.created_at).toBe("string");
    expect(typeof client.attributes.updated_at).toBe("string");
  });

  it("get single client by id → { data: resource }", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/clients/1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SingleBody;
    expect(body.data.type).toBe("Client");
    expect(body.data.id).toBe("1");
  });

  it("property carries flat address attrs + client relationship", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/properties/1`);
    const { data } = (await res.json()) as SingleBody;
    expect(data.type).toBe("Property");
    expect(data.attributes).toMatchObject({
      name: "Demo Building A",
      address_line_1: "1 Demo St",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      country: "AU",
      client_id: "1",
    });
    expect(data.relationships?.client).toEqual({ data: { type: "Client", id: "1" } });
  });

  it("asset resolves property/client/asset_type relationships", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/assets/1`);
    const { data } = (await res.json()) as SingleBody;
    expect(data.type).toBe("Asset");
    expect(data.attributes).toMatchObject({
      name: "Extinguisher 01",
      barcode: "EX-01",
      asset_number: "EX-01",
      asset_type_name: "Fire Extinguisher",
      property_id: "1",
      client_id: "1",
    });
    expect(data.relationships?.property).toEqual({ data: { type: "Property", id: "1" } });
    expect(data.relationships?.asset_type).toEqual({ data: { type: "AssetType", id: "1" } });
  });

  it("defect inherits property/client from its asset", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/defects/1`);
    const { data } = (await res.json()) as SingleBody;
    expect(data.type).toBe("Defect");
    expect(data.attributes).toMatchObject({
      description: "Gauge in red zone",
      severity: "high",
      status: "open",
      asset_id: "1",
      property_id: "1",
      client_id: "1",
      resolved_at: null,
    });
  });

  it("POST client uses JSON:API request body and returns 201", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/${VER}/clients/`, {
      method: "POST",
      headers: auth("t"),
      body: JSON.stringify({
        data: {
          type: "Client",
          attributes: { name: "Acme Co", sector: "Retail", contact_email: "ops@agent-emulate.dev" },
        },
      }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as SingleBody;
    expect(data.id).toBe("1");
    expect(data.attributes).toMatchObject({ name: "Acme Co", sector: "Retail", is_active: true });
  });

  it("POST property links client via relationships", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/properties/`, {
      method: "POST",
      headers: auth("t"),
      body: JSON.stringify({
        data: {
          type: "Property",
          attributes: { name: "Tower B", address: { streetline: "9 High St", city: "Sydney", state: "NSW" } },
          relationships: { client: { data: { type: "Client", id: "1" } } },
        },
      }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as SingleBody;
    expect(data.attributes).toMatchObject({ name: "Tower B", address_line_1: "9 High St", suburb: "Sydney" });
    expect(data.relationships?.client).toEqual({ data: { type: "Client", id: "1" } });
  });

  it("PATCH client merges attributes and returns 200", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/clients/1`, {
      method: "PATCH",
      headers: auth("t"),
      body: JSON.stringify({ data: { attributes: { sector: "Industrial", is_active: false } } }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as SingleBody;
    expect(data.attributes).toMatchObject({
      name: "Demo Property Group", // unchanged
      sector: "Industrial", // changed
      is_active: false,
      archived: true, // inverse of is_active
    });
  });
});

describe("Uptick error envelope", () => {
  it("unknown id → 404 { errors: [{ status, title }] }", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/clients/9999`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { errors: Array<{ status: string; title: string }> };
    expect(body.errors).toEqual([{ status: "404", title: "Not Found" }]);
  });

  it("non-numeric id → 400 Invalid ID", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/${VER}/assets/not-a-number`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ status: string; title: string }> };
    expect(body.errors[0]).toEqual({ status: "400", title: "Invalid ID" });
  });
});

describe("Uptick filtering", () => {
  const seed = {
    ...DEFAULT_SEED,
    clients: [
      { name: "Active Co", contact_email: "a@agent-emulate.dev" },
      { name: "Archived Co", is_active: false, contact_email: "b@agent-emulate.dev" },
    ],
    properties: [],
    assets: [],
    defects: [
      { description: "d-open", status: "open", client_name: "Active Co" },
      { description: "d-closed", status: "closed", client_name: "Active Co" },
    ],
  };

  it("clients?is_active=false returns only archived", async () => {
    const { app } = createTestApp({ seed });
    const res = await app.request(`${BASE}/api/${VER}/clients/?is_active=false`);
    const body = (await res.json()) as ListBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].attributes.name).toBe("Archived Co");
  });

  it("clients?search= matches name", async () => {
    const { app } = createTestApp({ seed });
    const res = await app.request(`${BASE}/api/${VER}/clients/?search=archived`);
    const body = (await res.json()) as ListBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].attributes.name).toBe("Archived Co");
  });

  it("defects?status=closed exposes resolved_at", async () => {
    const { app } = createTestApp({ seed });
    const res = await app.request(`${BASE}/api/${VER}/defects/?status=closed`);
    const body = (await res.json()) as ListBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].attributes.status).toBe("closed");
    expect(body.data[0].attributes.resolved_at).not.toBeNull();
  });
});

describe("Uptick pagination (JSON:API page[limit]/page[offset] + cursor)", () => {
  const manyClients = Array.from({ length: 5 }, (_, i) => ({
    name: `C${i}`,
    contact_email: `c${i}@agent-emulate.dev`,
  }));
  const seed = { clients: manyClients, properties: [], assets: [], defects: [] };

  it("page[limit]/page[offset] slices and sets links.next", async () => {
    const { app } = createTestApp({ seed });
    const res = await app.request(`${BASE}/api/${VER}/clients/?page[limit]=2&page[offset]=0`);
    const body = (await res.json()) as ListBody;
    expect(body.data).toHaveLength(2);
    expect(body.links.prev).toBeNull();
    expect(body.links.next).toContain("page[offset]=2");

    const page2 = await app.request(`${BASE}/api/${VER}/clients/?page[limit]=2&page[offset]=2`);
    const page2Body = (await page2.json()) as ListBody;
    expect(page2Body.data).toHaveLength(2);
    expect(page2Body.links.prev).toContain("page[offset]=0");
    expect(page2Body.links.next).toContain("page[offset]=4");

    const last = await app.request(`${BASE}/api/${VER}/clients/?page[limit]=2&page[offset]=4`);
    const lastBody = (await last.json()) as ListBody;
    expect(lastBody.data).toHaveLength(1);
    expect(lastBody.links.next).toBeNull();
  });

  it("cursor pagination round-trips via base64 page[cursor]", async () => {
    const { app } = createTestApp({ seed });
    const first = await app.request(`${BASE}/api/${VER}/clients/?page[cursor]=&page[size]=2`);
    const firstBody = (await first.json()) as ListBody;
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.links.next).toContain("page[cursor]=");

    const next = await app.request(firstBody.links.next!);
    const nextBody = (await next.json()) as ListBody;
    expect(nextBody.data).toHaveLength(2);
    expect(nextBody.data[0].attributes.name).toBe("C2");
  });
});

describe("Uptick incremental sync (updatedsince) — polling existing providers", () => {
  it("updatedsince in the future returns nothing; in the past returns all", async () => {
    const { app } = createTestApp();
    const future = await app.request(`${BASE}/api/${VER}/clients/?updatedsince=2099-01-01T00:00:00Z`);
    expect(((await future.json()) as ListBody).data).toHaveLength(0);

    const past = await app.request(`${BASE}/api/${VER}/clients/?updatedsince=2000-01-01T00:00:00Z`);
    expect(((await past.json()) as ListBody).data).toHaveLength(1);
  });

  it("PATCHing an existing record bumps updated_at so a poller re-syncs it", async () => {
    const { app } = createTestApp();

    const before = (await (await app.request(`${BASE}/api/${VER}/clients/1`)).json()) as SingleBody;
    const beforeUpdated = String(before.data.attributes.updated_at);

    const patched = await app.request(`${BASE}/api/${VER}/clients/1`, {
      method: "PATCH",
      headers: auth("t"),
      body: JSON.stringify({ data: { attributes: { sector: "Changed" } } }),
    });
    const after = (await patched.json()) as SingleBody;
    const afterUpdated = String(after.data.attributes.updated_at);

    expect(after.data.attributes.sector).toBe("Changed");
    expect(new Date(afterUpdated).getTime()).toBeGreaterThanOrEqual(new Date(beforeUpdated).getTime());

    // A poller that filters on the pre-change watermark still includes the
    // mutated record (boundary is inclusive: updated_at >= updatedsince).
    const resync = await app.request(`${BASE}/api/${VER}/clients/?updatedsince=${encodeURIComponent(beforeUpdated)}`);
    const resyncBody = (await resync.json()) as ListBody;
    expect(resyncBody.data.map((d) => d.id)).toContain("1");
  });
});

describe("Uptick reference + discovery endpoints", () => {
  it("GET /api/version/ reports latest + lifecycle arrays", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/version/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ deprecated: [], imminent_removal: [], removed: [] });
    expect(typeof body.latest).toBe("string");
  });

  it("GET /api/:ver/ returns the resource index", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/${VER}/`);
    const body = (await res.json()) as Record<string, string>;
    expect(body.clients).toBe(`/api/${VER}/clients/`);
    expect(body.assets).toBe(`/api/${VER}/assets/`);
    expect(body.defects).toBe(`/api/${VER}/defects/`);
  });

  it("assettypes + users are JSON:API lists", async () => {
    const { app } = createTestApp();
    const at = (await (await app.request(`${BASE}/api/${VER}/assettypes/`)).json()) as ListBody;
    expect(at.data[0].type).toBe("AssetType");
    expect(at.data[0].attributes.name).toBe("Fire Extinguisher");

    const users = (await (await app.request(`${BASE}/api/${VER}/users/`)).json()) as ListBody;
    expect(users.data[0].type).toBe("User");
    expect(users.data[0].attributes).toMatchObject({ username: "tech1", email: "tech@agent-emulate.dev" });
  });
});
