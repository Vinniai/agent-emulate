// Per-provider rate-limit shapes. The server keeps a single token-bucket
// counter; this module owns *how that limit looks on the wire* so a real
// vendor SDK's retry/backoff logic strict-parses the emulator. Pure and
// dependency-free so the shapes are unit-tested (the server wiring is thin).
//
// Default is GitHub-shaped (historical behaviour: 5000/h, 403, X-RateLimit-*
// headers, `{ message, documentation_url }`) so existing consumers are
// unaffected. A `Retry-After` header is now emitted on every exhausted
// response regardless of profile (RFC 6585 / RFC 7231 §7.1.3) — vendor SDKs
// universally honour it for backoff.

export interface RateLimitProfile {
  /** Provider key this profile was resolved for. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Status when the window is exhausted (GitHub still uses 403; most use 429). */
  exceededStatus: 403 | 429;
  /** Emit GitHub-style `X-RateLimit-*` headers (only GitHub really does). */
  rateLimitHeaders: boolean;
  /** Build the exhaustion response body for this provider's SDK. */
  body(retryAfterSec: number, docsUrl: string): unknown;
}

const GITHUB: Omit<RateLimitProfile, "name"> = {
  limit: 5000,
  windowSec: 3600,
  exceededStatus: 403,
  rateLimitHeaders: true,
  body: (_retry, docsUrl) => ({ message: "API rate limit exceeded", documentation_url: docsUrl }),
};

// Stripe: 429 with `Retry-After`, no `X-RateLimit-*`; SDK reads
// `error.type === "rate_limit_error"`.
const STRIPE: Omit<RateLimitProfile, "name"> = {
  limit: 100,
  windowSec: 1,
  exceededStatus: 429,
  rateLimitHeaders: false,
  body: () => ({
    error: {
      type: "rate_limit_error",
      code: "rate_limit",
      message: "Too many requests hit the API too quickly. We recommend an exponential backoff of your requests.",
    },
  }),
};

// Slack: 429 with `Retry-After`; SDK reads `{ ok: false, error: "ratelimited" }`.
const SLACK: Omit<RateLimitProfile, "name"> = {
  limit: 100,
  windowSec: 60,
  exceededStatus: 429,
  rateLimitHeaders: false,
  body: () => ({ ok: false, error: "ratelimited" }),
};

const PROFILES: Record<string, Omit<RateLimitProfile, "name">> = {
  github: GITHUB,
  stripe: STRIPE,
  slack: SLACK,
};

/**
 * Resolve a provider name to its rate-limit profile. Unknown providers fall
 * back to the GitHub shape (unchanged historical behaviour).
 */
export function rateLimitProfile(name: string): RateLimitProfile {
  const base = PROFILES[name.toLowerCase()] ?? GITHUB;
  return { name, ...base };
}

export interface RateLimitState {
  remaining: number;
  resetAt: number;
}

/**
 * Headers to set on *every* response under this profile. GitHub-style
 * `X-RateLimit-*` only when the profile opts in; `Retry-After` (whole seconds,
 * floored at 0) is added once the window is exhausted, for all profiles.
 */
export function rateLimitHeaders(
  profile: RateLimitProfile,
  state: RateLimitState,
  now: number,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (profile.rateLimitHeaders) {
    headers["X-RateLimit-Limit"] = String(profile.limit);
    headers["X-RateLimit-Remaining"] = String(state.remaining);
    headers["X-RateLimit-Reset"] = String(state.resetAt);
    headers["X-RateLimit-Resource"] = "core";
  }
  if (state.remaining <= 0) {
    headers["Retry-After"] = String(Math.max(0, state.resetAt - now));
  }
  return headers;
}
