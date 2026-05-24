import { describe, it, expect } from "vitest";
import { Simulator } from "../engine.js";
import { loadScenario } from "../scenario.js";

// The engine is the only stateful piece, so timers + fetch + clock are all
// injectable. We drive a deterministic virtual clock and capture every HTTP
// call instead of touching the network.

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeFetch() {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  };
  return { calls, fn };
}

/** Minimal controllable timer: advance() fires everything due, re-armed timers included. */
function fakeTimer() {
  let nowMs = 0;
  let seq = 0;
  const pending = new Map<number, { fn: () => void; due: number }>();
  return {
    api: {
      set: (fn: () => void, ms: number) => {
        const id = ++seq;
        pending.set(id, { fn, due: nowMs + ms });
        return id;
      },
      clear: (h: unknown) => pending.delete(h as number),
    },
    async advance(ms: number) {
      const target = nowMs + ms;
      // Fire in due order; callbacks may schedule further timers.
      for (;;) {
        let next: [number, { fn: () => void; due: number }] | undefined;
        for (const e of pending.entries()) {
          if (e[1].due <= target && (!next || e[1].due < next[1].due)) next = e;
        }
        if (!next) break;
        pending.delete(next[0]);
        nowMs = next[1].due;
        next[1].fn();
        // Drain to a real macrotask turn so the whole async tick chain
        // (two awaited POSTs, then the re-arm) settles before the next scan.
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      nowMs = target;
    },
  };
}

const SCENARIO = `
streams:
  - name: inbox
    kind: sync
    provider: gmail
    connectionId: gm-acme
    providerConfigKey: google-mail
    model: messages
    ratePerMinute: 60
    maxCount: 3
  - name: wa
    kind: forward
    provider: whatsapp
    connectionId: wa-acme
    providerConfigKey: whatsapp
    environmentUuid: env-1
    ratePerMinute: 30
    maxCount: 2
`;

describe("Simulator — sync stream", () => {
  it("each tick appends one record then triggers a sync with added:1", async () => {
    const { calls, fn } = fakeFetch();
    const sim = new Simulator(loadScenario(SCENARIO), {
      base: "http://emu/nango",
      fetch: fn as never,
      now: () => new Date("2026-05-16T00:00:00Z"),
    });
    await sim.runOnce();

    const sync = calls.filter((c) => c.url.includes("gm-acme") || c.url.includes("sync/trigger"));
    const append = sync[0];
    expect(append.method).toBe("POST");
    expect(append.url).toBe("http://emu/nango/connections/gm-acme/records/messages");
    expect((append.body as { records: unknown[] }).records).toHaveLength(1);

    const trigger = sync[1];
    expect(trigger.url).toBe("http://emu/nango/sync/trigger");
    expect(trigger.body).toMatchObject({
      connection_id: "gm-acme",
      provider_config_key: "google-mail",
      model: "messages",
      added: 1,
    });
  });
});

describe("Simulator — forward stream", () => {
  it("posts the wrapped provider webhook with a Connection-Id hint", async () => {
    const { calls, fn } = fakeFetch();
    const sim = new Simulator(loadScenario(SCENARIO), {
      base: "http://emu/nango",
      fetch: fn as never,
      now: () => new Date("2026-05-16T00:00:00Z"),
    });
    await sim.runOnce();

    const fwd = calls.find((c) => c.url.includes("/webhook/"))!;
    expect(fwd.url).toBe("http://emu/nango/webhook/env-1/whatsapp");
    expect(fwd.headers["Connection-Id"]).toBe("wa-acme");
    expect((fwd.body as { object: string }).object).toBe("whatsapp_business_account");
  });
});

const NATIVE_SCENARIO = `
streams:
  - name: gh-issues
    kind: native
    provider: github-issues
    pathPrefix: /github
    ratePerMinute: 60
    maxCount: 2
  - name: stripe-pi
    kind: native
    provider: stripe-payments
    ratePerMinute: 60
    maxCount: 1
`;

describe("Simulator — native stream", () => {
  it("writes the provider's own API directly so its webhook dispatch fires", async () => {
    const { calls, fn } = fakeFetch();
    const sim = new Simulator(loadScenario(NATIVE_SCENARIO), {
      base: "http://emu",
      fetch: fn as never,
      now: () => new Date("2026-05-16T00:00:00Z"),
      nativeToken: "tok-123",
    });
    await sim.runOnce();

    const gh = calls.find((c) => c.url.includes("/issues"))!;
    expect(gh.method).toBe("POST");
    expect(gh.url).toBe("http://emu/github/repos/acme/app/issues");
    expect(gh.headers.Authorization).toBe("Bearer tok-123");
    expect((gh.body as { title: string }).title).toContain("#0");

    // No pathPrefix → provider-relative path is used as-is.
    const stripe = calls.find((c) => c.url.includes("/payment_intents"))!;
    expect(stripe.url).toBe("http://emu/v1/payment_intents");
    expect((stripe.body as { currency: string }).currency).toBe("aud");
  });

  it("native streams need no connectionId / model in the scenario", () => {
    const scn = loadScenario(NATIVE_SCENARIO);
    expect(scn.streams[0]!.kind).toBe("native");
    expect(scn.streams[0]!.pathPrefix).toBe("/github");
    expect(scn.streams[0]!.connectionId).toBe("");
  });
});

describe("Simulator — continuous run", () => {
  it("respects per-stream maxCount and resolves when all streams are done", async () => {
    const { calls, fn } = fakeFetch();
    const timer = fakeTimer();
    const sim = new Simulator(loadScenario(SCENARIO), {
      base: "http://emu/nango",
      fetch: fn as never,
      now: () => new Date("2026-05-16T00:00:00Z"),
      timer: timer.api,
    });

    const done = sim.start();
    await timer.advance(10_000); // 10s ≫ enough for 3×1s + 2×2s ticks
    await done;

    const appends = calls.filter((c) => c.url.endsWith("/records/messages"));
    const triggers = calls.filter((c) => c.url.endsWith("/sync/trigger"));
    const forwards = calls.filter((c) => c.url.includes("/webhook/"));
    expect(appends).toHaveLength(3); // gmail maxCount
    expect(triggers).toHaveLength(3);
    expect(forwards).toHaveLength(2); // whatsapp maxCount
  });

  it("stop() halts further ticks and resolves start()", async () => {
    const { calls, fn } = fakeFetch();
    const timer = fakeTimer();
    const slow = loadScenario(`
streams:
  - name: inbox
    kind: sync
    provider: gmail
    connectionId: c
    providerConfigKey: k
    model: messages
    ratePerMinute: 60
`);
    const sim = new Simulator(slow, { base: "http://emu", fetch: fn as never, timer: timer.api });
    const done = sim.start();
    await timer.advance(1_000); // one tick
    sim.stop();
    await done;
    const before = calls.length;
    await timer.advance(5_000);
    expect(calls.length).toBe(before); // nothing more after stop
  });

  it("durationSec stops the run even with no maxCount", async () => {
    const { calls, fn } = fakeFetch();
    const timer = fakeTimer();
    const sc = loadScenario(`
durationSec: 3
streams:
  - name: inbox
    kind: sync
    provider: gmail
    connectionId: c
    providerConfigKey: k
    model: messages
    ratePerMinute: 60
`);
    const sim = new Simulator(sc, { base: "http://emu", fetch: fn as never, timer: timer.api });
    const done = sim.start();
    await timer.advance(60_000);
    await done;
    // ~3 ticks at 1/s within the 3s window (not unbounded).
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

describe("Simulator — dry run", () => {
  it("makes no HTTP calls", async () => {
    const { calls, fn } = fakeFetch();
    const sim = new Simulator(loadScenario(SCENARIO), {
      base: "http://emu/nango",
      fetch: fn as never,
      dryRun: true,
    });
    await sim.runOnce();
    expect(calls).toHaveLength(0);
  });
});
