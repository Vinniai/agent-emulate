import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore, type SimproStore } from "../store.js";
import { simproError, token } from "../helpers.js";

const ACCESS_TOKEN_LIFETIME_SEC = 3600;
const REFRESH_TOKEN_LIFETIME_SEC = 14 * 24 * 3600;

export function oauthRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const authorize = (c: Context) => {
    const redirectUri = c.req.query("redirect_uri");
    const clientId = c.req.query("client_id") ?? "";
    const state = c.req.query("state");

    if (!redirectUri) return simproError(c, 400, "redirect_uri is required.", "redirect_uri");

    const code = token("code", 24);
    ss.oauthCodes.insert({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      user_id: 1,
      expires_at: Date.now() + 60_000,
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  };

  const tokenExchange = async (c: Context) => {
    const contentType = c.req.header("Content-Type") ?? "";
    let body: Record<string, string> = {};
    if (contentType.includes("application/json")) {
      try {
        body = (await c.req.json()) as Record<string, string>;
      } catch {
        return simproError(c, 400, "Invalid JSON body.");
      }
    } else {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      for (const [k, v] of params) body[k] = v;
    }

    const grantType = body.grant_type;
    const clientId = body.client_id ?? "";

    if (grantType === "authorization_code") {
      const code = body.code;
      if (!code) return simproError(c, 400, "code is required.", "code");
      const row = ss.oauthCodes.findOneBy("code", code);
      if (!row || row.expires_at < Date.now()) {
        return simproError(c, 400, "Invalid or expired authorization code.", "code", code);
      }
      ss.oauthCodes.delete(row.id);
      return issueTokenPair(c, ss, clientId || row.client_id, row.user_id);
    }

    if (grantType === "refresh_token") {
      const refresh = body.refresh_token;
      if (!refresh) return simproError(c, 400, "refresh_token is required.", "refresh_token");
      const row = ss.oauthTokens.findOneBy("refresh_token", refresh);
      if (!row || row.revoked || row.refresh_expires_at < Date.now()) {
        return simproError(c, 400, "Invalid or expired refresh token.", "refresh_token");
      }
      // Single-use refresh: revoke the old pair and issue a new one.
      ss.oauthTokens.update(row.id, { revoked: true });
      return issueTokenPair(c, ss, clientId || row.client_id, row.user_id);
    }

    return simproError(c, 400, `Unsupported grant_type: ${grantType}.`, "grant_type", grantType);
  };

  const currentUser = (c: Context) =>
    c.json({
      ID: 1,
      GivenName: "Emulator",
      FamilyName: "User",
      Email: "admin@agent-emulate.dev",
      Type: "employee",
    });

  app.get("/oauth/authorize", authorize);
  app.get("/oauth2/authorize", authorize);
  app.post("/oauth/token", tokenExchange);
  app.post("/oauth2/token", tokenExchange);
  app.get("/api/v1.0/companies/:cid/setup/users/current/", currentUser);
  app.get("/api/v1.0/:ignore/companies/:cid/setup/users/current/", currentUser);
}

function issueTokenPair(c: Context, ss: SimproStore, clientId: string, userId: number) {
  const now = Date.now();
  const accessToken = token("acc", 32);
  const refreshToken = token("ref", 32);
  ss.oauthTokens.insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id: clientId,
    user_id: userId,
    expires_at: now + ACCESS_TOKEN_LIFETIME_SEC * 1000,
    refresh_expires_at: now + REFRESH_TOKEN_LIFETIME_SEC * 1000,
    revoked: false,
  });
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_LIFETIME_SEC,
    refresh_token: refreshToken,
    scope: null,
  });
}
