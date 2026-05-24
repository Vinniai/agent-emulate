import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";
import { seedFromConfig } from "../index.js";

function seedInvoice(store: Parameters<typeof seedFromConfig>[0]) {
  seedFromConfig(store, BASE, {
    invoices: [
      { id: 8001, job_id: 12345, type: "TaxInvoice", stage: 2, total_ex_tax: 1000, total_inc_tax: 1100, paid: 0 },
    ],
  });
}

describe("Simpro invoices", () => {
  it("detail computes Tax / BalanceDue / IsPaid and Stage label", async () => {
    const { app, store } = createTestApp();
    seedInvoice(store);
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/invoices/8001`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const inv = (await res.json()) as {
      ID: number;
      Type: string;
      Stage: string;
      IsPaid: boolean;
      Currency: string;
      Total: { ExTax: number; IncTax: number; Tax: number; BalanceDue: number; AmountApplied: number };
      Jobs: Array<{ ID: number }>;
    };
    expect(inv).toMatchObject({ ID: 8001, Type: "TaxInvoice", Stage: "Pending", IsPaid: false, Currency: "AUD" });
    expect(inv.Total).toMatchObject({ ExTax: 1000, IncTax: 1100, Tax: 100, BalanceDue: 1100, AmountApplied: 0 });
    expect(inv.Jobs[0].ID).toBe(12345);
  });

  it("lists with Job.ID / Stage filters and per-job sub-listing", async () => {
    const { app, store } = createTestApp();
    seedInvoice(store);
    const token = await getAccessToken(app);

    const all = await app.request(`${BASE}/api/v1.0/companies/0/invoices/`, { headers: auth(token) });
    expect(all.headers.get("Result-Total")).toBe("1");
    expect((await all.json()) as unknown[]).toHaveLength(1);

    const byJob = await app.request(`${BASE}/api/v1.0/companies/0/invoices/?Job.ID=12345`, { headers: auth(token) });
    expect((await byJob.json()) as unknown[]).toHaveLength(1);

    const byStage = await app.request(`${BASE}/api/v1.0/companies/0/invoices/?Stage=2`, { headers: auth(token) });
    expect((await byStage.json()) as unknown[]).toHaveLength(1);

    const perJob = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/invoices/`, { headers: auth(token) });
    expect(perJob.status).toBe(200);
    expect((await perJob.json()) as unknown[]).toHaveLength(1);
  });

  it("PATCH paid in full → 204, then IsPaid true and BalanceDue 0; Stage 5 → Approved", async () => {
    const { app, store } = createTestApp();
    seedInvoice(store);
    const token = await getAccessToken(app);

    const patched = await app.request(`${BASE}/api/v1.0/companies/0/invoices/8001`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ Paid: 1100, Stage: 5 }),
    });
    expect(patched.status).toBe(204);

    const after = await app.request(`${BASE}/api/v1.0/companies/0/invoices/8001`, { headers: auth(token) });
    const inv = (await after.json()) as { IsPaid: boolean; Stage: string; Total: { BalanceDue: number } };
    expect(inv.IsPaid).toBe(true);
    expect(inv.Total.BalanceDue).toBe(0);
    expect(inv.Stage).toBe("Approved");
  });

  it("POST requires a valid Job (422 on missing / unknown)", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const missing = await app.request(`${BASE}/api/v1.0/companies/0/invoices/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Type: "TaxInvoice" }),
    });
    expect(missing.status).toBe(422);
    expect(((await missing.json()) as { errors: Array<{ path: string }> }).errors[0].path).toBe("Job.ID");

    const badJob = await app.request(`${BASE}/api/v1.0/companies/0/invoices/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Job: { ID: 999999 } }),
    });
    expect(badJob.status).toBe(422);
    const err = (await badJob.json()) as { errors: Array<{ path: string; message: string; value: unknown }> };
    expect(err.errors[0]).toMatchObject({ path: "Job.ID", value: 999999 });

    const ok = await app.request(`${BASE}/api/v1.0/companies/0/invoices/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Job: { ID: 12345 }, TotalExTax: 200, TotalIncTax: 220 }),
    });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { Total: { ExTax: number } }).Total.ExTax).toBe(200);
  });
});
