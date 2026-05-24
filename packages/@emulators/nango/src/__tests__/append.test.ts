import { describe, it, expect } from "vitest";
import { BASE, createTestApp, json, nangoStore } from "./helpers.js";
import type { NangoSeedConfig } from "../index.js";

// ---------------------------------------------------------------------------
// Append contract.
//
// `setRecords` REPLACES a model's array — fine for seeding, useless for a live
// activity stream that drips one new record at a time (an email landing, a
// Teams message arriving). The simulator needs to *append* a single row onto
// an already-seeded model and have a "sync" webhook fire reporting added:1.
//
// Surface:
//   ns.appendRecords(connId, model, rows)            — store-level append
//   POST /connections/:id/records/:model { records } — 404 if conn missing
//   POST /sync/trigger { added, model }              — per-tick count override
// ---------------------------------------------------------------------------

const SEED: NangoSeedConfig = {
  connections: [
    {
      id: "gm-acme",
      provider: "google-mail",
      provider_config_key: "google-mail",
      records: { messages: [{ id: "m1", snippet: "first" }] },
    },
  ],
};

describe("Nango append — store facade", () => {
  it("appendRecords adds onto the live model array without replacing it", () => {
    const { store } = createTestApp({ seed: SEED });
    const ns = nangoStore(store);

    ns.appendRecords("gm-acme", "messages", [{ id: "m2", snippet: "second" }]);

    const rows = ns.getRecords("gm-acme", "messages");
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("appendRecords creates the model when it does not yet exist", () => {
    const { store } = createTestApp({ seed: SEED });
    const ns = nangoStore(store);

    ns.appendRecords("gm-acme", "drafts", [{ id: "d1" }]);

    expect(ns.getRecords("gm-acme", "drafts").map((r) => r.id)).toEqual(["d1"]);
    // Untouched sibling model still intact.
    expect(ns.getRecords("gm-acme", "messages").map((r) => r.id)).toEqual(["m1"]);
  });
});

describe("Nango append — POST /connections/:id/records/:model", () => {
  it("appends body.records and reports appended + total", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(
      `${BASE}/connections/gm-acme/records/messages`,
      json({ records: [{ id: "m2", snippet: "second" }] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ model: "messages", appended: 1, total: 2 });

    const list = (await (
      await app.request(`${BASE}/records?model=messages`, {
        headers: { "Connection-Id": "gm-acme", "Provider-Config-Key": "google-mail" },
      })
    ).json()) as { records: { id: string }[] };
    expect(list.records.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("accepts a single bare record (records as object, not array)", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(
      `${BASE}/connections/gm-acme/records/messages`,
      json({ records: { id: "m9", snippet: "solo" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ appended: 1, total: 2 });
  });

  it("404s when the connection does not exist", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(`${BASE}/connections/nope/records/messages`, json({ records: [{ id: "x" }] }));
    expect(res.status).toBe(404);
  });

  it("empty/missing records is a no-op that still 200s with appended:0", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(`${BASE}/connections/gm-acme/records/messages`, json({}));
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ appended: 0, total: 1 });
  });
});

describe("Nango append — /sync/trigger per-tick count override", () => {
  it("honours an explicit added count instead of the full model length", async () => {
    const { app, store } = createTestApp({ seed: SEED });
    nangoStore(store).appendRecords("gm-acme", "messages", [{ id: "m2" }, { id: "m3" }]);

    // Without an override the sync webhook would report added:3 (whole model).
    // A streamed tick that just appended one row wants added:1.
    await app.request(`${BASE}/webhook-settings`, json({ url: "https://app.test/hook", secret: "s" }));
    const res = await app.request(
      `${BASE}/sync/trigger`,
      json({ connection_id: "gm-acme", model: "messages", added: 1 }),
    );
    expect(res.status).toBe(200);

    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: { payload: { responseResults?: { added: number }; model?: string } }[];
    };
    expect(list.deliveries).toHaveLength(1);
    expect(list.deliveries[0].payload.model).toBe("messages");
    expect(list.deliveries[0].payload.responseResults?.added).toBe(1);
  });

  it("still defaults to the model length when no override is given", async () => {
    const { app, store } = createTestApp({ seed: SEED });
    nangoStore(store).appendRecords("gm-acme", "messages", [{ id: "m2" }]);
    await app.request(`${BASE}/webhook-settings`, json({ url: "https://app.test/hook", secret: "s" }));
    await app.request(`${BASE}/sync/trigger`, json({ connection_id: "gm-acme", model: "messages" }));

    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: { payload: { responseResults?: { added: number } } }[];
    };
    expect(list.deliveries[0].payload.responseResults?.added).toBe(2);
  });
});
