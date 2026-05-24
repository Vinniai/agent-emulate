// Some vendor SDKs cannot be configured with a URL path prefix — they only
// accept a host (e.g. Stripe's `apiBase`, Salesforce's instance URL, Xero's
// `https://api.xero.com`). When such an SDK is pointed at a bare emulate-server
// origin (`http://localhost:4000`) it hits well-known absolute paths at the
// root instead of `/<service>/...`. This table maps those root paths back to
// the owning service so prefix-less SDKs work alongside path-routed access.
//
// This is intentionally a pure, dependency-free module: the routing decision is
// unit-tested here (apps/server has no test harness), and `service` is a plain
// string so core stays agnostic of the server's ServiceName union — the caller
// looks the name up in its app map and safely ignores misses.

export interface RootFallbackRoute {
  /** Absolute root path the SDK hits (no trailing slash). */
  prefix: string;
  /** Service name that owns this prefix in the server's app map. */
  service: string;
}

// One entry per root path a prefix-less SDK is known to call. Order here is
// irrelevant — `matchRootFallback` resolves by longest prefix first so nested
// paths (`/services/data` vs `/services`) are deterministic regardless of
// declaration order.
export const ROOT_FALLBACK_ROUTES: readonly RootFallbackRoute[] = [
  // WorkOS — SDK base URL is `https://api.workos.com` (no prefix).
  { prefix: "/user_management", service: "workos" },
  { prefix: "/sso", service: "workos" },
  { prefix: "/organizations", service: "workos" },
  { prefix: "/directory", service: "workos" },
  { prefix: "/directory_users", service: "workos" },
  { prefix: "/directory_groups", service: "workos" },
  { prefix: "/audit_logs", service: "workos" },
  { prefix: "/events", service: "workos" },
  { prefix: "/portal", service: "workos" },
  // Stripe — `apiBase`/`protocol://host` only; all REST is under `/v1`, hosted
  // checkout pages are served at `/checkout/:id`.
  { prefix: "/v1", service: "stripe" },
  { prefix: "/checkout", service: "stripe" },
  // Xero — `https://api.xero.com` + `https://identity.xero.com`.
  { prefix: "/api.xro/2.0", service: "xero" },
  { prefix: "/connections", service: "xero" },
  { prefix: "/connect/token", service: "xero" },
  // QuickBooks Online — `https://quickbooks.api.intuit.com` +
  // `https://oauth.platform.intuit.com`.
  { prefix: "/v3/company", service: "quickbooks" },
  { prefix: "/oauth2/v1", service: "quickbooks" },
  // Salesforce — instance URL only; all calls are under `/services/*`.
  { prefix: "/services/data", service: "salesforce" },
  { prefix: "/services/oauth2", service: "salesforce" },
];

/**
 * Resolve a root-level request path to the service that owns it, or
 * `undefined` if no prefix-less SDK claims it. Matching is exact-or-segment
 * (`/v1` matches `/v1` and `/v1/charges` but not `/v1x`) and longest-prefix
 * wins, so `/v3/company` beats a hypothetical `/v3` and declaration order in
 * the table never matters.
 */
export function matchRootFallback(
  pathname: string,
  routes: readonly RootFallbackRoute[] = ROOT_FALLBACK_ROUTES,
): string | undefined {
  let best: RootFallbackRoute | undefined;
  for (const r of routes) {
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) {
      if (!best || r.prefix.length > best.prefix.length) best = r;
    }
  }
  return best?.service;
}
