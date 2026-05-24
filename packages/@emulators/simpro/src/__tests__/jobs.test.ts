import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro jobs", () => {
  it("returns seeded job list with columns projection", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/?columns=ID,Name,Stage`, { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Result-Total")).toBe("1");
    expect(res.headers.get("Result-Pages")).toBe("1");
    expect(res.headers.get("Result-Count")).toBe("1");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(Object.keys(body[0]).sort()).toEqual(["ID", "Name", "Stage"]);
    expect(body[0].ID).toBe(12345);
    expect(body[0].Stage).toBe("Progress");
  });

  it("filters by Customer.ID and Stage", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const match = await app.request(`${BASE}/api/v1.0/companies/0/jobs/?Customer.ID=200&Stage=3`, {
      headers: auth(token),
    });
    expect((await match.json()) as unknown[]).toHaveLength(1);

    const miss = await app.request(`${BASE}/api/v1.0/companies/0/jobs/?Customer.ID=999`, { headers: auth(token) });
    expect((await miss.json()) as unknown[]).toHaveLength(0);
  });

  it("detail endpoint with display=all expands sections + cost centers", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345?display=all`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const job = (await res.json()) as {
      ID: number;
      Sections: Array<{ ID: number; Name: string; CostCenters: Array<{ ID: number; BillingType: string }> }>;
    };
    expect(job.ID).toBe(12345);
    expect(job.Sections).toHaveLength(2);
    expect(job.Sections[0].CostCenters).toHaveLength(2);
    const billingTypes = job.Sections.flatMap((s) => s.CostCenters.map((cc) => cc.BillingType));
    expect(billingTypes.sort()).toEqual(["Fixed", "FlatRate", "TimeAndMaterials", "TimeAndMaterials"]);
  });

  it("404 uses Simpro error envelope", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/99999`, { headers: auth(token) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { errors: Array<{ path: string | null; message: string; value: unknown }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBeTruthy();
  });

  it("POST creates a job", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        Customer: { ID: 200 },
        Site: { ID: 55 },
        Name: "New service call",
        Type: "Service",
      }),
    });
    expect(res.status).toBe(201);
    const job = (await res.json()) as { ID: number; Name: string; Stage: string };
    expect(job.ID).toBeGreaterThan(10000);
    expect(job.Name).toBe("New service call");
    expect(job.Stage).toBe("Pending");
  });

  it("PATCH updates job fields", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ Stage: 4, Description: "Completed" }),
    });
    // SimPro's API returns 204 No Content on PATCH/update.
    expect(res.status).toBe(204);

    const after = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345`, { headers: auth(token) });
    expect(after.status).toBe(200);
    const job = (await after.json()) as { Stage: string; Description: string };
    expect(job.Stage).toBe("Complete");
    expect(job.Description).toBe("Completed");
  });
});
