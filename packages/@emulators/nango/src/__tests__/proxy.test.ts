import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";
import type { NangoSeedConfig } from "../index.js";

const PROXY_SEED: NangoSeedConfig = {
  connections: [
    {
      id: "qb-1",
      provider: "quickbooks",
      provider_config_key: "quickbooks",
      connection_config: { realmId: "9341453644728342" },
      records: {
        Invoice: [{ Id: "1", DocNumber: "1001", TotalAmt: 1100 }],
        Customer: [{ Id: "7", DisplayName: "Acme Co" }],
      },
    },
    {
      id: "xero-1",
      provider: "xero",
      provider_config_key: "xero",
      connection_config: { tenantId: "tenant-1" },
      records: { Invoice: [{ InvoiceID: "x1", InvoiceNumber: "INV-9", Total: 990 }] },
    },
    {
      id: "myob-1",
      provider: "myob",
      provider_config_key: "myob",
      records: { Invoice: [{ UID: "m1", Number: "00001", TotalAmount: 42 }] },
    },
  ],
};

// The Nango proxy forwards through to the upstream provider's native API
// shape — the emulator reproduces each provider's response envelope so
// integration code that parses real responses keeps working.
describe("Nango proxy — provider-native envelopes", () => {
  it("QuickBooks query returns a QueryResponse envelope", async () => {
    const { app } = createTestApp({ seed: PROXY_SEED });
    const query = encodeURIComponent("SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100");

    const res = await app.request(`${BASE}/proxy/v3/company/9341453644728342/query?query=${query}`, {
      headers: { "Connection-Id": "qb-1", "Provider-Config-Key": "quickbooks" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      QueryResponse: { Invoice: Array<{ DocNumber: string }>; totalCount: number; startPosition: number };
      time: string;
    };
    expect(body.QueryResponse.Invoice[0].DocNumber).toBe("1001");
    expect(body.QueryResponse).toMatchObject({ totalCount: 1, startPosition: 1, maxResults: 1 });
    expect(typeof body.time).toBe("string");
  });

  it("QuickBooks query with no parseable entity → 400", async () => {
    const { app } = createTestApp({ seed: PROXY_SEED });
    const res = await app.request(`${BASE}/proxy/v3/company/123/query?query=${encodeURIComponent("not a query")}`, {
      headers: { "Connection-Id": "qb-1" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "Could not parse entity from query" });
  });

  it("Xero proxy returns a Xero { Plural, Status, DateTimeUTC } envelope", async () => {
    const { app } = createTestApp({ seed: PROXY_SEED });
    const res = await app.request(`${BASE}/proxy/api.xro/2.0/Invoices`, {
      headers: { "Connection-Id": "xero-1", "Provider-Config-Key": "xero" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Invoices: Array<{ InvoiceNumber: string }>; Status: string };
    expect(body.Status).toBe("OK");
    expect(body.Invoices[0].InvoiceNumber).toBe("INV-9");
  });

  it("MYOB proxy returns an { Items, Count, TotalCount } envelope", async () => {
    const { app } = createTestApp({ seed: PROXY_SEED });
    const res = await app.request(`${BASE}/proxy/api.myob.com/accountright/abc-uuid/Sale/Invoice`, {
      headers: { "Connection-Id": "myob-1", "Provider-Config-Key": "myob" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Items: Array<{ Number: string }>; Count: number; TotalCount: number };
    expect(body).toMatchObject({ Count: 1, TotalCount: 1 });
    expect(body.Items[0].Number).toBe("00001");
  });

  it("unknown provider path falls back to a flattened record dump", async () => {
    const { app } = createTestApp({ seed: PROXY_SEED });
    const res = await app.request(`${BASE}/proxy/some/custom/endpoint`, {
      headers: { "Connection-Id": "qb-1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: unknown[]; path: string };
    expect(body.path).toBe("some/custom/endpoint");
    // qb-1 has both Invoice (1) and Customer (1) records → flattened to 2.
    expect(body.records).toHaveLength(2);
  });
});
