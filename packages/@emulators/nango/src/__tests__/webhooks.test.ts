import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { Store } from "@emulators/core";
import { BASE, createTestApp, json } from "./helpers.js";
import type { NangoSeedConfig } from "../index.js";
import { storeToSeedConfig } from "../index.js";
import {
  buildAuthWebhook,
  buildSyncWebhook,
  buildForwardWebhook,
  signBody,
  setWebhookSettings,
  dispatchNangoWebhook,
  getDeliveries,
} from "../webhooks.js";

// ---------------------------------------------------------------------------
// Faithful Nango webhook contract.
//
// Real Nango emits two webhook types relevant to syncs/comms integrations:
//   - "sync"    : fired after a sync run; carries responseResults counts.
//   - "auth"    : fired after a connection lifecycle event.
//                 (calendars, teams, messages — anything Nango syncs)
//   - "forward" : a provider's own webhook (WhatsApp inbound message, Graph
//                 change notification, …) wrapped + relayed to the consumer.
// Both are signed with X-Nango-Signature = HMAC-SHA256(body, secret) hex.
// ---------------------------------------------------------------------------

interface Captured {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Spin a throwaway HTTP receiver; resolves once it captures one request. */
function receiver(): { url: string; next: () => Promise<Captured>; close: () => void } {
  let resolve!: (c: Captured) => void;
  const queue: Captured[] = [];
  const waiters: ((c: Captured) => void)[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const cap: Captured = {
        method: req.method ?? "",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
        ),
        body,
      };
      const w = waiters.shift();
      if (w) w(cap);
      else queue.push(cap);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  srv.listen(0);
  const port = (srv.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    next: () =>
      new Promise<Captured>((r) => {
        resolve = r;
        const q = queue.shift();
        if (q) resolve(q);
        else waiters.push(resolve);
      }),
    close: () => srv.close(),
  };
}

const SEED: NangoSeedConfig = {
  webhook_secret: "whsec_test",
  connections: [
    {
      id: "cal-acme",
      provider: "google-calendar",
      provider_config_key: "google-calendar",
      records: {
        events: [
          { id: "ev-1", summary: "AS1851 Inspection" },
          { id: "ev-2", summary: "Pump test" },
        ],
      },
    },
    {
      id: "teams-acme",
      provider: "microsoft-teams",
      provider_config_key: "microsoft-teams",
      records: { messages: [{ id: "tm-1", body: "standup" }] },
    },
    { id: "wa-acme", provider: "whatsapp", provider_config_key: "whatsapp" },
  ],
};

let open: { close: () => void } | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

describe("Nango webhooks — pure builders (unit)", () => {
  it("signBody is a stable hex HMAC-SHA256 of the body", () => {
    const sig = signBody("whsec_test", '{"a":1}');
    expect(sig).toBe(createHmac("sha256", "whsec_test").update('{"a":1}').digest("hex"));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("buildSyncWebhook matches the real Nango sync envelope", () => {
    const wh = buildSyncWebhook({
      connectionId: "cal-acme",
      providerConfigKey: "google-calendar",
      syncName: "calendar-events",
      model: "events",
      added: 2,
    }) as Record<string, unknown>;
    expect(wh).toMatchObject({
      type: "sync",
      connectionId: "cal-acme",
      providerConfigKey: "google-calendar",
      syncName: "calendar-events",
      model: "events",
      responseResults: { added: 2, updated: 0, deleted: 0 },
      syncType: "INCREMENTAL",
      success: true,
    });
    expect(typeof wh.modifiedAfter).toBe("string");
    expect(typeof wh.queryTimeStamp).toBe("string");
  });

  it("buildForwardWebhook wraps the provider's raw payload", () => {
    const raw = { object: "whatsapp_business_account", entry: [{ id: "WABA" }] };
    const wh = buildForwardWebhook({
      provider: "whatsapp",
      connectionId: "wa-acme",
      providerConfigKey: "whatsapp",
      payload: raw,
    });
    expect(wh).toEqual({
      from: "whatsapp",
      type: "forward",
      connectionId: "wa-acme",
      providerConfigKey: "whatsapp",
      payload: raw,
    });
  });

  it("buildAuthWebhook matches the connection lifecycle envelope", () => {
    const wh = buildAuthWebhook({
      operation: "creation",
      connectionId: "conn-1",
      authMode: "OAuth2",
      providerConfigKey: "hubspot",
      provider: "hubspot",
      success: true,
      endUser: { endUserId: "user-1", tags: { organizationId: "org-1" } },
    });
    expect(wh).toEqual({
      type: "auth",
      operation: "creation",
      connectionId: "conn-1",
      authMode: "OAuth2",
      providerConfigKey: "hubspot",
      provider: "hubspot",
      environment: "DEV",
      success: true,
      endUser: { endUserId: "user-1", tags: { organizationId: "org-1" } },
    });
  });
});

describe("Nango webhooks — settings registration", () => {
  it("seed config registers the webhook url + secret", async () => {
    const { app } = createTestApp({ seed: SEED });
    const r = (await (await app.request(`${BASE}/webhook-settings`)).json()) as {
      url: string | null;
      hasSecret: boolean;
    };
    expect(r.url).toBeNull(); // seed sets no url, only secret
    expect(r.hasSecret).toBe(true);
  });

  it("runtime POST /webhook-settings sets and GET reflects it", async () => {
    const { app } = createTestApp({ seed: SEED });
    const set = await app.request(`${BASE}/webhook-settings`, json({ url: "https://app.test/hook", secret: "s2" }));
    expect(set.status).toBe(200);
    expect((await set.json()) as object).toMatchObject({ url: "https://app.test/hook", hasSecret: true });
    const got = (await (await app.request(`${BASE}/webhook-settings`)).json()) as { url: string };
    expect(got.url).toBe("https://app.test/hook");
  });
});

describe("Nango webhooks — sync (POST /sync/trigger)", () => {
  it("delivers a signed Nango sync webhook with record counts", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "whsec_test" }));

    const res = await app.request(
      `${BASE}/sync/trigger`,
      json({ provider_config_key: "google-calendar", connection_id: "cal-acme", syncs: ["calendar-events"] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ success: true });

    const hit = await rcv.next();
    expect(hit.method).toBe("POST");
    const payload = JSON.parse(hit.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "sync",
      connectionId: "cal-acme",
      providerConfigKey: "google-calendar",
      syncName: "calendar-events",
      model: "events",
      responseResults: { added: 2, updated: 0, deleted: 0 },
    });
    // Signature contract: HMAC-SHA256 of the exact body with the secret.
    expect(hit.headers["x-nango-signature"]).toBe(signBody("whsec_test", hit.body));
    expect(hit.headers["x-nango-hmac-sha256"]).toBe(signBody("whsec_test", hit.body));
  });

  it("supports WEBHOOK syncType for realtime sync completion payloads", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "whsec_test" }));

    await app.request(
      `${BASE}/sync/trigger`,
      json({ provider_config_key: "google-calendar", connection_id: "cal-acme", model: "events", syncType: "WEBHOOK" }),
    );

    const hit = await rcv.next();
    const payload = JSON.parse(hit.body) as Record<string, unknown>;
    expect(payload).toMatchObject({ type: "sync", syncType: "WEBHOOK", model: "events" });
  });

  it("trigger with no webhook url configured still 200s and delivers nothing", async () => {
    const { app } = createTestApp({ seed: SEED });
    const res = await app.request(
      `${BASE}/sync/trigger`,
      json({ provider_config_key: "google-calendar", connection_id: "cal-acme" }),
    );
    expect(res.status).toBe(200);
    const deliveries = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as { deliveries: unknown[] };
    expect(deliveries.deliveries).toHaveLength(0);
  });
});

describe("Nango webhooks — forward (inbound provider webhook)", () => {
  it("wraps a WhatsApp inbound message and relays it to the consumer", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "whsec_test" }));

    const waBody = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [{ field: "messages", value: { messages: [{ from: "61400", text: { body: "hi" } }] } }],
        },
      ],
    };
    // The provider POSTs Nango's inbound URL: /webhook/{envUuid}/{providerConfigKey}
    const res = await app.request(`${BASE}/webhook/env-uuid-1/whatsapp`, json(waBody));
    expect(res.status).toBe(200); // Nango always 200s the provider

    const hit = await rcv.next();
    const payload = JSON.parse(hit.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      from: "whatsapp",
      type: "forward",
      connectionId: "wa-acme",
      providerConfigKey: "whatsapp",
      payload: waBody,
    });
    expect(hit.headers["x-nango-signature"]).toBe(signBody("whsec_test", hit.body));
    expect(hit.headers["x-nango-hmac-sha256"]).toBe(signBody("whsec_test", hit.body));
  });

  it("records every delivery for inspection", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url }));
    await app.request(`${BASE}/webhook/env-1/microsoft-teams`, json({ change: "created" }));
    await rcv.next();

    const list = (await (await app.request(`${BASE}/webhook-deliveries`)).json()) as {
      deliveries: { event: string; url: string; success: boolean }[];
    };
    expect(list.deliveries).toHaveLength(1);
    expect(list.deliveries[0]).toMatchObject({ event: "forward", url: rcv.url, success: true });
  });

  it("forwards raw provider payloads when no connection can be attributed", async () => {
    const rcv = receiver();
    open = rcv;
    const { app } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: rcv.url, secret: "whsec_test" }));

    const raw = { event: "unmapped" };
    await app.request(`${BASE}/webhook/env-1/unknown-provider`, json(raw));

    const hit = await rcv.next();
    expect(JSON.parse(hit.body)).toEqual(raw);
    expect(hit.headers["x-nango-hmac-sha256"]).toBe(signBody("whsec_test", hit.body));
  });
});

describe("Nango webhooks — bounded delivery retry", () => {
  it("a briefly-unavailable consumer still receives the event; delivery shows the attempts", async () => {
    const store = new Store();
    setWebhookSettings(store, { url: "https://app.test/hook", secret: "whsec_test" });

    const seq = [
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.resolve({ ok: false, status: 502 } as Response),
      () => Promise.resolve({ ok: true, status: 200 } as Response),
    ];
    let i = 0;

    await dispatchNangoWebhook(store, "sync", { type: "sync" }, { fetch: () => seq[i++]!(), sleep: async () => {} });

    const all = getDeliveries(store);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ event: "sync", success: true, status_code: 200, attempts: 3 });
    expect(i).toBe(3);
  });

  it("records the last failure + attempt count when the budget is exhausted", async () => {
    const store = new Store();
    setWebhookSettings(store, { url: "https://down.test/hook" });

    await dispatchNangoWebhook(
      store,
      "sync",
      { type: "sync" },
      { fetch: async () => ({ ok: false, status: 500 }) as Response, sleep: async () => {} },
    );

    const [d] = getDeliveries(store);
    expect(d).toMatchObject({ success: false, status_code: 500, attempts: 3 });
  });
});

describe("Nango webhooks — export round-trip", () => {
  it("storeToSeedConfig re-emits webhook_url / webhook_secret", async () => {
    const { app, store } = createTestApp({ seed: SEED });
    await app.request(`${BASE}/webhook-settings`, json({ url: "https://app.test/hook", secret: "rt-secret" }));
    const cfg = storeToSeedConfig(store, BASE) as NangoSeedConfig;
    expect(cfg.webhook_url).toBe("https://app.test/hook");
    expect(cfg.webhook_secret).toBe("rt-secret");
  });
});
