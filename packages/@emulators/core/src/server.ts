import { Hono } from "hono";
import { cors } from "hono/cors";
import { Store } from "./store.js";
import { TenantStore, withTenant } from "./tenant-store.js";
import { WebhookDispatcher } from "./webhooks.js";
import { createApiErrorHandler, createErrorHandler } from "./middleware/error-handler.js";
import {
  authMiddleware,
  type AuthFallback,
  type TokenMap,
  type AppKeyResolver,
  type AppEnv,
} from "./middleware/auth.js";
import type { ServicePlugin } from "./plugin.js";
import { registerFontRoutes } from "./fonts.js";
import { rateLimitProfile, rateLimitHeaders } from "./rate-limit.js";

export interface ServerOptions {
  port?: number;
  baseUrl?: string;
  docsUrl?: string;
  tokens?: Record<string, { login: string; id: number; scopes?: string[] }>;
  appKeyResolver?: AppKeyResolver;
  fallbackUser?: AuthFallback;
  /** Override the resolved provider rate-limit window (useful in tests). */
  rateLimit?: { limit?: number; windowSec?: number };
  /**
   * Opt-in multi-tenant isolation (Phase 4.2e). When true (or env
   * `EMULATE_MULTI_TENANT=1|true`), each request is scoped to the tenant in
   * the `X-Emulate-Tenant` header — every tenant gets its own backing store,
   * so two orgs hitting the same emulator never see each other's data.
   * Default false → a single shared store, byte-for-byte the prior behaviour.
   */
  multiTenant?: boolean;
}

export function createServer(plugin: ServicePlugin, options: ServerOptions = {}) {
  const port = options.port ?? 4000;
  const baseUrl = options.baseUrl ?? `http://localhost:${port}`;

  const multiTenant =
    options.multiTenant ?? (process.env.EMULATE_MULTI_TENANT === "1" || process.env.EMULATE_MULTI_TENANT === "true");

  const app = new Hono<AppEnv>();
  const store: Store = multiTenant ? new TenantStore() : new Store();
  const webhooks = new WebhookDispatcher();

  const tokenMap: TokenMap = new Map();
  if (options.tokens) {
    for (const [token, user] of Object.entries(options.tokens)) {
      tokenMap.set(token, {
        login: user.login,
        id: user.id,
        scopes: user.scopes ?? ["repo", "user", "admin:org", "admin:repo_hook"],
      });
    }
  }

  const docsUrl = options.docsUrl ?? "https://github.com/Vinniai/agent-emulate#readme";

  registerFontRoutes(app);

  app.onError(createApiErrorHandler(docsUrl));
  app.use("*", cors());
  app.use("*", createErrorHandler(docsUrl));
  app.use("*", authMiddleware(tokenMap, options.appKeyResolver, options.fallbackUser));

  if (multiTenant) {
    // Scope the whole downstream request (plugin handlers included) to the
    // tenant from `X-Emulate-Tenant`; absent → the "default" tenant.
    app.use("*", (c, next) => withTenant(c.req.header("X-Emulate-Tenant"), () => next()));
  }

  const rlProfile = rateLimitProfile(plugin.name);
  const rlLimit = options.rateLimit?.limit ?? rlProfile.limit;
  const rlWindow = options.rateLimit?.windowSec ?? rlProfile.windowSec;
  const rateLimitCounters = new Map<string, { remaining: number; resetAt: number }>();
  let lastPruneAt = Math.floor(Date.now() / 1000);

  app.use("*", async (c, next) => {
    const token = c.get("authToken") ?? "__anonymous__";
    const now = Math.floor(Date.now() / 1000);

    if (now - lastPruneAt > 3600) {
      for (const [key, val] of rateLimitCounters) {
        if (val.resetAt <= now) rateLimitCounters.delete(key);
      }
      lastPruneAt = now;
    }

    let counter = rateLimitCounters.get(token);
    if (!counter || counter.resetAt <= now) {
      counter = { remaining: rlLimit, resetAt: now + rlWindow };
      rateLimitCounters.set(token, counter);
    }

    counter.remaining = Math.max(0, counter.remaining - 1);

    for (const [k, v] of Object.entries(rateLimitHeaders(rlProfile, counter, now))) {
      c.header(k, v);
    }

    if (counter.remaining === 0) {
      const retryAfter = Math.max(0, counter.resetAt - now);
      return c.json(rlProfile.body(retryAfter, docsUrl) as Record<string, unknown>, rlProfile.exceededStatus);
    }

    await next();
  });

  plugin.register(app, store, webhooks, baseUrl, tokenMap);

  app.notFound((c) =>
    c.json(
      {
        message: "Not Found",
        documentation_url: docsUrl,
      },
      404,
    ),
  );

  return { app, store, webhooks, port, baseUrl, tokenMap };
}
