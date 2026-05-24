// RFC 7662 (OAuth 2.0 Token Introspection) response builder. Pure and
// dependency-free so the body shape is unit-tested; provider `/introspect`
// routes are a thin wrapper that parses the request and returns this.
//
// Non-Okta OIDC emulators (google/microsoft/apple) register issued tokens in
// the shared core `TokenMap` with `{ login, id, scopes, expiresAt }`. That is
// everything RFC 7662 §2.2 needs for the common fields; `client_id` is not
// tracked per-token in the shared map so it is intentionally omitted (it is an
// OPTIONAL member). An unknown or expired token yields `{ active: false }`,
// exactly as a real authorization server responds — driving the consumer's
// refresh path the same way the auth-middleware expiry check does.

import type { TokenMap } from "./middleware/auth.js";

export interface IntrospectionOptions {
  /** `iss` claim to echo (the provider's issuer URL). */
  issuer?: string;
  /** `aud` claim to echo. */
  audience?: string | string[];
  /** Override `token_type` (defaults to `Bearer`). */
  tokenType?: string;
}

export interface IntrospectionResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  /** Expiry as epoch *seconds* (RFC 7662 uses NumericDate, unlike our ms). */
  exp?: number;
}

/**
 * Build an RFC 7662 introspection response for `token` from the shared
 * `TokenMap`. `AuthUser.expiresAt` is epoch *milliseconds* (see auth.ts);
 * RFC 7662 `exp` is epoch *seconds*, so it is converted on the way out.
 */
export function buildIntrospectionResponse(
  tokenMap: TokenMap,
  token: string,
  opts: IntrospectionOptions = {},
): IntrospectionResponse {
  const entry = token ? tokenMap.get(token) : undefined;
  if (!entry) return { active: false };

  if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
    return { active: false };
  }

  const res: IntrospectionResponse = {
    active: true,
    token_type: opts.tokenType ?? "Bearer",
    scope: entry.scopes.join(" "),
    username: entry.login,
    sub: String(entry.id),
  };
  if (opts.issuer) res.iss = opts.issuer;
  if (opts.audience !== undefined) res.aud = opts.audience;
  if (entry.expiresAt !== undefined) res.exp = Math.floor(entry.expiresAt / 1000);
  return res;
}
