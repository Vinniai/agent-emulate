import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";
import { seedFromConfig } from "../index.js";

function seedQuote(store: Parameters<typeof seedFromConfig>[0]) {
  seedFromConfig(store, BASE, {
    quotes: [
      {
        id: 7001,
        name: "Roof Replacement Quote",
        customer_id: 200,
        site_id: 55,
        stage: "InProgress",
        total_ex_tax: 5000,
        total_tax: 500,
        total_inc_tax: 5500,
      },
    ],
  });
}

describe("Simpro quotes", () => {
  it("lists and filters by Customer.ID / Stage", async () => {
    const { app, store } = createTestApp();
    seedQuote(store);
    const token = await getAccessToken(app);

    const all = await app.request(`${BASE}/api/v1.0/companies/0/quotes/`, { headers: auth(token) });
    expect(all.status).toBe(200);
    expect(all.headers.get("Result-Total")).toBe("1");
    const list = (await all.json()) as Array<{ ID: number; Type: string; Stage: string }>;
    expect(list[0]).toMatchObject({ ID: 7001, Type: "Quote", Stage: "InProgress" });

    const byCustomer = await app.request(`${BASE}/api/v1.0/companies/0/quotes/?Customer.ID=200`, {
      headers: auth(token),
    });
    expect((await byCustomer.json()) as unknown[]).toHaveLength(1);

    const wrongCustomer = await app.request(`${BASE}/api/v1.0/companies/0/quotes/?Customer.ID=999`, {
      headers: auth(token),
    });
    expect((await wrongCustomer.json()) as unknown[]).toHaveLength(0);

    const byStage = await app.request(`${BASE}/api/v1.0/companies/0/quotes/?Stage=InProgress`, {
      headers: auth(token),
    });
    expect((await byStage.json()) as unknown[]).toHaveLength(1);
  });

  it("detail resolves Customer/Site refs and Total", async () => {
    const { app, store } = createTestApp();
    seedQuote(store);
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/quotes/7001`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const q = (await res.json()) as {
      ID: number;
      Customer: { ID: number; Type: string };
      Site: { ID: number; Name: string };
      Total: { ExTax: number; Tax: number; IncTax: number };
    };
    expect(q.Customer).toMatchObject({ ID: 200, Type: "Company" });
    expect(q.Site).toMatchObject({ ID: 55, Name: "North Campus Building A" });
    expect(q.Total).toEqual({ ExTax: 5000, Tax: 500, IncTax: 5500 });
  });

  it("POST requires Customer.ID (422)", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/quotes/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Name: "No customer" }),
    });
    expect(res.status).toBe(422);
    const err = (await res.json()) as { errors: Array<{ path: string | null }> };
    expect(err.errors[0].path).toBe("Customer.ID");
  });

  it("convert creates a Job, flips quote to Converted, second convert → 409", async () => {
    const { app, store } = createTestApp();
    seedQuote(store);
    const token = await getAccessToken(app);

    const conv = await app.request(`${BASE}/api/v1.0/companies/0/quotes/7001/convert/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({}),
    });
    expect(conv.status).toBe(201);
    const job = (await conv.json()) as { ID: number; Stage: string; Customer: { ID: number } };
    expect(job.ID).toBeGreaterThan(0);
    expect(job.Stage).toBe("Pending");
    expect(job.Customer.ID).toBe(200);

    const after = await app.request(`${BASE}/api/v1.0/companies/0/quotes/7001`, { headers: auth(token) });
    const q = (await after.json()) as { Stage: string; ConvertedJob: { ID: number } | null };
    expect(q.Stage).toBe("Converted");
    expect(q.ConvertedJob).toEqual({ ID: job.ID });

    const again = await app.request(`${BASE}/api/v1.0/companies/0/quotes/7001/convert/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
  });
});
