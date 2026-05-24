import { describe, it, expect } from "vitest";
import { BASE, ORG_SEED, createTestApp } from "./helpers.js";

type NangoRecord = Record<string, unknown> & {
  _nango_metadata: {
    first_seen_at: string;
    last_modified_at: string;
    last_action: string;
    cursor: string;
    deleted_at: null;
  };
};

// The /records sync API is how an org pulls normalised data out of every
// linked integration (one model name per object type).
describe("Nango /records sync API", () => {
  it("returns synced rows wrapped with _nango_metadata", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const res = await app.request(`${BASE}/records?model=Invoice`, {
      headers: { "Connection-Id": "xero-acme", "Provider-Config-Key": "xero" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: NangoRecord[]; next_cursor: null };
    expect(body.next_cursor).toBeNull();
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-001" });
    expect(body.records[0]._nango_metadata).toMatchObject({
      last_action: "ADDED",
      cursor: "emu_cursor_0",
      deleted_at: null,
    });
    expect(typeof body.records[0]._nango_metadata.first_seen_at).toBe("string");
  });

  it("supports Nango cursor pagination, ids, and filter queries", async () => {
    const { app } = createTestApp({
      seed: {
        connections: [
          {
            id: "gmail-acme",
            provider: "gmail",
            provider_config_key: "gmail",
            records: {
              Message: [
                { id: "m1", subject: "First" },
                { id: "m2", subject: "Second" },
                { id: "m3", subject: "Third" },
              ],
            },
          },
        ],
      },
    });

    const first = await app.request(`${BASE}/records?model=Message&limit=2`, {
      headers: { "Connection-Id": "gmail-acme", "Provider-Config-Key": "gmail" },
    });
    const firstBody = (await first.json()) as { records: NangoRecord[]; next_cursor: string };
    expect(firstBody.records.map((row) => row.id)).toEqual(["m1", "m2"]);
    expect(firstBody.next_cursor).toBe("emu_cursor_1");

    const second = await app.request(`${BASE}/records?model=Message&cursor=${firstBody.next_cursor}`, {
      headers: { "Connection-Id": "gmail-acme", "Provider-Config-Key": "gmail" },
    });
    const secondBody = (await second.json()) as { records: NangoRecord[]; next_cursor: null };
    expect(secondBody.records.map((row) => row.id)).toEqual(["m3"]);
    expect(secondBody.next_cursor).toBeNull();

    const ids = await app.request(`${BASE}/records?model=Message&ids=m2,m3&filter=added`, {
      headers: { "Connection-Id": "gmail-acme", "Provider-Config-Key": "gmail" },
    });
    const idsBody = (await ids.json()) as { records: NangoRecord[] };
    expect(idsBody.records.map((row) => row.id)).toEqual(["m2", "m3"]);
  });

  it("supports records pruning while preserving metadata", async () => {
    const { app } = createTestApp({
      seed: {
        connections: [
          {
            id: "gmail-acme",
            provider: "gmail",
            provider_config_key: "gmail",
            records: {
              Message: [
                { id: "m1", subject: "First" },
                { id: "m2", subject: "Second" },
              ],
            },
          },
        ],
      },
    });

    const pruned = await app.request(`${BASE}/records/prune`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Connection-Id": "gmail-acme", "Provider-Config-Key": "gmail" },
      body: JSON.stringify({ model: "Message", until_cursor: "emu_cursor_0" }),
    });
    expect(await pruned.json()).toEqual({ count: 1, has_more: false });

    const res = await app.request(`${BASE}/records?model=Message&limit=1`, {
      headers: { "Connection-Id": "gmail-acme", "Provider-Config-Key": "gmail" },
    });
    const body = (await res.json()) as { records: NangoRecord[] };
    expect(body.records[0].subject).toBeUndefined();
    expect(body.records[0]._nango_metadata.cursor).toBe("emu_cursor_0");
    expect(body.records[0]._nango_metadata).toHaveProperty("pruned_at");
  });

  it("trailing-slash /records/ behaves identically", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });
    const res = await app.request(`${BASE}/records/?model=Customer`, {
      headers: { "Connection-Id": "quickbooks-acme" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: NangoRecord[] };
    expect(body.records[0]).toMatchObject({ id: "qb-cust-1", DisplayName: "Acme Co" });
  });

  it("missing Connection-Id or model → 400", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const noModel = await app.request(`${BASE}/records`, { headers: { "Connection-Id": "xero-acme" } });
    expect(noModel.status).toBe(400);
    expect((await noModel.json()) as { message: string }).toMatchObject({
      message: "Missing Connection-Id header or model query param",
    });

    const noConn = await app.request(`${BASE}/records?model=Invoice`);
    expect(noConn.status).toBe(400);
  });

  it("unknown model yields an empty record set (not an error)", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });
    const res = await app.request(`${BASE}/records?model=PurchaseOrder`, {
      headers: { "Connection-Id": "xero-acme" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { records: unknown[] }).toEqual({ records: [], next_cursor: null });
  });

  it("falls back to a same-provider sibling connection's records", async () => {
    // A freshly created xero connection with no synced records of its own
    // still resolves Invoices from the seeded xero connection.
    const { app } = createTestApp({
      seed: {
        connections: [...ORG_SEED.connections!, { id: "xero-second", provider: "xero", provider_config_key: "xero" }],
      },
    });

    const res = await app.request(`${BASE}/records?model=Invoice`, {
      headers: { "Connection-Id": "xero-second", "Provider-Config-Key": "xero" },
    });
    const body = (await res.json()) as { records: NangoRecord[] };
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ InvoiceID: "xero-inv-1" });
  });
});
