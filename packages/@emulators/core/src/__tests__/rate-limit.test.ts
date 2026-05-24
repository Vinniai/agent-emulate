import { describe, it, expect } from "vitest";
import { rateLimitProfile, rateLimitHeaders } from "../rate-limit.js";
import { createServer } from "../server.js";
import type { ServicePlugin } from "../plugin.js";

describe("rateLimitProfile", () => {
  it("defaults unknown providers to the GitHub shape (unchanged behaviour)", () => {
    const p = rateLimitProfile("totally-unknown");
    expect(p.limit).toBe(5000);
    expect(p.windowSec).toBe(3600);
    expect(p.exceededStatus).toBe(403);
    expect(p.rateLimitHeaders).toBe(true);
    expect(p.body(1, "https://docs")).toEqual({
      message: "API rate limit exceeded",
      documentation_url: "https://docs",
    });
  });

  it("uses 429 + Stripe error envelope for stripe", () => {
    const p = rateLimitProfile("stripe");
    expect(p.exceededStatus).toBe(429);
    expect(p.rateLimitHeaders).toBe(false);
    expect((p.body(2, "x") as { error: { type: string } }).error.type).toBe("rate_limit_error");
  });

  it("uses 429 + { ok:false, error:'ratelimited' } for slack", () => {
    const p = rateLimitProfile("slack");
    expect(p.exceededStatus).toBe(429);
    expect(p.body(2, "x")).toEqual({ ok: false, error: "ratelimited" });
  });

  it("is case-insensitive on the provider name", () => {
    expect(rateLimitProfile("Stripe").exceededStatus).toBe(429);
  });
});

describe("rateLimitHeaders", () => {
  it("emits X-RateLimit-* for GitHub only while quota remains, no Retry-After", () => {
    const p = rateLimitProfile("github");
    const h = rateLimitHeaders(p, { remaining: 10, resetAt: 100 }, 40);
    expect(h["X-RateLimit-Limit"]).toBe("5000");
    expect(h["X-RateLimit-Remaining"]).toBe("10");
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After (seconds until reset, floored at 0) once exhausted", () => {
    const p = rateLimitProfile("github");
    expect(rateLimitHeaders(p, { remaining: 0, resetAt: 100 }, 70)["Retry-After"]).toBe("30");
    expect(rateLimitHeaders(p, { remaining: 0, resetAt: 100 }, 130)["Retry-After"]).toBe("0");
  });

  it("omits X-RateLimit-* for non-GitHub profiles but still sets Retry-After", () => {
    const p = rateLimitProfile("stripe");
    const h = rateLimitHeaders(p, { remaining: 0, resetAt: 50 }, 45);
    expect(h["X-RateLimit-Limit"]).toBeUndefined();
    expect(h["Retry-After"]).toBe("5");
  });
});

const fakePlugin = (name: string): ServicePlugin => ({
  name,
  register(app) {
    app.get("/ping", (c) => c.json({ ok: true }));
  },
});

describe("createServer rate-limit integration", () => {
  it("blocks GitHub-shaped after the (overridable) limit with 403 + Retry-After", async () => {
    const { app } = createServer(fakePlugin("github"), { rateLimit: { limit: 2, windowSec: 60 } });
    expect((await app.request("http://x/ping")).status).toBe(200);
    const second = await app.request("http://x/ping");
    expect(second.status).toBe(403);
    expect(second.headers.get("Retry-After")).not.toBeNull();
    expect(((await second.json()) as { message: string }).message).toBe("API rate limit exceeded");
  });

  it("blocks Stripe-shaped with 429 + rate_limit_error and no X-RateLimit-*", async () => {
    const { app } = createServer(fakePlugin("stripe"), { rateLimit: { limit: 1, windowSec: 30 } });
    const r = await app.request("http://x/ping");
    expect(r.status).toBe(429);
    expect(r.headers.get("X-RateLimit-Limit")).toBeNull();
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(0);
    expect(((await r.json()) as { error: { type: string } }).error.type).toBe("rate_limit_error");
  });
});
