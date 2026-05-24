import type { AppEnv } from "@emulators/core";
import { renderCardPage, renderErrorPage, renderUserButton } from "@emulators/core";
import type { Hono } from "hono";
import { getJWKS, signJWT } from "../keys.js";
import type { WorkOSStoreFacade } from "../store.js";
import { randomHex } from "../helpers.js";

const SERVICE_LABEL = "WorkOS";

function buildUserObject(user: {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  email_verified: boolean;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    email_verified: user.email_verified,
    profile_picture_url: user.profile_picture_url,
    created_at: user.created_at,
    updated_at: user.updated_at,
    object: "user",
  };
}

async function verifyPKCE(codeVerifier: string, codeChallenge: string, method?: string): Promise<boolean> {
  if (method === "S256") {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
    const computed = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return computed === codeChallenge;
  }
  return codeVerifier === codeChallenge;
}

async function handleCodeExchange(
  ws: WorkOSStoreFacade,
  baseUrl: string,
  body: { client_id: string; code: string; code_verifier?: string },
) {
  const authCode = ws.consumeAuthCode(body.code);
  if (!authCode) {
    return { error: "invalid_grant", error_description: "Invalid or expired code", status: 400 } as const;
  }
  if (authCode.code_challenge && body.code_verifier) {
    const valid = await verifyPKCE(body.code_verifier, authCode.code_challenge, authCode.code_challenge_method);
    if (!valid) {
      return { error: "invalid_grant", error_description: "PKCE verification failed", status: 400 } as const;
    }
  }
  const user = ws.getUser(authCode.user_id);
  if (!user) return { error: "user_not_found", status: 404 } as const;

  const session = ws.createSession(user.id, authCode.organization_id);
  const accessToken = await signJWT(
    { sub: user.id, sid: session.id, org_id: authCode.organization_id, email: user.email },
    { issuer: `${baseUrl}/user_management/${body.client_id}` },
  );
  const refreshToken = ws.createRefreshToken(user.id, session.id, authCode.organization_id);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: buildUserObject(user),
    organization_id: authCode.organization_id ?? null,
  };
}

export function oauthRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade, baseUrl: string): void {
  // User picker / authorize
  app.get("/user_management/authorize", (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const state = c.req.query("state") ?? "";
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method");

    const users = ws.allUsers();
    if (users.length === 0) {
      return c.html(
        renderErrorPage(
          "No users seeded",
          "Add users to the workos section of emulate.config.yaml to emulate sign-in.",
          SERVICE_LABEL,
        ),
        400,
      );
    }

    // Single user — auto-redirect, unless the caller forces the account picker
    // (e.g. prompt=select_account, used by the previewer to show the themed card).
    const forcePicker = c.req.query("prompt") === "select_account";
    if (users.length === 1 && !forcePicker) {
      const user = users[0];
      const memberships = ws.getUserMemberships(user.id);
      const orgId = memberships[0]?.organization_id;
      const code = ws.createAuthCode(clientId, user.id, redirectUri, {
        organizationId: orgId,
        codeChallenge,
        codeChallengeMethod,
      });
      const url = new URL(redirectUri);
      url.searchParams.set("code", code);
      if (state) url.searchParams.set("state", state);
      return c.redirect(url.toString());
    }

    // Multiple users — render themed picker
    const buttons = users
      .map((u) => {
        const memberships = ws.getUserMemberships(u.id);
        const orgNames = memberships.map((m) => ws.getOrg(m.organization_id)?.name ?? m.organization_id).join(", ");
        const fullName = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
        return renderUserButton({
          letter: (u.email[0] ?? "?").toUpperCase(),
          login: u.email,
          name: orgNames ? `${fullName ? fullName + " · " : ""}${orgNames}` : fullName || undefined,
          formAction: "/user_management/authorize/callback",
          hiddenFields: {
            user_id: u.id,
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge ?? "",
            code_challenge_method: codeChallengeMethod ?? "",
          },
        });
      })
      .join("\n");

    return c.html(renderCardPage("Sign in with WorkOS", "Select a test user to continue.", buttons, SERVICE_LABEL));
  });

  // Callback from user picker form
  app.post("/user_management/authorize/callback", async (c) => {
    const body = await c.req.parseBody();
    const userId = body.user_id as string;
    const clientId = body.client_id as string;
    const redirectUri = body.redirect_uri as string;
    const state = body.state as string;
    const codeChallenge = (body.code_challenge as string) || undefined;
    const codeChallengeMethod = (body.code_challenge_method as string) || undefined;

    const user = ws.getUser(userId);
    if (!user) return c.json({ error: "User not found" }, 404);

    const memberships = ws.getUserMemberships(user.id);
    const orgId = memberships[0]?.organization_id;
    const code = ws.createAuthCode(clientId, user.id, redirectUri, {
      organizationId: orgId,
      codeChallenge,
      codeChallengeMethod,
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString());
  });

  // Unified authenticate (WorkOS SDK v4+)
  app.post("/user_management/authenticate", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    const grantType = body.grant_type ?? "authorization_code";

    if (grantType === "authorization_code") {
      const result = await handleCodeExchange(ws, baseUrl, {
        client_id: body.client_id,
        code: body.code,
        code_verifier: body.code_verifier,
      });
      if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404);
      return c.json(result);
    }

    if (grantType === "refresh_token") {
      const tokenValue = body.refresh_token ?? body.refreshToken;
      const entry = ws.consumeRefreshToken(tokenValue);
      if (!entry) return c.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, 401);
      const user = ws.getUser(entry.user_id);
      if (!user) return c.json({ error: "user_not_found" }, 404);
      const accessToken = await signJWT(
        { sub: user.id, sid: entry.session_id, org_id: entry.organization_id, email: user.email },
        { issuer: `${baseUrl}/user_management/${body.client_id}` },
      );
      const newRefreshToken = ws.createRefreshToken(user.id, entry.session_id, entry.organization_id);
      return c.json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
        user: buildUserObject(user),
        organization_id: entry.organization_id ?? null,
      });
    }

    if (grantType === "urn:workos:oauth:grant-type:organization-selection") {
      const pendingToken = body.pending_authentication_token ?? body.pendingAuthenticationToken;
      const orgId = body.organization_id ?? body.organizationId;
      if (!pendingToken)
        return c.json({ error: "invalid_grant", error_description: "Missing pending_authentication_token" }, 400);
      if (!orgId) return c.json({ error: "invalid_grant", error_description: "Missing organization_id" }, 400);

      const pending = ws.consumePendingAuthToken(pendingToken);
      if (!pending)
        return c.json({ error: "invalid_grant", error_description: "Invalid or expired pending token" }, 400);

      const user = ws.getUser(pending.user_id);
      if (!user) return c.json({ error: "user_not_found" }, 404);

      const session = ws.createSession(user.id, orgId);
      const accessToken = await signJWT(
        { sub: user.id, sid: session.id, org_id: orgId, email: user.email },
        { issuer: `${baseUrl}/user_management/${body.client_id}` },
      );
      const newRefreshToken = ws.createRefreshToken(user.id, session.id, orgId);
      return c.json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
        user: buildUserObject(user),
        organization_id: orgId,
      });
    }

    if (grantType === "password") {
      const user = ws.findUserByEmail(body.username ?? body.email);
      if (!user) return c.json({ error: "invalid_credentials", error_description: "User not found" }, 401);
      const password = body.password;
      if (user.password && user.password !== password) {
        return c.json({ error: "invalid_credentials", error_description: "Incorrect password" }, 401);
      }

      const memberships = ws.getUserMemberships(user.id);
      if (memberships.length > 1) {
        const pendingToken = `pat_${randomHex(16)}`;
        ws.setPendingAuthToken(pendingToken, {
          code: pendingToken,
          client_id: body.client_id,
          user_id: user.id,
          redirect_uri: "",
          expires_at: Date.now() + 10 * 60 * 1000,
        });
        return c.json(
          {
            code: "organization_selection_required",
            message: "User belongs to multiple organizations",
            pending_authentication_token: pendingToken,
            user: { id: user.id, email: user.email },
          },
          400,
        );
      }

      const orgId = memberships[0]?.organization_id;
      const session = ws.createSession(user.id, orgId);
      const accessToken = await signJWT(
        { sub: user.id, sid: session.id, org_id: orgId, email: user.email },
        { issuer: `${baseUrl}/user_management/${body.client_id}` },
      );
      const newRefreshToken = ws.createRefreshToken(user.id, session.id, orgId);
      return c.json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
        user: buildUserObject(user),
        organization_id: orgId ?? null,
      });
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  // Code exchange
  app.post("/user_management/authenticate/code", async (c) => {
    const body = await c.req.json<{ client_id: string; code: string; code_verifier?: string }>();
    const result = await handleCodeExchange(ws, baseUrl, body);
    if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 404);
    return c.json(result);
  });

  // Password authentication
  app.post("/user_management/authenticate/password", async (c) => {
    const body = await c.req.json<{ client_id: string; email: string; password: string }>();
    const user = ws.findUserByEmail(body.email);
    if (!user) return c.json({ error: "invalid_credentials", error_description: "User not found" }, 401);
    if (user.password && user.password !== body.password) {
      return c.json({ error: "invalid_credentials", error_description: "Incorrect password" }, 401);
    }

    const memberships = ws.getUserMemberships(user.id);
    if (memberships.length > 1) {
      const pendingToken = `pat_${randomHex(16)}`;
      ws.setPendingAuthToken(pendingToken, {
        code: pendingToken,
        client_id: body.client_id,
        user_id: user.id,
        redirect_uri: "",
        expires_at: Date.now() + 10 * 60 * 1000,
      });
      return c.json(
        {
          code: "organization_selection_required",
          message: "User belongs to multiple organizations",
          pending_authentication_token: pendingToken,
          user: { id: user.id, email: user.email },
        },
        400,
      );
    }

    const orgId = memberships[0]?.organization_id;
    const session = ws.createSession(user.id, orgId);
    const accessToken = await signJWT(
      { sub: user.id, sid: session.id, org_id: orgId, email: user.email },
      { issuer: `${baseUrl}/user_management/${body.client_id}` },
    );
    const refreshToken = ws.createRefreshToken(user.id, session.id, orgId);
    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: buildUserObject(user),
      organization_id: orgId ?? null,
    });
  });

  // Organization selection
  app.post("/user_management/authenticate/organization_selection", async (c) => {
    const body = await c.req.json<{
      client_id: string;
      pending_authentication_token: string;
      organization_id: string;
    }>();
    const pending = ws.consumePendingAuthToken(body.pending_authentication_token);
    if (!pending) {
      return c.json({ error: "invalid_grant", error_description: "Invalid or expired pending token" }, 400);
    }
    const user = ws.getUser(pending.user_id);
    if (!user) return c.json({ error: "user_not_found" }, 404);

    const session = ws.createSession(user.id, body.organization_id);
    const accessToken = await signJWT(
      { sub: user.id, sid: session.id, org_id: body.organization_id, email: user.email },
      { issuer: `${baseUrl}/user_management/${body.client_id}` },
    );
    const refreshToken = ws.createRefreshToken(user.id, session.id, body.organization_id);
    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: buildUserObject(user),
      organization_id: body.organization_id,
    });
  });

  // Refresh token
  app.post("/user_management/authenticate/refresh", async (c) => {
    const body = await c.req.json<{ client_id: string; refresh_token?: string; refreshToken?: string }>();
    const tokenValue = body.refresh_token ?? body.refreshToken;
    if (!tokenValue) return c.json({ error: "invalid_grant" }, 400);

    const entry = ws.consumeRefreshToken(tokenValue);
    if (!entry) return c.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, 401);
    const user = ws.getUser(entry.user_id);
    if (!user) return c.json({ error: "user_not_found" }, 404);

    const accessToken = await signJWT(
      { sub: user.id, sid: entry.session_id, org_id: entry.organization_id, email: user.email },
      { issuer: `${baseUrl}/user_management/${body.client_id}` },
    );
    const newRefreshToken = ws.createRefreshToken(user.id, entry.session_id, entry.organization_id);
    return c.json({ access_token: accessToken, refresh_token: newRefreshToken });
  });
}
