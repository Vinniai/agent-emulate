import type { Context, Next } from "hono";
import { jwtVerify, importPKCS8 } from "jose";
import { debug } from "../debug.js";

export interface AuthUser {
  login: string;
  id: number;
  scopes: string[];
  /**
   * Epoch ms after which this token is rejected (401). Optional: providers
   * that want production-like expiry set it (e.g. `Date.now() + 3600_000`).
   * Tokens without it never expire — backward compatible with every
   * `tokenMap.set(t, { login, id, scopes })` call across the emulators.
   * Enforcement can be globally disabled with `EMULATE_AUTH_LAX=1`.
   */
  expiresAt?: number;
}

/**
 * Lax mode keeps the "any known token is valid forever" behaviour — handy for
 * quick tests that don't want to deal with refresh. Read per-request so tests
 * can toggle `process.env.EMULATE_AUTH_LAX` between cases.
 */
function authLax(): boolean {
  const v = process.env.EMULATE_AUTH_LAX;
  return v === "1" || v === "true";
}

export interface AuthApp {
  appId: number;
  slug: string;
  name: string;
}

export interface AuthInstallation {
  installationId: number;
  appId: number;
  permissions: Record<string, string>;
  repositoryIds: number[];
  repositorySelection: "all" | "selected";
}

export type TokenMap = Map<string, AuthUser>;

export interface TokenEntry {
  token: string;
  login: string;
  id: number;
  scopes: string[];
  expiresAt?: number;
}

export function serializeTokenMap(tokenMap: TokenMap): TokenEntry[] {
  return [...tokenMap.entries()].map(([token, user]) => ({
    token,
    login: user.login,
    id: user.id,
    scopes: user.scopes,
    ...(user.expiresAt !== undefined ? { expiresAt: user.expiresAt } : {}),
  }));
}

export function restoreTokenMap(tokenMap: TokenMap, tokens: TokenEntry[]): void {
  tokenMap.clear();
  for (const t of tokens) {
    tokenMap.set(t.token, {
      login: t.login,
      id: t.id,
      scopes: t.scopes,
      ...(t.expiresAt !== undefined ? { expiresAt: t.expiresAt } : {}),
    });
  }
}

export type AppEnv = {
  Variables: {
    authUser?: AuthUser;
    authApp?: AuthApp;
    authToken?: string;
    authScopes?: string[];
    docsUrl?: string;
  };
};

export interface AppKeyResolver {
  (appId: number): { privateKey: string; slug: string; name: string } | null;
}

export interface AuthFallback {
  login: string;
  id: number;
  scopes: string[];
}

export function authMiddleware(tokens: TokenMap, appKeyResolver?: AppKeyResolver, fallbackUser?: AuthFallback) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader) {
      const token = authHeader.replace(/^(Bearer|token)\s+/i, "").trim();

      if (token.startsWith("eyJ") && appKeyResolver) {
        try {
          const [, payloadB64] = token.split(".");
          const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
          const appId = typeof payload.iss === "string" ? parseInt(payload.iss, 10) : payload.iss;

          if (typeof appId === "number" && !isNaN(appId)) {
            const appInfo = appKeyResolver(appId);
            if (appInfo) {
              const key = await importPKCS8(appInfo.privateKey, "RS256");
              await jwtVerify(token, key, { algorithms: ["RS256"] });
              c.set("authApp", {
                appId,
                slug: appInfo.slug,
                name: appInfo.name,
              } satisfies AuthApp);
            }
          }
        } catch {
          // JWT verification failed
        }
      } else {
        let user = tokens.get(token);
        let expiredKnownToken = false;
        if (user && user.expiresAt !== undefined && !authLax() && Date.now() > user.expiresAt) {
          // Expired: drop it and fall through unauthenticated so requireAuth()
          // returns the provider's own 401 — exactly what a real expired
          // access token does, driving the consumer's refresh path.
          debug("auth", "expired token rejected", { login: user.login, expiredMsAgo: Date.now() - user.expiresAt });
          tokens.delete(token);
          user = undefined;
          // A token the emulator *issued* and that has now expired must 401 —
          // it must NOT be rescued by the convenience fallback below, or
          // expiry-driven refresh flows can never be exercised against the
          // standalone server (which always wires a `defaultFallback`).
          expiredKnownToken = true;
        }
        if (!user && !expiredKnownToken && fallbackUser && token.length > 0) {
          debug("auth", "fallback user for unknown token", { login: fallbackUser.login, id: fallbackUser.id });
          user = { login: fallbackUser.login, id: fallbackUser.id, scopes: fallbackUser.scopes };
        }
        if (user) {
          c.set("authUser", user);
          c.set("authToken", token);
          c.set("authScopes", user.scopes);
        }
      }
    }
    await next();
  };
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    if (!c.get("authUser")) {
      const docsUrl = (c.get("docsUrl") as string | undefined) ?? "https://github.com/Vinniai/agent-emulate#readme";
      return c.json(
        {
          message: "Requires authentication",
          documentation_url: docsUrl,
        },
        401,
      );
    }
    await next();
  };
}

/**
 * Opt-in scope guard for data routes (RFC 6750 §3.1). Mount *after*
 * `requireAuth()` on routes that should reject tokens lacking a scope —
 * this exercises the consumer's re-consent / scope-upgrade path against
 * the emulator instead of always succeeding.
 *
 * Behaviour (chosen to be drop-in and non-breaking):
 *  - `EMULATE_AUTH_LAX=1|true` → bypass entirely (mirrors token-expiry lax),
 *    so the ~30 generated smoke tests and quick demos are unaffected.
 *  - No authenticated user → 401 (same body as `requireAuth`) so the guard
 *    is safe even if mounted without `requireAuth` ahead of it.
 *  - A token carrying the wildcard `*` scope satisfies any requirement —
 *    matches how the standalone server issues "all scopes" default tokens.
 *  - Otherwise every listed scope must be held (AND-ed); a miss returns 403
 *    with `WWW-Authenticate: Bearer error="insufficient_scope"` (RFC 6750),
 *    which real SDKs surface as a permission error.
 */
export function requireScope(...required: string[]) {
  return async (c: Context, next: Next) => {
    if (!authLax()) {
      const user = c.get("authUser") as AuthUser | undefined;
      const docsUrl = (c.get("docsUrl") as string | undefined) ?? "https://github.com/Vinniai/agent-emulate#readme";
      if (!user) {
        return c.json({ message: "Requires authentication", documentation_url: docsUrl }, 401);
      }
      const held = new Set<string>(c.get("authScopes") ?? user.scopes ?? []);
      if (!held.has("*")) {
        const missing = required.filter((s) => !held.has(s));
        if (missing.length > 0) {
          c.header("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${required.join(" ")}"`);
          return c.json(
            {
              message: `Token missing required scope: ${missing.join(", ")}`,
              documentation_url: docsUrl,
            },
            403,
          );
        }
      }
    }
    await next();
  };
}

/**
 * Whether any of the named env flags is switched on (`"1"` or `"true"`).
 * Read per-request (like `authLax`) so tests can toggle between cases.
 * Exposed for unit-testing the gate without spinning up a server.
 */
export function authFlagEnabled(...flags: string[]): boolean {
  return flags.some((f) => {
    const v = process.env[f];
    return v === "1" || v === "true";
  });
}

/**
 * Conditionally-enforced auth guard for providers whose real APIs reject
 * unauthenticated calls, but whose emulators have always accepted them so the
 * generated smoke tests and zero-setup quickstarts stay green.
 *
 * Mount it where `requireAuth()` would go on the data routes. Behaviour is
 * deliberately drop-in and non-breaking:
 *
 *  - No listed flag enabled         → pass-through (the back-compat default,
 *    so existing tests/demos are completely unaffected).
 *  - `EMULATE_AUTH_LAX=1|true`      → pass-through (the global relax wins,
 *    mirroring token-expiry lax and `requireScope`).
 *  - A listed flag enabled, but no authenticated user → 401 with the same
 *    body as `requireAuth()`, so opting in exercises the consumer's auth
 *    path exactly like production.
 *  - A listed flag enabled and a user present → continue.
 *
 * Variadic so a provider can honour both its own switch and a shared
 * umbrella, e.g. `requireAuthWhen("EMULATE_STRIPE_REQUIRE_AUTH",
 * "EMULATE_REQUIRE_AUTH")` — set the umbrella to gate every wired provider
 * at once.
 */
export function requireAuthWhen(...flags: string[]) {
  return async (c: Context, next: Next) => {
    if (!authLax() && authFlagEnabled(...flags) && !c.get("authUser")) {
      const docsUrl = (c.get("docsUrl") as string | undefined) ?? "https://github.com/Vinniai/agent-emulate#readme";
      return c.json({ message: "Requires authentication", documentation_url: docsUrl }, 401);
    }
    await next();
  };
}

export function requireAppAuth() {
  return async (c: Context, next: Next) => {
    if (!c.get("authApp")) {
      const docsUrl = (c.get("docsUrl") as string | undefined) ?? "https://github.com/Vinniai/agent-emulate#readme";
      return c.json(
        {
          message: "A JSON web token could not be decoded",
          documentation_url: docsUrl,
        },
        401,
      );
    }
    await next();
  };
}
