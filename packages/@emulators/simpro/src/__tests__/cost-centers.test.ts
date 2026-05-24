import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro sections + cost centers", () => {
  it("lists sections with display_order", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const sections = (await res.json()) as Array<{ ID: number; Name: string; DisplayOrder: number }>;
    expect(sections).toHaveLength(2);
    expect(sections[0].DisplayOrder).toBe(1);
    expect(sections[1].DisplayOrder).toBe(2);
  });

  it("lists section-nested cost centers with display=all expands Items", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/1001/costCenters/?display=all`, {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    const cc = (await res.json()) as Array<{
      ID: number;
      BillingType: string;
      Items: { CatalogItems: unknown[]; LabourItems: unknown[] };
    }>;
    expect(cc).toHaveLength(2);
    expect(cc[0].Items.CatalogItems).toEqual([]);
    expect(cc[0].Items.LabourItems).toEqual([]);
  });

  it("top-level /jobs/:jid/costCenters/ returns cross-section list", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/costCenters/`, { headers: auth(token) });
    const list = (await res.json()) as unknown[];
    expect(list).toHaveLength(4);
  });

  it("POST section then POST cost center", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const sectionRes = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Name: "Zone 3 – Level 2" }),
    });
    expect(sectionRes.status).toBe(201);
    const section = (await sectionRes.json()) as { ID: number; DisplayOrder: number };
    expect(section.DisplayOrder).toBe(3);

    const ccRes = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/${section.ID}/costCenters/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        Name: "New CC",
        BillingType: "Fixed",
        CostCenter: { ID: 12 },
        Stage: 2,
      }),
    });
    expect(ccRes.status).toBe(201);
    const cc = (await ccRes.json()) as { ID: number; BillingType: string };
    expect(cc.BillingType).toBe("Fixed");
  });

  it("master cost centers listed at /setup/costCenters/", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/setup/costCenters/`, { headers: auth(token) });
    const list = (await res.json()) as Array<{ ID: number; Name: string }>;
    expect(list.map((m) => m.ID).sort()).toEqual([12, 15]);
  });

  it("DELETE section cascades to its cost centers", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/1001`, {
      method: "DELETE",
      headers: auth(token),
    });

    const crossSection = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/costCenters/`, {
      headers: auth(token),
    });
    const remaining = (await crossSection.json()) as unknown[];
    expect(remaining).toHaveLength(2); // only Zone 2's two cost centers left
  });
});
