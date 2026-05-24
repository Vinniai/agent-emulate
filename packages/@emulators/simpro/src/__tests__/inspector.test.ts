import { describe, expect, it } from "vitest";
import { BASE, createTestApp } from "./helpers.js";

describe("Simpro inspector", () => {
  it("shows all seeded endpoint groups in the inspector sidebar", async () => {
    const { app } = createTestApp();

    const res = await app.request(`${BASE}/inspector`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/inspector/jobs");
    expect(html).toContain("/inspector/schedules");
    expect(html).toContain("/inspector/assets");
    expect(html).toContain("/inspector/vendor-orders");
    expect(html).toContain("/inspector/recurring-jobs");
    expect(html).toContain("/inspector/setup-status-codes");
    expect(html).toContain("Seeded SimPro Data");
  });

  it("serves individual tabs for sync-facing collections", async () => {
    const { app } = createTestApp();

    for (const tab of ["schedules", "assets", "vendor-orders", "recurring-jobs", "setup-status-codes"]) {
      const res = await app.request(`${BASE}/inspector/${tab}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Simpro Emulator");
    }
  });
});
