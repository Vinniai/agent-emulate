import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

// Simpro splits customers into /customers/ (all), /customers/companies/ and
// /customers/individuals/. The default seed has one Company customer (ID 200).
describe("Simpro customers", () => {
  it("lists all customers with the Customer envelope shape", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/customers/`, { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Result-Total")).toBe("1");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      ID: 200,
      Type: "Company",
      CompanyName: "Acme Facilities Pty Ltd",
      Email: "ops@agent-emulate.dev",
      Archived: false,
    });
    expect(body[0].Phone).toBeNull();
    expect(body[0].AltPhone).toBeNull();
    expect(body[0].CustomerType).toBe("Customer");
  });

  it("/companies/ returns companies, /individuals/ excludes them", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const companies = await app.request(`${BASE}/api/v1.0/companies/0/customers/companies/`, { headers: auth(token) });
    expect((await companies.json()) as unknown[]).toHaveLength(1);

    const individuals = await app.request(`${BASE}/api/v1.0/companies/0/customers/individuals/`, {
      headers: auth(token),
    });
    expect((await individuals.json()) as unknown[]).toHaveLength(0);
  });

  it("filters by Search and Archived", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const hit = await app.request(`${BASE}/api/v1.0/companies/0/customers/?Search=acme`, { headers: auth(token) });
    expect((await hit.json()) as unknown[]).toHaveLength(1);

    const miss = await app.request(`${BASE}/api/v1.0/companies/0/customers/?Search=nope`, { headers: auth(token) });
    expect((await miss.json()) as unknown[]).toHaveLength(0);

    const archived = await app.request(`${BASE}/api/v1.0/companies/0/customers/?Archived=true`, {
      headers: auth(token),
    });
    expect((await archived.json()) as unknown[]).toHaveLength(0);
  });

  it("get by id, unknown id returns Simpro 404 envelope", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const found = await app.request(`${BASE}/api/v1.0/companies/0/customers/200`, { headers: auth(token) });
    expect(found.status).toBe(200);
    expect(((await found.json()) as { ID: number }).ID).toBe(200);

    const missing = await app.request(`${BASE}/api/v1.0/companies/0/customers/999`, { headers: auth(token) });
    expect(missing.status).toBe(404);
    const err = (await missing.json()) as { errors: Array<{ path: string | null; message: string }> };
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0].message).toBeTruthy();
  });

  it("POST company requires CompanyName (422 validation envelope)", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/customers/companies/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Email: "x@agent-emulate.dev" }),
    });
    expect(res.status).toBe(422);
    const err = (await res.json()) as { errors: Array<{ path: string | null; message: string }> };
    expect(err.errors[0].path).toBe("CompanyName");
  });

  it("POST company creates (201) then PATCH returns 204 and persists", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const created = await app.request(`${BASE}/api/v1.0/companies/0/customers/companies/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ CompanyName: "Globex Pty Ltd", Email: "hi@agent-emulate.dev" }),
    });
    expect(created.status).toBe(201);
    const cust = (await created.json()) as { ID: number; Type: string };
    expect(cust.Type).toBe("Company");
    expect(cust.ID).toBeGreaterThan(0);

    const patched = await app.request(`${BASE}/api/v1.0/companies/0/customers/${cust.ID}`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ Email: "ops@agent-emulate.dev" }),
    });
    expect(patched.status).toBe(204);

    const after = await app.request(`${BASE}/api/v1.0/companies/0/customers/${cust.ID}`, { headers: auth(token) });
    expect(((await after.json()) as { Email: string }).Email).toBe("ops@agent-emulate.dev");
  });

  it("DELETE returns 204 and the customer is gone", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const del = await app.request(`${BASE}/api/v1.0/companies/0/customers/200`, {
      method: "DELETE",
      headers: auth(token),
    });
    expect(del.status).toBe(204);
    const after = await app.request(`${BASE}/api/v1.0/companies/0/customers/200`, { headers: auth(token) });
    expect(after.status).toBe(404);
  });
});
