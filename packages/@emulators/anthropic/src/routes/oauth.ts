import { createHash, randomBytes } from "crypto";
import type { Context } from "hono";
import type { RouteContext, Store } from "@emulators/core";
import {
  escapeHtml,
  renderCardPage,
  renderErrorPage,
  renderUserButton,
  matchesRedirectUri,
  constantTimeSecretEqual,
  bodyStr,
  debug,
} from "@emulators/core";
import { getAnthropicStore } from "../store.js";
import type { AnthropicUser } from "../entities.js";

type PendingCode = {
  email: string;
  scope: string;
  redirectUri: string;
  clientId: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  created_at: number;
};

const PENDING_CODE_TTL_MS = 10 * 60 * 1000;
const SERVICE_LABEL = "Anthropic";

function getPendingCodes(store: Store): Map<string, PendingCode> {
  let map = store.getData<Map<string, PendingCode>>("anthropic.oauth.pendingCodes");
  if (!map) {
    map = new Map();
    store.setData("anthropic.oauth.pendingCodes", map);
  }
  return map;
}

function isExpired(p: PendingCode): boolean {
  return Date.now() - p.created_at > PENDING_CODE_TTL_MS;
}

export function oauthRoutes({ app, store, tokenMap }: RouteContext): void {
  const as = getAnthropicStore(store);

  // ---------- Authorize page ----------
  app.get("/oauth/authorize", (c) => {
    const client_id = c.req.query("client_id") ?? "";
    const redirect_uri = c.req.query("redirect_uri") ?? "";
    const scope = c.req.query("scope") ?? "";
    const state = c.req.query("state") ?? "";
    const code_challenge = c.req.query("code_challenge") ?? "";
    const code_challenge_method = c.req.query("code_challenge_method") ?? "";

    const clientsConfigured = as.oauthClients.all().length > 0;
    let clientName = "";
    if (clientsConfigured) {
      const client = as.oauthClients.findOneBy("client_id", client_id);
      if (!client) {
        return c.html(
          renderErrorPage("Application not found", `The client_id '${client_id}' is not registered.`, SERVICE_LABEL),
          400,
        );
      }
      if (redirect_uri && !matchesRedirectUri(redirect_uri, client.redirect_uris)) {
        return c.html(
          renderErrorPage("Redirect URI mismatch", "The redirect_uri is not registered.", SERVICE_LABEL),
          400,
        );
      }
      clientName = client.name;
    }

    const subtitle = clientName
      ? `Authorize <strong>${escapeHtml(clientName)}</strong> to access your account.`
      : "Choose a seeded account to continue.";

    const users = as.users.all();
    const body =
      users.length === 0
        ? '<p class="empty">No users in the emulator store.</p>'
        : users
            .map((u) =>
              renderUserButton({
                letter: (u.email[0] ?? "?").toUpperCase(),
                login: u.email,
                name: u.name ?? undefined,
                email: u.email,
                formAction: "/oauth/authorize/callback",
                hiddenFields: {
                  email: u.email,
                  redirect_uri,
                  scope,
                  state,
                  client_id,
                  code_challenge,
                  code_challenge_method,
                },
              }),
            )
            .join("\n");

    return c.html(renderCardPage("Sign in to Claude", subtitle, body, SERVICE_LABEL));
  });

  // ---------- Authorize callback (issues code) ----------
  app.post("/oauth/authorize/callback", async (c) => {
    const body = await c.req.parseBody();
    const email = bodyStr(body.email);
    const redirect_uri = bodyStr(body.redirect_uri);
    const scope = bodyStr(body.scope);
    const state = bodyStr(body.state);
    const client_id = bodyStr(body.client_id);
    const code_challenge = bodyStr(body.code_challenge);
    const code_challenge_method = bodyStr(body.code_challenge_method);

    const code = randomBytes(20).toString("hex");
    getPendingCodes(store).set(code, {
      email,
      scope,
      redirectUri: redirect_uri,
      clientId: client_id,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      created_at: Date.now(),
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state !== "") url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

  // ---------- Token exchange ----------
  app.post("/v1/oauth/token", tokenExchange);
  app.post("/oauth/token", tokenExchange);

  async function tokenExchange(c: Context) {
    const contentType = c.req.header("Content-Type") ?? "";
    const rawText = await c.req.text();
    let body: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = {};
      }
    } else {
      body = Object.fromEntries(new URLSearchParams(rawText));
    }

    const grantType = typeof body.grant_type === "string" ? body.grant_type : "authorization_code";
    const bodyClientId = typeof body.client_id === "string" ? body.client_id : "";
    const bodyClientSecret = typeof body.client_secret === "string" ? body.client_secret : "";
    const pendingCodes = getPendingCodes(store);
    const clientsConfigured = as.oauthClients.all().length > 0;

    if (grantType === "refresh_token") {
      const token = "sk-ant-oat-" + randomBytes(24).toString("base64url");
      const user = as.users.all()[0];
      if (user && tokenMap) tokenMap.set(token, { login: user.email, id: user.id, scopes: [] });
      return c.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "sk-ant-ort-" + randomBytes(24).toString("base64url"),
      });
    }

    const code = typeof body.code === "string" ? body.code : "";
    const redirect_uri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
    const code_verifier = typeof body.code_verifier === "string" ? body.code_verifier : undefined;

    if (clientsConfigured) {
      const client = as.oauthClients.findOneBy("client_id", bodyClientId);
      if (!client) {
        return c.json({ error: "invalid_client", error_description: "Unknown client_id." }, 401);
      }
      if (bodyClientSecret && !constantTimeSecretEqual(bodyClientSecret, client.client_secret)) {
        return c.json({ error: "invalid_client", error_description: "Invalid client_secret." }, 401);
      }
    }

    const pending = pendingCodes.get(code);
    if (!pending || isExpired(pending)) {
      if (pending) pendingCodes.delete(code);
      return c.json({ error: "invalid_grant", error_description: "The code is incorrect or expired." }, 400);
    }
    if (redirect_uri && pending.redirectUri && redirect_uri !== pending.redirectUri) {
      pendingCodes.delete(code);
      return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch." }, 400);
    }

    if (pending.codeChallenge != null) {
      if (code_verifier === undefined) {
        return c.json({ error: "invalid_grant", error_description: "PKCE verification failed." }, 400);
      }
      const method = (pending.codeChallengeMethod ?? "plain").toLowerCase();
      const ok =
        method === "s256"
          ? createHash("sha256").update(code_verifier).digest("base64url") === pending.codeChallenge
          : code_verifier === pending.codeChallenge;
      if (!ok) {
        return c.json({ error: "invalid_grant", error_description: "PKCE verification failed." }, 400);
      }
    }

    pendingCodes.delete(code);

    const user = as.users.findOneBy("email", pending.email as AnthropicUser["email"]);
    if (!user) {
      return c.json({ error: "invalid_grant", error_description: "User not found." }, 400);
    }

    const token = "sk-ant-oat-" + randomBytes(24).toString("base64url");
    const scopes = pending.scope ? pending.scope.split(/[,\s]+/).filter(Boolean) : [];
    if (tokenMap) tokenMap.set(token, { login: user.email, id: user.id, scopes });

    debug("anthropic.oauth", `issued token for ${user.email}`);
    return c.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "sk-ant-ort-" + randomBytes(24).toString("base64url"),
      scope: pending.scope || "",
    });
  }

  // ---------- Userinfo ----------
  app.get("/oauth/userinfo", (c) => {
    const authUser = c.get("authUser");
    if (!authUser)
      return c.json({ type: "error", error: { type: "authentication_error", message: "unauthorized" } }, 401);
    const user = as.users.findOneBy("email", authUser.login as AnthropicUser["email"]);
    if (!user) return c.json({ type: "error", error: { type: "authentication_error", message: "unauthorized" } }, 401);
    return c.json({
      sub: user.user_id,
      email: user.email,
      name: user.name,
      email_verified: true,
      organization_id: user.org_id,
    });
  });
}
