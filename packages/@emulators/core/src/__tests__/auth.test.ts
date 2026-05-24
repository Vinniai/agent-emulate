import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import {
  authMiddleware,
  requireAuth,
  requireScope,
  requireAuthWhen,
  authFlagEnabled,
  requireAppAuth,
  serializeTokenMap,
  restoreTokenMap,
  type TokenMap,
  type AppEnv,
} from "../middleware/auth.js";

describe("authMiddleware", () => {
  let tokenMap: TokenMap;

  beforeEach(() => {
    tokenMap = new Map();
  });

  it("sets authUser on context when the token exists in tokenMap", async () => {
    tokenMap.set("test-token", { login: "testuser", id: 1, scopes: ["repo"] });

    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.get("/test", (c) => c.json({ user: c.get("authUser") }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { login: string; id: number; scopes: string[] } };
    expect(body.user).toEqual({ login: "testuser", id: 1, scopes: ["repo"] });
  });

  it("maps unknown tokens to fallbackUser when configured", async () => {
    const fallbackUser = { login: "fallback", id: 99, scopes: ["read:org"] };

    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap, undefined, fallbackUser));
    app.get("/test", (c) => c.json({ user: c.get("authUser") }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer unknown-secret" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { login: string; id: number; scopes: string[] } };
    expect(body.user).toEqual(fallbackUser);
    expect(tokenMap.has("unknown-secret")).toBe(false);
  });

  it("does not set authUser when there is no Authorization header", async () => {
    tokenMap.set("test-token", { login: "testuser", id: 1, scopes: ["repo"] });

    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.get("/test", (c) => c.json({ user: c.get("authUser") ?? null }));

    const res = await app.request("/test");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });
});

describe("requireAuth", () => {
  let tokenMap: TokenMap;

  beforeEach(() => {
    tokenMap = new Map();
    tokenMap.set("ok-token", { login: "alice", id: 1, scopes: [] });
  });

  it("returns 401 when authUser is not set", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.use("*", requireAuth());
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string; documentation_url: string };
    expect(body.message).toBe("Requires authentication");
    expect(body.documentation_url).toBe("https://github.com/Vinniai/agent-emulate#readme");
  });

  it("passes through when authUser exists", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.use("*", requireAuth());
    app.get("/protected", (c) => c.json({ user: c.get("authUser") }));

    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer ok-token" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { login: string } };
    expect(body.user?.login).toBe("alice");
  });
});

describe("requireScope", () => {
  const prevLax = process.env.EMULATE_AUTH_LAX;
  let tokenMap: TokenMap;

  beforeEach(() => {
    delete process.env.EMULATE_AUTH_LAX;
    tokenMap = new Map();
    tokenMap.set("repo-token", { login: "alice", id: 1, scopes: ["repo", "user"] });
    tokenMap.set("readonly-token", { login: "bob", id: 2, scopes: ["user"] });
    tokenMap.set("wildcard-token", { login: "root", id: 3, scopes: ["*"] });
  });

  afterAll(() => {
    if (prevLax === undefined) delete process.env.EMULATE_AUTH_LAX;
    else process.env.EMULATE_AUTH_LAX = prevLax;
  });

  function appWith(...scopes: string[]) {
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.use("*", requireAuth());
    app.use("*", requireScope(...scopes));
    app.get("/data", (c) => c.json({ ok: true }));
    return app;
  }

  it("passes when the token holds every required scope", async () => {
    const res = await appWith("repo").request("/data", {
      headers: { Authorization: "Bearer repo-token" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 insufficient_scope when a required scope is missing", async () => {
    const res = await appWith("repo").request("/data", {
      headers: { Authorization: "Bearer readonly-token" },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer error="insufficient_scope", scope="repo"');
    const body = (await res.json()) as { message: string; documentation_url: string };
    expect(body.message).toContain("repo");
  });

  it("ANDs multiple required scopes", async () => {
    const res = await appWith("repo", "admin:org").request("/data", {
      headers: { Authorization: "Bearer repo-token" },
    });
    expect(res.status).toBe(403);
  });

  it("a wildcard `*` scope satisfies any requirement", async () => {
    const res = await appWith("repo", "admin:org").request("/data", {
      headers: { Authorization: "Bearer wildcard-token" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when there is no authenticated user", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.use("*", requireScope("repo"));
    app.get("/data", (c) => c.json({ ok: true }));
    const res = await app.request("/data");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Requires authentication");
  });

  it("EMULATE_AUTH_LAX=1 bypasses scope enforcement", async () => {
    process.env.EMULATE_AUTH_LAX = "1";
    const res = await appWith("repo").request("/data", {
      headers: { Authorization: "Bearer readonly-token" },
    });
    expect(res.status).toBe(200);
  });
});

describe("authFlagEnabled", () => {
  const FLAG = "EMULATE_TEST_REQUIRE_AUTH";
  const prev = process.env[FLAG];
  afterAll(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  it('is false when unset, true only for "1"/"true"', () => {
    delete process.env[FLAG];
    expect(authFlagEnabled(FLAG)).toBe(false);
    process.env[FLAG] = "0";
    expect(authFlagEnabled(FLAG)).toBe(false);
    process.env[FLAG] = "yes";
    expect(authFlagEnabled(FLAG)).toBe(false);
    process.env[FLAG] = "1";
    expect(authFlagEnabled(FLAG)).toBe(true);
    process.env[FLAG] = "true";
    expect(authFlagEnabled(FLAG)).toBe(true);
  });

  it("ORs across multiple flags", () => {
    delete process.env[FLAG];
    delete process.env.EMULATE_REQUIRE_AUTH;
    expect(authFlagEnabled(FLAG, "EMULATE_REQUIRE_AUTH")).toBe(false);
    process.env.EMULATE_REQUIRE_AUTH = "1";
    expect(authFlagEnabled(FLAG, "EMULATE_REQUIRE_AUTH")).toBe(true);
    delete process.env.EMULATE_REQUIRE_AUTH;
  });
});

describe("requireAuthWhen", () => {
  const FLAG = "EMULATE_TEST_REQUIRE_AUTH";
  const prevFlag = process.env[FLAG];
  const prevLax = process.env.EMULATE_AUTH_LAX;
  let tokenMap: TokenMap;

  beforeEach(() => {
    delete process.env[FLAG];
    delete process.env.EMULATE_AUTH_LAX;
    tokenMap = new Map();
    tokenMap.set("good-token", { login: "alice", id: 1, scopes: ["repo"] });
  });

  afterAll(() => {
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
    if (prevLax === undefined) delete process.env.EMULATE_AUTH_LAX;
    else process.env.EMULATE_AUTH_LAX = prevLax;
  });

  function app() {
    const a = new Hono<AppEnv>();
    a.use("*", authMiddleware(tokenMap));
    a.use("*", requireAuthWhen(FLAG, "EMULATE_REQUIRE_AUTH"));
    a.get("/data", (c) => c.json({ ok: true }));
    return a;
  }

  it("is a pass-through when no flag is set (back-compat default)", async () => {
    const res = await app().request("/data");
    expect(res.status).toBe(200);
  });

  it("401s an unauthenticated request once the flag is on", async () => {
    process.env[FLAG] = "1";
    const res = await app().request("/data");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Requires authentication");
  });

  it("still allows an authenticated request when the flag is on", async () => {
    process.env[FLAG] = "1";
    const res = await app().request("/data", {
      headers: { Authorization: "Bearer good-token" },
    });
    expect(res.status).toBe(200);
  });

  it("honours the shared umbrella flag too", async () => {
    process.env.EMULATE_REQUIRE_AUTH = "true";
    const res = await app().request("/data");
    expect(res.status).toBe(401);
    delete process.env.EMULATE_REQUIRE_AUTH;
  });

  it("EMULATE_AUTH_LAX=1 wins over an enabled flag (global relax)", async () => {
    process.env[FLAG] = "1";
    process.env.EMULATE_AUTH_LAX = "1";
    const res = await app().request("/data");
    expect(res.status).toBe(200);
  });
});

describe("requireAppAuth", () => {
  it("returns 401 when authApp is not set", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requireAppAuth());
    app.get("/app-route", (c) => c.json({ ok: true }));

    const res = await app.request("/app-route");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string; documentation_url: string };
    expect(body.message).toBe("A JSON web token could not be decoded");
    expect(body.documentation_url).toBe("https://github.com/Vinniai/agent-emulate#readme");
  });

  it("passes through when authApp exists", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("authApp", { appId: 42, slug: "my-app", name: "My App" });
      await next();
    });
    app.use("*", requireAppAuth());
    app.get("/app-route", (c) => c.json({ app: c.get("authApp") }));

    const res = await app.request("/app-route");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      app: { appId: number; slug: string; name: string };
    };
    expect(body.app).toEqual({ appId: 42, slug: "my-app", name: "My App" });
  });
});

describe("authMiddleware token expiry", () => {
  const prevLax = process.env.EMULATE_AUTH_LAX;
  beforeEach(() => {
    delete process.env.EMULATE_AUTH_LAX;
  });
  afterAll(() => {
    if (prevLax === undefined) delete process.env.EMULATE_AUTH_LAX;
    else process.env.EMULATE_AUTH_LAX = prevLax;
  });

  function appWithMap(tokenMap: TokenMap) {
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap));
    app.use("/guarded", requireAuth());
    app.get("/guarded", (c) => c.json({ user: c.get("authUser") }));
    return app;
  }

  it("rejects an expired token with 401 and evicts it from the map", async () => {
    const tokenMap: TokenMap = new Map();
    tokenMap.set("tok", { login: "u", id: 1, scopes: [], expiresAt: Date.now() - 1000 });
    const app = appWithMap(tokenMap);

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(401);
    expect(tokenMap.has("tok")).toBe(false);
  });

  it("an expired issued token is NOT rescued by the convenience fallbackUser", async () => {
    // The standalone server always wires a `defaultFallback`. An expired token
    // the emulator issued must still 401 (driving refresh) rather than being
    // silently re-mapped to the fallback identity.
    const tokenMap: TokenMap = new Map();
    tokenMap.set("tok", { login: "u", id: 1, scopes: [], expiresAt: Date.now() - 1000 });
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap, undefined, { login: "fallback", id: 99, scopes: [] }));
    app.use("/guarded", requireAuth());
    app.get("/guarded", (c) => c.json({ user: c.get("authUser") }));

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(401);
    expect(tokenMap.has("tok")).toBe(false);
  });

  it("an unknown token still falls back (test convenience preserved)", async () => {
    const tokenMap: TokenMap = new Map();
    const app = new Hono<AppEnv>();
    app.use("*", authMiddleware(tokenMap, undefined, { login: "fallback", id: 99, scopes: [] }));
    app.use("/guarded", requireAuth());
    app.get("/guarded", (c) => c.json({ user: c.get("authUser") }));

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer never-issued" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { login: string } };
    expect(body.user.login).toBe("fallback");
  });

  it("accepts a not-yet-expired token", async () => {
    const tokenMap: TokenMap = new Map();
    tokenMap.set("tok", { login: "u", id: 1, scopes: [], expiresAt: Date.now() + 60_000 });
    const app = appWithMap(tokenMap);

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
  });

  it("treats tokens without expiresAt as non-expiring (backward compatible)", async () => {
    const tokenMap: TokenMap = new Map();
    tokenMap.set("tok", { login: "u", id: 1, scopes: [] });
    const app = appWithMap(tokenMap);

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
  });

  it("EMULATE_AUTH_LAX=1 disables expiry enforcement", async () => {
    process.env.EMULATE_AUTH_LAX = "1";
    const tokenMap: TokenMap = new Map();
    tokenMap.set("tok", { login: "u", id: 1, scopes: [], expiresAt: Date.now() - 1000 });
    const app = appWithMap(tokenMap);

    const res = await app.request("/guarded", { headers: { Authorization: "Bearer tok" } });
    expect(res.status).toBe(200);
    expect(tokenMap.has("tok")).toBe(true);
  });

  it("round-trips expiresAt through serialize/restore", () => {
    const tokenMap: TokenMap = new Map();
    const exp = Date.now() + 5000;
    tokenMap.set("a", { login: "u", id: 1, scopes: ["x"], expiresAt: exp });
    tokenMap.set("b", { login: "v", id: 2, scopes: [] });

    const restored: TokenMap = new Map();
    restoreTokenMap(restored, serializeTokenMap(tokenMap));
    expect(restored.get("a")).toEqual({ login: "u", id: 1, scopes: ["x"], expiresAt: exp });
    expect(restored.get("b")).toEqual({ login: "v", id: 2, scopes: [] });
  });
});
