// Direct HubSpot OAuth emulator routes (mounted under the nango plugin to
// avoid spinning up a whole new package). The Taskr backend's
// HubSpotDirectProvider can be pointed at the nango emulator base URL via
// HUBSPOT_EMULATOR_URL — this file then serves the three endpoints HubSpot
// exposes to OAuth integrators:
//
//   GET  /hubspot-emu/oauth/authorize          → consent page
//   POST /hubspot-emu/oauth/authorize/callback → mints code, redirects
//   POST /hubspot-emu/oauth/v1/token           → exchanges code for tokens
//   GET  /hubspot-emu/oauth/v1/access-tokens/:token → identity introspection
//
// State is kept in the shared store under "hubspot.oauth.*" so /reset clears it.

import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { bodyStr, renderCardPage, renderUserButton, type AppEnv, type Store } from "@emulators/core";

const SERVICE_LABEL = "HubSpot";
const PENDING_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 3600;

interface PendingCode {
  hubId: string;
  hubDomain: string;
  userId: string;
  userEmail: string;
  redirectUri: string;
  clientId: string;
  scope: string;
  createdAt: number;
}

interface IssuedToken {
  hubId: string;
  hubDomain: string;
  userId: string;
  userEmail: string;
  scope: string;
  expiresAt: number;
}

const PENDING_KEY = "hubspot.oauth.pendingCodes";
const TOKENS_KEY = "hubspot.oauth.issuedTokens";

const getPendingCodes = (store: Store): Map<string, PendingCode> => {
  let map = store.getData<Map<string, PendingCode>>(PENDING_KEY);
  if (!map) {
    map = new Map();
    store.setData(PENDING_KEY, map);
  }
  return map;
};

const getIssuedTokens = (store: Store): Map<string, IssuedToken> => {
  let map = store.getData<Map<string, IssuedToken>>(TOKENS_KEY);
  if (!map) {
    map = new Map();
    store.setData(TOKENS_KEY, map);
  }
  return map;
};

const DEFAULT_HUB = {
  hubId: "12345678",
  hubDomain: "emulator-hub.hubspot.com",
  userId: "u_admin",
  userEmail: "admin@agent-emulate.dev",
};

export const directHubspotRoutes = (app: Hono<AppEnv>, store: Store): void => {
  // Consent screen — list a single emulator hub user that the test can pick.
  app.get("/hubspot-emu/oauth/authorize", (c) => {
    const client_id = c.req.query("client_id") ?? "";
    const redirect_uri = c.req.query("redirect_uri") ?? "";
    const scope = c.req.query("scope") ?? "";
    const state = c.req.query("state") ?? "";

    const subtitle = "Authorize <strong>Taskr</strong> to access your HubSpot hub.";

    const body = renderUserButton({
      letter: "H",
      login: "Connect to HubSpot",
      name: DEFAULT_HUB.hubDomain,
      email: DEFAULT_HUB.userEmail,
      formAction: "/hubspot-emu/oauth/authorize/callback",
      hiddenFields: {
        client_id,
        redirect_uri,
        scope,
        state,
      },
    });

    return c.html(renderCardPage("Sign in to HubSpot", subtitle, body, SERVICE_LABEL));
  });

  app.post("/hubspot-emu/oauth/authorize/callback", async (c) => {
    const body = await c.req.parseBody();
    const client_id = bodyStr(body.client_id);
    const redirect_uri = bodyStr(body.redirect_uri);
    const scope = bodyStr(body.scope);
    const state = bodyStr(body.state);

    const code = randomBytes(20).toString("hex");
    getPendingCodes(store).set(code, {
      ...DEFAULT_HUB,
      clientId: client_id,
      redirectUri: redirect_uri,
      scope,
      createdAt: Date.now(),
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

  // Token exchange (authorization_code + refresh_token)
  app.post("/hubspot-emu/oauth/v1/token", async (c) => {
    const raw = await c.req.text();
    const params = new URLSearchParams(raw);
    const grantType = params.get("grant_type") ?? "";

    const issueToken = (
      payload: Omit<IssuedToken, "expiresAt">,
    ): {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    } => {
      const accessToken = `hat_${randomBytes(20).toString("hex")}`;
      const refreshToken = `hrt_${randomBytes(20).toString("hex")}`;
      const expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000;
      const tokens = getIssuedTokens(store);
      tokens.set(accessToken, { ...payload, expiresAt });
      tokens.set(refreshToken, { ...payload, expiresAt });
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        token_type: "bearer",
        scope: payload.scope,
      };
    };

    if (grantType === "authorization_code") {
      const code = params.get("code") ?? "";
      const pending = getPendingCodes(store).get(code);
      if (!pending || Date.now() - pending.createdAt > PENDING_CODE_TTL_MS) {
        return c.json({ status: "BAD_AUTH_CODE", message: "invalid_code" }, 400);
      }
      getPendingCodes(store).delete(code);
      return c.json(
        issueToken({
          hubId: pending.hubId,
          hubDomain: pending.hubDomain,
          userId: pending.userId,
          userEmail: pending.userEmail,
          scope: pending.scope,
        }),
      );
    }

    if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token") ?? "";
      const existing = getIssuedTokens(store).get(refreshToken);
      if (!existing) {
        return c.json({ status: "BAD_REFRESH_TOKEN", message: "invalid_refresh_token" }, 400);
      }
      return c.json(
        issueToken({
          hubId: existing.hubId,
          hubDomain: existing.hubDomain,
          userId: existing.userId,
          userEmail: existing.userEmail,
          scope: existing.scope,
        }),
      );
    }

    return c.json({ status: "BAD_GRANT_TYPE", message: grantType }, 400);
  });

  // Access token introspection
  app.get("/hubspot-emu/oauth/v1/access-tokens/:token", (c) => {
    const token = c.req.param("token");
    const issued = getIssuedTokens(store).get(token);
    if (!issued) {
      return c.json({ status: "BAD_AUTH_TOKEN", message: "token_not_found" }, 404);
    }
    return c.json({
      hub_id: issued.hubId,
      hub_domain: issued.hubDomain,
      user_id: issued.userId,
      user: issued.userEmail,
      scopes: issued.scope ? issued.scope.split(" ") : [],
      expires_in: Math.max(0, Math.floor((issued.expiresAt - Date.now()) / 1000)),
      token_type: "access",
      app_id: 1,
    });
  });
};
