import { describe, it, expect } from "vitest";
import { ROOT_FALLBACK_ROUTES, matchRootFallback, type RootFallbackRoute } from "../root-fallback.js";

describe("matchRootFallback — prefix-less SDK base-URL routing", () => {
  it("routes WorkOS root paths to workos", () => {
    expect(matchRootFallback("/user_management/users")).toBe("workos");
    expect(matchRootFallback("/sso/authorize")).toBe("workos");
    expect(matchRootFallback("/organizations")).toBe("workos");
    expect(matchRootFallback("/directory_users/dir_123")).toBe("workos");
    expect(matchRootFallback("/audit_logs")).toBe("workos");
    expect(matchRootFallback("/events")).toBe("workos");
    expect(matchRootFallback("/portal/generate_link")).toBe("workos");
  });

  it("routes Stripe REST and hosted checkout to stripe", () => {
    expect(matchRootFallback("/v1/charges")).toBe("stripe");
    expect(matchRootFallback("/v1/payment_intents/pi_1")).toBe("stripe");
    expect(matchRootFallback("/v1/events")).toBe("stripe");
    expect(matchRootFallback("/checkout/cs_test_123")).toBe("stripe");
  });

  it("routes Xero API, connections, and identity token to xero", () => {
    expect(matchRootFallback("/api.xro/2.0/Invoices")).toBe("xero");
    expect(matchRootFallback("/connections")).toBe("xero");
    expect(matchRootFallback("/connect/token")).toBe("xero");
  });

  it("routes QuickBooks data + token endpoints to quickbooks", () => {
    expect(matchRootFallback("/v3/company/123/invoice")).toBe("quickbooks");
    expect(matchRootFallback("/oauth2/v1/tokens/bearer")).toBe("quickbooks");
  });

  it("routes Salesforce data + oauth2 to salesforce", () => {
    expect(matchRootFallback("/services/data/v59.0/query")).toBe("salesforce");
    expect(matchRootFallback("/services/oauth2/token")).toBe("salesforce");
  });

  it("returns undefined for unclaimed root paths", () => {
    expect(matchRootFallback("/")).toBeUndefined();
    expect(matchRootFallback("/_inspector")).toBeUndefined();
    expect(matchRootFallback("/_admin/health")).toBeUndefined();
    expect(matchRootFallback("/github/repos")).toBeUndefined();
  });

  it("matches on path segments only, never partial segments", () => {
    // `/v1` must not swallow `/v1x` or `/version`
    expect(matchRootFallback("/v1")).toBe("stripe");
    expect(matchRootFallback("/v1x/foo")).toBeUndefined();
    expect(matchRootFallback("/version")).toBeUndefined();
    // `/events` (workos) must not match `/eventsource`
    expect(matchRootFallback("/eventsource")).toBeUndefined();
  });

  it("resolves the longest prefix regardless of declaration order", () => {
    const routes: RootFallbackRoute[] = [
      { prefix: "/services", service: "broad" },
      { prefix: "/services/data", service: "specific" },
    ];
    expect(matchRootFallback("/services/data/v1", routes)).toBe("specific");
    expect(matchRootFallback("/services/other", routes)).toBe("broad");
    // reversed declaration order yields the same answer
    expect(matchRootFallback("/services/data/v1", [...routes].reverse())).toBe("specific");
  });

  it("ships a non-empty default table covering all five prefix-less SDKs", () => {
    const services = new Set(ROOT_FALLBACK_ROUTES.map((r) => r.service));
    expect(services).toEqual(new Set(["workos", "stripe", "xero", "quickbooks", "salesforce"]));
    // every prefix is absolute and has no trailing slash
    for (const r of ROOT_FALLBACK_ROUTES) {
      expect(r.prefix.startsWith("/")).toBe(true);
      expect(r.prefix.endsWith("/")).toBe(false);
    }
  });
});
