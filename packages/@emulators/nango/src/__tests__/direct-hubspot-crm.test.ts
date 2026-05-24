// Direct HubSpot CRM v3 tests — stateful object API mounted under the nango
// plugin (no proxy / connection layer). Each `describe` is one red-green TDD
// feature covering the CRM surface a real integration exercises: object CRUD
// (contacts/companies/deals), CRM Search, batch create/read, v4 associations,
// and auth enforcement. The pre-existing direct-hubspot.ts only covered OAuth,
// so every endpoint below is a genuine missing surface.
import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";

const H = `${BASE}/hubspot-emu/crm`;
const authH = { Authorization: "Bearer hat_test", "Content-Type": "application/json" };

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: authH,
  body: JSON.stringify(body),
});

interface HsObject {
  id: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

describe("HubSpot CRM v3 — Feature 1: POST /objects/contacts (create)", () => {
  it("creates a contact and returns 201 with a numeric id + echoed properties", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${H}/v3/objects/contacts`,
      post({ properties: { email: "ada@agent-emulate.dev", firstname: "Ada", lastname: "Lovelace" } }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as HsObject;
    expect(body.id).toMatch(/^\d+$/);
    expect(body.properties.email).toBe("ada@agent-emulate.dev");
    expect(body.archived).toBe(false);
    expect(body.createdAt).toBeTruthy();
  });
});

describe("HubSpot CRM v3 — Feature 2: GET /objects/contacts (list)", () => {
  it("returns a results array including the created contact", async () => {
    const { app } = createTestApp();
    await app.request(`${H}/v3/objects/contacts`, post({ properties: { email: "a@agent-emulate.dev" } }));
    const res = await app.request(`${H}/v3/objects/contacts`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: HsObject[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.some((r) => r.properties.email === "a@agent-emulate.dev")).toBe(true);
  });
});

describe("HubSpot CRM v3 — Feature 3: GET /objects/contacts/:id", () => {
  it("returns the single object by id", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(`${H}/v3/objects/contacts`, post({ properties: { email: "byid@agent-emulate.dev" } }))
    ).json()) as HsObject;
    const res = await app.request(`${H}/v3/objects/contacts/${created.id}`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HsObject;
    expect(body.id).toBe(created.id);
    expect(body.properties.email).toBe("byid@agent-emulate.dev");
  });
});

describe("HubSpot CRM v3 — Feature 4: PATCH /objects/contacts/:id", () => {
  it("updates properties and a GET reflects it", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(
        `${H}/v3/objects/contacts`,
        post({ properties: { email: "p@agent-emulate.dev", lastname: "Old" } }),
      )
    ).json()) as HsObject;
    const patch = await app.request(`${H}/v3/objects/contacts/${created.id}`, {
      method: "PATCH",
      headers: authH,
      body: JSON.stringify({ properties: { lastname: "New" } }),
    });
    expect(patch.status).toBe(200);
    const got = (await (
      await app.request(`${H}/v3/objects/contacts/${created.id}`, { headers: authH })
    ).json()) as HsObject;
    expect(got.properties.lastname).toBe("New");
    expect(got.properties.email).toBe("p@agent-emulate.dev");
  });
});

describe("HubSpot CRM v3 — Feature 5: DELETE /objects/contacts/:id", () => {
  it("archives the object (204) and a later GET 404s", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(`${H}/v3/objects/contacts`, post({ properties: { email: "d@agent-emulate.dev" } }))
    ).json()) as HsObject;
    const del = await app.request(`${H}/v3/objects/contacts/${created.id}`, { method: "DELETE", headers: authH });
    expect(del.status).toBe(204);
    const get = await app.request(`${H}/v3/objects/contacts/${created.id}`, { headers: authH });
    expect(get.status).toBe(404);
  });
});

describe("HubSpot CRM v3 — Feature 6: POST /objects/contacts/search", () => {
  it("filters by a property and returns total + matching results", async () => {
    const { app } = createTestApp();
    await app.request(
      `${H}/v3/objects/contacts`,
      post({ properties: { email: "match@agent-emulate.dev", lifecyclestage: "lead" } }),
    );
    await app.request(
      `${H}/v3/objects/contacts`,
      post({ properties: { email: "other@agent-emulate.dev", lifecyclestage: "customer" } }),
    );
    const res = await app.request(
      `${H}/v3/objects/contacts/search`,
      post({
        filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "lead" }] }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; results: HsObject[] };
    expect(body.total).toBe(1);
    expect(body.results[0].properties.email).toBe("match@agent-emulate.dev");
  });
});

describe("HubSpot CRM v3 — Feature 7: POST /objects/companies/batch/create", () => {
  it("creates multiple companies in one COMPLETE batch", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${H}/v3/objects/companies/batch/create`,
      post({ inputs: [{ properties: { name: "Acme" } }, { properties: { name: "Globex" } }] }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; results: HsObject[] };
    expect(body.status).toBe("COMPLETE");
    expect(body.results).toHaveLength(2);
    expect(body.results.map((r) => r.properties.name).sort()).toEqual(["Acme", "Globex"]);
  });
});

describe("HubSpot CRM v3 — Feature 8: POST /objects/deals/batch/read", () => {
  it("reads multiple deals by id", async () => {
    const { app } = createTestApp();
    const d1 = (await (
      await app.request(`${H}/v3/objects/deals`, post({ properties: { dealname: "D1", amount: "100" } }))
    ).json()) as HsObject;
    const d2 = (await (
      await app.request(`${H}/v3/objects/deals`, post({ properties: { dealname: "D2", amount: "200" } }))
    ).json()) as HsObject;
    const res = await app.request(`${H}/v3/objects/deals/batch/read`, post({ inputs: [{ id: d1.id }, { id: d2.id }] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: HsObject[] };
    expect(body.results.map((r) => r.properties.dealname).sort()).toEqual(["D1", "D2"]);
  });
});

describe("HubSpot CRM v3 — Feature 9: v4 associations", () => {
  it("PUT then GET an association between a contact and a company", async () => {
    const { app } = createTestApp();
    const contact = (await (
      await app.request(`${H}/v3/objects/contacts`, post({ properties: { email: "assoc@agent-emulate.dev" } }))
    ).json()) as HsObject;
    const company = (await (
      await app.request(`${H}/v3/objects/companies`, post({ properties: { name: "AssocCo" } }))
    ).json()) as HsObject;

    const put = await app.request(`${H}/v4/objects/contacts/${contact.id}/associations/companies/${company.id}`, {
      method: "PUT",
      headers: authH,
    });
    expect(put.status).toBe(200);

    const res = await app.request(`${H}/v4/objects/contacts/${contact.id}/associations/companies`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ toObjectId: string }> };
    expect(body.results.some((r) => String(r.toObjectId) === company.id)).toBe(true);
  });
});

describe("HubSpot CRM v3 — Feature 10: auth enforcement", () => {
  it("rejects a missing Authorization header with 401 INVALID_AUTHENTICATION", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${H}/v3/objects/contacts`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { category: string };
    expect(body.category).toBe("INVALID_AUTHENTICATION");
  });
});
