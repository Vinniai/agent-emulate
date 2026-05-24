import { describe, expect, it } from "vitest";
import { BASE, ORG_SEED, createTestApp, json } from "./helpers.js";

describe("Nango sync management API", () => {
  it("supports start, pause, trigger, and status routes", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const start = await app.request(
      `${BASE}/sync/start`,
      json({ provider_config_key: "xero", connection_id: "xero-acme", syncs: ["invoices"] }),
    );
    expect(await start.json()).toEqual({ success: true });

    const pause = await app.request(
      `${BASE}/sync/pause`,
      json({ provider_config_key: "xero", connection_id: "xero-acme", syncs: ["invoices"] }),
    );
    expect(await pause.json()).toEqual({ success: true });

    const trigger = await app.request(
      `${BASE}/sync/trigger`,
      json({ provider_config_key: "xero", connection_id: "xero-acme", syncs: ["invoices"] }),
    );
    expect(await trigger.json()).toEqual({ success: true });

    const status = await app.request(
      `${BASE}/sync/status?provider_config_key=xero&connection_id=xero-acme&syncs=invoices`,
    );
    const body = (await status.json()) as {
      syncs: Array<{ connection_id: string; name: string; recordCount: Record<string, number> }>;
    };
    expect(body.syncs).toHaveLength(1);
    expect(body.syncs[0]).toMatchObject({
      connection_id: "xero-acme",
      name: "invoices",
      recordCount: { Invoice: 1, Contact: 1 },
    });
  });

  it("supports sync variant create and delete", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const created = await app.request(
      `${BASE}/sync/invoices/variant/high-value`,
      json({ provider_config_key: "xero", connection_id: "xero-acme" }),
    );
    expect(await created.json()).toEqual({
      id: "xero-acme:invoices:high-value",
      name: "invoices",
      variant: "high-value",
    });

    const deleted = await app.request(`${BASE}/sync/invoices/variant/high-value`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider_config_key: "xero", connection_id: "xero-acme" }),
    });
    expect(await deleted.json()).toEqual({ success: true });
  });
});
