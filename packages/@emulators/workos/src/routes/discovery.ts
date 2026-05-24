import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import { getJWKS } from "../keys.js";

export function discoveryRoutes(app: Hono<AppEnv>, baseUrl: string): void {
  app.get("/sso/jwks/:clientId", async (c) => {
    return c.json(await getJWKS());
  });

  app.get("/.well-known/openid-configuration", (c) => {
    const base = baseUrl.replace(/\/$/, "");
    return c.json({
      issuer: `${base}/`,
      authorization_endpoint: `${base}/user_management/authorize`,
      token_endpoint: `${base}/user_management/authenticate/code`,
      jwks_uri: `${base}/sso/jwks/default`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  });
}
