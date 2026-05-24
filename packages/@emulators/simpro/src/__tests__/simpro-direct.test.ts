// Direct Simpro tests — they drive `simproPlugin` in-process via a bare Hono
// app (no @emulators/nango / proxy / connection layer). Each `describe` is one
// red-green TDD feature filling a real Simpro Build v1.0 REST gap the emulator
// did not implement: schedule PATCH, the full timesheet write lifecycle
// (POST/PATCH/DELETE), webhook PATCH, site-scoped contact create + single GET,
// and the top-level catalog write lifecycle (POST/PATCH/DELETE). The existing
// route files only register a subset of verbs for each of these resources, so
// every feature below is a genuine missing surface.
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createTestApp, BASE, auth as authHeaders, getAccessToken } from "./helpers.js";

const C = `${BASE}/api/v1.0/companies/0`;

async function token(app: Hono): Promise<string> {
  return getAccessToken(app);
}

async function createSchedule(app: Hono, t: string): Promise<number> {
  const res = await app.request(`${C}/schedules/`, {
    method: "POST",
    headers: authHeaders(t),
    body: JSON.stringify({
      Job: { ID: 12345 },
      Technician: { ID: 1 },
      Date: "2026-06-01",
      StartTime: "09:00",
      DurationMinutes: 60,
    }),
  });
  const body = (await res.json()) as { ID: number };
  return body.ID;
}

async function createTimesheet(app: Hono, t: string): Promise<number> {
  const res = await app.request(`${C}/timesheets/`, {
    method: "POST",
    headers: authHeaders(t),
    body: JSON.stringify({
      Employee: { ID: 1 },
      Job: { ID: 12345 },
      CostCenter: { ID: 5001 },
      Date: "2026-06-02",
      StartTime: "08:00",
      EndTime: "10:00",
      DurationMinutes: 120,
      Notes: "initial",
    }),
  });
  const body = (await res.json()) as { ID: number };
  return body.ID;
}

async function createCatalog(app: Hono, t: string): Promise<number> {
  const res = await app.request(`${C}/catalogs/`, {
    method: "POST",
    headers: authHeaders(t),
    body: JSON.stringify({ Name: "Copper Pipe 15mm", PartNo: "CP-15" }),
  });
  const body = (await res.json()) as { ID: number };
  return body.ID;
}

describe("Simpro direct — Feature 1: PATCH /schedules/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("updates the schedule duration (204) and a GET reflects it", async () => {
    const t = await token(app);
    const id = await createSchedule(app, t);
    const patch = await app.request(`${C}/schedules/${id}`, {
      method: "PATCH",
      headers: authHeaders(t),
      body: JSON.stringify({ DurationMinutes: 120 }),
    });
    expect(patch.status).toBe(204);
    const get = await app.request(`${C}/schedules/${id}`, { headers: authHeaders(t) });
    const body = (await get.json()) as { TotalHours: number };
    expect(body.TotalHours).toBe(2);
  });
});

describe("Simpro direct — Feature 2: POST /timesheets/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("creates a timesheet and returns 201 with an ID", async () => {
    const t = await token(app);
    const res = await app.request(`${C}/timesheets/`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify({
        Employee: { ID: 1 },
        Job: { ID: 12345 },
        Date: "2026-06-02",
        StartTime: "08:00",
        DurationMinutes: 90,
        Notes: "site visit",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ID: number; Notes: string };
    expect(typeof body.ID).toBe("number");
    expect(body.Notes).toBe("site visit");
    const get = await app.request(`${C}/timesheets/${body.ID}`, { headers: authHeaders(t) });
    expect(get.status).toBe(200);
  });
});

describe("Simpro direct — Feature 3: PATCH /timesheets/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("updates the timesheet notes (204) and a GET reflects it", async () => {
    const t = await token(app);
    const id = await createTimesheet(app, t);
    const patch = await app.request(`${C}/timesheets/${id}`, {
      method: "PATCH",
      headers: authHeaders(t),
      body: JSON.stringify({ Notes: "amended" }),
    });
    expect(patch.status).toBe(204);
    const get = await app.request(`${C}/timesheets/${id}`, { headers: authHeaders(t) });
    const body = (await get.json()) as { Notes: string };
    expect(body.Notes).toBe("amended");
  });
});

describe("Simpro direct — Feature 4: DELETE /timesheets/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes the timesheet (204) and a later GET 404s", async () => {
    const t = await token(app);
    const id = await createTimesheet(app, t);
    const del = await app.request(`${C}/timesheets/${id}`, { method: "DELETE", headers: authHeaders(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${C}/timesheets/${id}`, { headers: authHeaders(t) });
    expect(get.status).toBe(404);
  });
});

describe("Simpro direct — Feature 5: PATCH /setup/webhooks/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("toggles a webhook subscription Active flag (204) and a GET reflects it", async () => {
    const t = await token(app);
    const created = await app.request(`${C}/setup/webhooks/`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify({ URL: "https://agent-emulate.dev/hook", Events: ["job.created"] }),
    });
    const { ID } = (await created.json()) as { ID: number };
    const patch = await app.request(`${C}/setup/webhooks/${ID}`, {
      method: "PATCH",
      headers: authHeaders(t),
      body: JSON.stringify({ Active: false }),
    });
    expect(patch.status).toBe(204);
    const get = await app.request(`${C}/setup/webhooks/${ID}`, { headers: authHeaders(t) });
    const body = (await get.json()) as { Active: boolean };
    expect(body.Active).toBe(false);
  });
});

describe("Simpro direct — Feature 6: POST /sites/:siteId/contacts/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("creates a site-scoped contact (201) that appears in the site contact list", async () => {
    const t = await token(app);
    const res = await app.request(`${C}/sites/55/contacts/`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify({ GivenName: "Sandy", FamilyName: "Site" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ID: number; Site: { ID: number } | null };
    expect(body.Site?.ID).toBe(55);
    const list = await app.request(`${C}/sites/55/contacts/`, { headers: authHeaders(t) });
    const rows = (await list.json()) as Array<{ ID: number }>;
    expect(rows.some((r) => r.ID === body.ID)).toBe(true);
  });
});

describe("Simpro direct — Feature 7: POST /catalogs/", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("creates a catalog item (201) that appears in the catalog list", async () => {
    const t = await token(app);
    const id = await createCatalog(app, t);
    expect(typeof id).toBe("number");
    const list = await app.request(`${C}/catalogs/`, { headers: authHeaders(t) });
    const rows = (await list.json()) as Array<{ ID: number; Name: string }>;
    expect(rows.some((r) => r.ID === id && r.Name === "Copper Pipe 15mm")).toBe(true);
  });
});

describe("Simpro direct — Feature 8: PATCH /catalogs/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("updates a catalog item (204) and a GET reflects it", async () => {
    const t = await token(app);
    const id = await createCatalog(app, t);
    const patch = await app.request(`${C}/catalogs/${id}`, {
      method: "PATCH",
      headers: authHeaders(t),
      body: JSON.stringify({ Name: "Copper Pipe 15mm v2" }),
    });
    expect(patch.status).toBe(204);
    const get = await app.request(`${C}/catalogs/${id}`, { headers: authHeaders(t) });
    const body = (await get.json()) as { Name: string };
    expect(body.Name).toBe("Copper Pipe 15mm v2");
  });
});

describe("Simpro direct — Feature 9: DELETE /catalogs/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("removes a catalog item (204) and a later GET 404s", async () => {
    const t = await token(app);
    const id = await createCatalog(app, t);
    const del = await app.request(`${C}/catalogs/${id}`, { method: "DELETE", headers: authHeaders(t) });
    expect(del.status).toBe(204);
    const get = await app.request(`${C}/catalogs/${id}`, { headers: authHeaders(t) });
    expect(get.status).toBe(404);
  });
});

describe("Simpro direct — Feature 10: GET /sites/:siteId/contacts/:id", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as unknown as Hono;
  });

  it("returns a single site-scoped contact", async () => {
    const t = await token(app);
    const created = await app.request(`${C}/sites/55/contacts/`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify({ GivenName: "Pat", FamilyName: "Onsite" }),
    });
    const { ID } = (await created.json()) as { ID: number };
    const res = await app.request(`${C}/sites/55/contacts/${ID}`, { headers: authHeaders(t) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ID: number; GivenName: string };
    expect(body.ID).toBe(ID);
    expect(body.GivenName).toBe("Pat");
  });
});
