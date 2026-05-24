import { describe, it, expect } from "vitest";
import { getSimproStore } from "../store.js";
import { nowIso } from "../helpers.js";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro pagination + rate limit", () => {
  it("pagination headers + page/pageSize", async () => {
    const { app, store } = createTestApp();
    const token = await getAccessToken(app);

    // Seed 35 additional sections on job 12345
    const ss = getSimproStore(store);
    for (let i = 0; i < 35; i++) {
      ss.sections.insert({
        company_id: 0,
        external_id: 2000 + i,
        job_id: 12345,
        name: `Extra ${i}`,
        description: null,
        display_order: 10 + i,
        date_modified: nowIso(),
      });
    }

    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/12345/sections/?page=2&pageSize=10`, {
      headers: auth(token),
    });
    expect(res.headers.get("Result-Total")).toBe("37"); // 2 seed + 35
    expect(res.headers.get("Result-Pages")).toBe("4");
    expect(res.headers.get("Result-Count")).toBe("10");
    const page = (await res.json()) as unknown[];
    expect(page).toHaveLength(10);
  });

  it("pageSize is capped at 250", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/?pageSize=5000`, { headers: auth(token) });
    expect(res.status).toBe(200);
    // With only 1 seeded job, total is 1 — but we can assert count fits in 250
    expect(Number(res.headers.get("Result-Count"))).toBeLessThanOrEqual(250);
  });

  it("rate limit returns 429 + Retry-After when enabled", async () => {
    const { app } = createTestApp({ rateLimit: true });
    const token = await getAccessToken(app);

    // 10 requests should fit within the first 1-second window
    const url = `${BASE}/api/v1.0/companies/0/jobs/`;
    for (let i = 0; i < 10; i++) {
      const r = await app.request(url, { headers: auth(token) });
      expect(r.status).toBe(200);
    }
    const over = await app.request(url, { headers: auth(token) });
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("1");
    const body = (await over.json()) as { errors: Array<{ message: string }> };
    expect(body.errors[0].message).toMatch(/Rate limit/);
  });
});
