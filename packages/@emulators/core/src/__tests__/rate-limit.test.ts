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

  it("uses the Google usageLimits envelope for google", () => {
    const p = rateLimitProfile("google");
    expect(p.exceededStatus).toBe(429);
    const b = p.body(1, "x") as { error: { status: string; errors: { reason: string }[] } };
    expect(b.error.status).toBe("RESOURCE_EXHAUSTED");
    expect(b.error.errors[0].reason).toBe("rateLimitExceeded");
  });

  it("uses code:TooManyRequests for microsoft graph", () => {
    expect((rateLimitProfile("microsoft").body(1, "x") as { error: { code: string } }).error.code).toBe(
      "TooManyRequests",
    );
  });

  it("uses 403 + REQUEST_LIMIT_EXCEEDED array body for salesforce", () => {
    const p = rateLimitProfile("salesforce");
    expect(p.exceededStatus).toBe(403);
    expect((p.body(1, "x") as { errorCode: string }[])[0].errorCode).toBe("REQUEST_LIMIT_EXCEEDED");
  });

  it("uses RATE_LIMIT errorType for hubspot", () => {
    expect((rateLimitProfile("hubspot").body(1, "x") as { errorType: string }).errorType).toBe("RATE_LIMIT");
  });

  it("uses the error.list envelope for intercom", () => {
    const b = rateLimitProfile("intercom").body(1, "x") as { type: string; errors: { code: string }[] };
    expect(b.type).toBe("error.list");
    expect(b.errors[0].code).toBe("rate_limit_exceeded");
  });

  it("carries retry_after (seconds) in the discord body", () => {
    expect((rateLimitProfile("discord").body(7, "x") as { retry_after: number }).retry_after).toBe(7);
  });

  it("uses success:false envelope for pipedrive and rate_limit_exceeded for resend", () => {
    expect((rateLimitProfile("pipedrive").body(1, "x") as { success: boolean }).success).toBe(false);
    expect((rateLimitProfile("resend").body(1, "x") as { name: string }).name).toBe("rate_limit_exceeded");
  });
});

describe("provider-specific extraHeaders", () => {
  it("emits X-HubSpot-RateLimit-* for hubspot", () => {
    const p = rateLimitProfile("hubspot");
    const h = rateLimitHeaders(p, { remaining: 7, resetAt: 100 }, 40);
    expect(h["X-HubSpot-RateLimit-Remaining"]).toBe("7");
    expect(h["X-HubSpot-RateLimit-Max"]).toBe(String(p.limit));
  });

  it("emits X-RateLimit-* for discord/intercom and Retry-After once exhausted", () => {
    const d = rateLimitProfile("discord");
    const h = rateLimitHeaders(d, { remaining: 0, resetAt: 50 }, 45);
    expect(h["X-RateLimit-Remaining"]).toBe("0");
    expect(h["X-RateLimit-Reset-After"]).toBe("5");
    expect(h["Retry-After"]).toBe("5");
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

  it("blocks Discord-shaped with 429 + retry_after body and X-RateLimit-* headers", async () => {
    const { app } = createServer(fakePlugin("discord"), { rateLimit: { limit: 1, windowSec: 30 } });
    const r = await app.request("http://x/ping");
    expect(r.status).toBe(429);
    expect(r.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(0);
    const b = (await r.json()) as { message: string; retry_after: number; global: boolean };
    expect(b.message).toBe("You are being rate limited.");
    expect(b.global).toBe(false);
  });

  it("blocks Salesforce-shaped with 403 + REQUEST_LIMIT_EXCEEDED array body", async () => {
    const { app } = createServer(fakePlugin("salesforce"), { rateLimit: { limit: 1, windowSec: 30 } });
    const r = await app.request("http://x/ping");
    expect(r.status).toBe(403);
    expect(((await r.json()) as { errorCode: string }[])[0].errorCode).toBe("REQUEST_LIMIT_EXCEEDED");
  });
});
