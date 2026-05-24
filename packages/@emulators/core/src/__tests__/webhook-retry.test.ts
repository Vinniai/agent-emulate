import { describe, it, expect, afterEach } from "vitest";
import { deliverWithRetry, webhookRetryConfig } from "../webhook-retry.js";

// Bounded retry with backoff: a transient blip on the consumer endpoint must
// not lose the event. Everything non-deterministic (fetch, sleep, the env
// policy) is injectable/per-call so these run instantly and deterministically.

const ENV_KEYS = ["EMULATE_WEBHOOK_RETRIES", "EMULATE_WEBHOOK_RETRY_BACKOFF_MS"] as const;
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const ok = (status = 200): Response => ({ ok: status >= 200 && status < 300, status }) as Response;

describe("webhookRetryConfig", () => {
  it("defaults to 3 attempts / 100ms backoff", () => {
    expect(webhookRetryConfig()).toEqual({ attempts: 3, backoffMs: 100 });
  });

  it("reads + floors the env policy (min 1 attempt, min 0 backoff)", () => {
    process.env.EMULATE_WEBHOOK_RETRIES = "5";
    process.env.EMULATE_WEBHOOK_RETRY_BACKOFF_MS = "0";
    expect(webhookRetryConfig()).toEqual({ attempts: 5, backoffMs: 0 });

    // 0 / unparseable is treated as "unset" → the default applies.
    process.env.EMULATE_WEBHOOK_RETRIES = "0";
    expect(webhookRetryConfig().attempts).toBe(3);

    // A negative explicit value is clamped up to the 1-attempt floor.
    process.env.EMULATE_WEBHOOK_RETRIES = "-3";
    expect(webhookRetryConfig().attempts).toBe(1);
  });
});

describe("deliverWithRetry", () => {
  it("delivers first try — one attempt, no sleep", async () => {
    let calls = 0;
    let slept = 0;
    const r = await deliverWithRetry(
      "https://c.example/hook",
      { method: "POST" },
      {
        fetch: async () => {
          calls++;
          return ok(200);
        },
        sleep: async () => {
          slept++;
        },
      },
    );
    expect(r).toEqual({ status_code: 200, success: true, attempts: 1 });
    expect(calls).toBe(1);
    expect(slept).toBe(0);
  });

  it("a briefly-unavailable endpoint still receives the event after retry", async () => {
    const seq = [
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.resolve(ok(503)),
      () => Promise.resolve(ok(200)),
    ];
    let i = 0;
    const sleeps: number[] = [];
    const r = await deliverWithRetry(
      "https://c.example/hook",
      { method: "POST" },
      { fetch: () => seq[i++]!(), sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toEqual({ status_code: 200, success: true, attempts: 3 });
    // exponential backoff between attempts: base*2^0, base*2^1
    expect(sleeps).toEqual([100, 200]);
  });

  it("exhausts the budget and reports the last failure (never throws)", async () => {
    let calls = 0;
    const r = await deliverWithRetry(
      "https://c.example/hook",
      { method: "POST" },
      {
        fetch: async () => {
          calls++;
          return ok(500);
        },
        sleep: async () => {},
      },
    );
    expect(r).toEqual({ status_code: 500, success: false, attempts: 3 });
    expect(calls).toBe(3);
  });

  it("a thrown network error on every attempt yields status_code null", async () => {
    const r = await deliverWithRetry(
      "https://c.example/hook",
      { method: "POST" },
      {
        fetch: async () => {
          throw new Error("network down");
        },
        sleep: async () => {},
      },
    );
    expect(r).toEqual({ status_code: null, success: false, attempts: 3 });
  });

  it("honours EMULATE_WEBHOOK_RETRIES=1 (no retry)", async () => {
    process.env.EMULATE_WEBHOOK_RETRIES = "1";
    let calls = 0;
    const r = await deliverWithRetry(
      "https://c.example/hook",
      { method: "POST" },
      {
        fetch: async () => {
          calls++;
          return ok(500);
        },
        sleep: async () => {},
      },
    );
    expect(calls).toBe(1);
    expect(r.attempts).toBe(1);
  });
});
