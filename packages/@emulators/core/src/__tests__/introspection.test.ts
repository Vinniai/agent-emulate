import { describe, it, expect } from "vitest";
import { buildIntrospectionResponse } from "../introspection.js";
import type { AuthUser, TokenMap } from "../middleware/auth.js";

function mapWith(token: string, user: AuthUser): TokenMap {
  const m: TokenMap = new Map();
  m.set(token, user);
  return m;
}

describe("buildIntrospectionResponse", () => {
  it("returns { active: false } for an unknown token", () => {
    const m: TokenMap = new Map();
    expect(buildIntrospectionResponse(m, "nope")).toEqual({ active: false });
  });

  it("returns { active: false } for an empty token without touching the map", () => {
    const m = mapWith("", { login: "x", id: 1, scopes: [] });
    expect(buildIntrospectionResponse(m, "")).toEqual({ active: false });
  });

  it("returns the RFC 7662 active body for a known token", () => {
    const m = mapWith("tok", { login: "alice@agent-emulate.dev", id: 42, scopes: ["openid", "email"] });
    expect(buildIntrospectionResponse(m, "tok")).toEqual({
      active: true,
      token_type: "Bearer",
      scope: "openid email",
      username: "alice@agent-emulate.dev",
      sub: "42",
    });
  });

  it("echoes issuer/audience and converts expiresAt (ms) to exp (seconds)", () => {
    const expiresAt = Date.now() + 3_600_000;
    const m = mapWith("tok", { login: "bob", id: 7, scopes: ["profile"], expiresAt });
    const res = buildIntrospectionResponse(m, "tok", {
      issuer: "https://emu.example/oauth",
      audience: ["api://default"],
      tokenType: "access_token",
    });
    expect(res.active).toBe(true);
    expect(res.iss).toBe("https://emu.example/oauth");
    expect(res.aud).toEqual(["api://default"]);
    expect(res.token_type).toBe("access_token");
    expect(res.exp).toBe(Math.floor(expiresAt / 1000));
  });

  it("treats an expired token as inactive (RFC 7662 §2.2)", () => {
    const m = mapWith("tok", { login: "bob", id: 7, scopes: ["profile"], expiresAt: Date.now() - 1000 });
    expect(buildIntrospectionResponse(m, "tok", { issuer: "x" })).toEqual({ active: false });
  });
});
