import type { Hono } from "hono";
import type { AppEnv } from "@emulators/core";
import { getSimproStore } from "@emulators/simpro";
import type { ServiceApp, ServiceName } from "./dispatcher.js";

// Nango's `/proxy/*` endpoint forwards verbatim to a provider's own REST API.
// The @emulators/nango package is intentionally provider-agnostic (records-
// backed) and must stay that way — see simpro-nango-bridge.ts. Simpro, however,
// is a full REST emulator with its own OAuth + CRUD surface, so the faithful
// behaviour for `Provider-Config-Key: simpro` proxy calls is to forward them to
// the live Simpro service rather than synthesise from the 3-model records
// bridge. That Simpro-specific wiring lives here, in the server layer.
//
// taskr's Nango client calls e.g.
//   GET /nango/proxy/api/v1.0/companies/0/quotes/?page=1
//   headers: Provider-Config-Key: simpro, Connection-Id: <id>, Authorization: Bearer <nango-secret>
// We strip `/nango/proxy/`, inject a real Simpro Bearer token (the Nango secret
// the caller sent is meaningless to Simpro), and dispatch to the Simpro Hono app
// (which the dispatcher would otherwise reach at /simpro/*). Everything else
// (Xero/QuickBooks/Google/Graph/…) falls through to the records-backed nango
// proxy untouched via next().

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PROXY_PREFIX = "/nango/proxy/";

// A stable, long-lived access token minted directly into the Simpro store so
// the forward never needs to run the OAuth dance per request. Re-minted lazily
// if a store reset/reseed wipes it (see ensureProxyToken).
const PROXY_TOKEN = "acc_nango_proxy_forward_static";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function ensureProxyToken(simproApp: ServiceApp): string {
  const ss = getSimproStore(simproApp.store);
  const existing = ss.oauthTokens.findOneBy("access_token", PROXY_TOKEN);
  const now = Date.now();
  if (existing && !existing.revoked && existing.expires_at > now) {
    return PROXY_TOKEN;
  }
  if (existing) {
    ss.oauthTokens.update(existing.id, {
      revoked: false,
      expires_at: now + ONE_YEAR_MS,
      refresh_expires_at: now + ONE_YEAR_MS,
    });
    return PROXY_TOKEN;
  }
  const clientId = simproApp.store.getData<string>("simpro.oauth.client_id") ?? "emulator-simpro-client";
  ss.oauthTokens.insert({
    access_token: PROXY_TOKEN,
    refresh_token: "ref_nango_proxy_forward_static",
    client_id: clientId,
    user_id: 0,
    expires_at: now + ONE_YEAR_MS,
    refresh_expires_at: now + ONE_YEAR_MS,
    revoked: false,
  });
  return PROXY_TOKEN;
}

function isSimproProxy(providerConfigKey: string, simproPath: string): boolean {
  if (providerConfigKey.toLowerCase().includes("simpro")) return true;
  // Fallback signal: the Simpro REST surface is rooted at api/v1.0/companies.
  // (Microsoft Graph uses a bare `v1.0/`, so require the `api/` prefix.)
  return simproPath.startsWith("api/v1.0/companies");
}

export function mountNangoSimproProxy(parent: Hono<AppEnv>, apps: Map<ServiceName, ServiceApp>): void {
  const simproApp = apps.get("simpro");
  if (!simproApp) return;

  // Registered before mountDispatcher so it intercepts /nango/proxy/* ahead of
  // the generic /:service/* dispatcher; non-Simpro calls fall through via next().
  parent.use(`${PROXY_PREFIX}*`, async (c, next) => {
    const url = new URL(c.req.url);
    const simproPath = url.pathname.slice(PROXY_PREFIX.length); // e.g. api/v1.0/...
    const providerConfigKey = c.req.header("Provider-Config-Key") ?? c.req.header("provider-config-key") ?? "";

    if (!isSimproProxy(providerConfigKey, simproPath)) {
      return next();
    }

    const token = ensureProxyToken(simproApp);

    // Rebuild the request against the Simpro app's own (prefix-less) path,
    // overriding Authorization with a token Simpro actually accepts.
    const targetUrl = new URL(`/${simproPath}${url.search}`, url.origin);
    const headers = new Headers(c.req.raw.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    const init: RequestInit & { duplex?: string } = {
      method: c.req.method,
      headers,
    };
    if (MUTATING_METHODS.has(c.req.method)) {
      init.body = c.req.raw.body;
      init.duplex = "half";
    }

    return simproApp.hono.fetch(new Request(targetUrl.toString(), init as RequestInit));
  });
}
