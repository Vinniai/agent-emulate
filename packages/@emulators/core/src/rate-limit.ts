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
//
// The `limit`/`windowSec` defaults below are realistic but deliberately
// overridable (`createServer({ rateLimit })`) so tests can force-trip any
// provider. What must stay faithful is the *exhaustion shape* — status code,
// JSON envelope, and header family — because that is what each vendor's SDK
// inspects to decide it has been throttled and how long to wait.

export interface RateLimitProfile {
  /** Provider key this profile was resolved for. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Status when the window is exhausted (GitHub/Salesforce use 403; most use 429). */
  exceededStatus: 403 | 429;
  /** Emit GitHub-style `X-RateLimit-*` headers (only GitHub really does). */
  rateLimitHeaders: boolean;
  /**
   * Provider-specific steady-state headers (e.g. Discord/Intercom `X-RateLimit-*`,
   * HubSpot `X-HubSpot-RateLimit-*`). Emitted on every response like GitHub's.
   * Pure — depends only on the profile + current counter state.
   */
  extraHeaders?: (state: RateLimitState, profile: RateLimitProfile, now: number) => Record<string, string>;
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

// Google APIs (Gmail / Drive / Calendar): 429 with the Google JSON error
// envelope; SDK reads `error.errors[].reason === "rateLimitExceeded"` /
// `"userRateLimitExceeded"` and `error.status === "RESOURCE_EXHAUSTED"`.
// Per-user default ~ generous; tests override.
const GOOGLE: Omit<RateLimitProfile, "name"> = {
  limit: 1200,
  windowSec: 60,
  exceededStatus: 429,
  rateLimitHeaders: false,
  body: () => ({
    error: {
      code: 429,
      message: "Rate Limit Exceeded",
      errors: [{ message: "Rate Limit Exceeded", domain: "usageLimits", reason: "rateLimitExceeded" }],
      status: "RESOURCE_EXHAUSTED",
    },
  }),
};

// Microsoft Graph: 429 with `Retry-After`; SDK reads
// `error.code === "TooManyRequests"`. Mailbox limit ~10k/10min per app+mailbox.
const MICROSOFT: Omit<RateLimitProfile, "name"> = {
  limit: 10000,
  windowSec: 600,
  exceededStatus: 429,
  rateLimitHeaders: false,
  body: () => ({
    error: {
      code: "TooManyRequests",
      message: "Too many requests. Please retry after the time specified in the Retry-After header.",
      innerError: { code: "TooManyRequests", date: new Date().toISOString() },
    },
  }),
};

// Salesforce: REST returns HTTP 403 with an array body and
// `errorCode: "REQUEST_LIMIT_EXCEEDED"` once the org API allocation is spent.
const SALESFORCE: Omit<RateLimitProfile, "name"> = {
  limit: 1000,
  windowSec: 60,
  exceededStatus: 403,
  rateLimitHeaders: false,
  body: () => [{ message: "TotalRequests Limit exceeded.", errorCode: "REQUEST_LIMIT_EXCEEDED" }],
};

// HubSpot: 429 with `X-HubSpot-RateLimit-*` headers; SDK reads
// `errorType: "RATE_LIMIT"` / `category: "RATE_LIMITS"`. Burst ~100/10s.
const HUBSPOT: Omit<RateLimitProfile, "name"> = {
  limit: 100,
  windowSec: 10,
  exceededStatus: 429,
  rateLimitHeaders: false,
  extraHeaders: (state, profile) => ({
    "X-HubSpot-RateLimit-Max": String(profile.limit),
    "X-HubSpot-RateLimit-Remaining": String(state.remaining),
    "X-HubSpot-RateLimit-Interval-Milliseconds": String(profile.windowSec * 1000),
  }),
  body: () => ({
    status: "error",
    message: "You have reached your secondly limit.",
    errorType: "RATE_LIMIT",
    category: "RATE_LIMITS",
  }),
};

// Zendesk: 429 with `Retry-After`; SDK reads `error: "TooManyRequests"`.
const ZENDESK: Omit<RateLimitProfile, "name"> = {
  limit: 700,
  windowSec: 60,
  exceededStatus: 429,
  rateLimitHeaders: false,
  body: () => ({ error: "TooManyRequests", description: "Number of allowed requests per minute exceeded." }),
};

// Intercom: 429 with `X-RateLimit-*` headers; SDK reads the error.list envelope
// with `code: "rate_limit_exceeded"`. Default ~1000 ops/min.
const INTERCOM: Omit<RateLimitProfile, "name"> = {
  limit: 1000,
  windowSec: 60,
  exceededStatus: 429,
  rateLimitHeaders: false,
  extraHeaders: (state, profile) => ({
    "X-RateLimit-Limit": String(profile.limit),
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(state.resetAt),
  }),
  body: () => ({
    type: "error.list",
    errors: [{ code: "rate_limit_exceeded", message: "The rate limit for this resource has been exceeded." }],
  }),
};

// Discord: the canonical 429 — body carries `retry_after` (seconds) and
// `global`; `X-RateLimit-*` headers describe the bucket. Per-route ~5/s.
const DISCORD: Omit<RateLimitProfile, "name"> = {
  limit: 50,
  windowSec: 1,
  exceededStatus: 429,
  rateLimitHeaders: false,
  extraHeaders: (state, profile, now) => ({
    "X-RateLimit-Limit": String(profile.limit),
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(state.resetAt),
    "X-RateLimit-Reset-After": String(Math.max(0, state.resetAt - now)),
  }),
  body: (retry) => ({
    message: "You are being rate limited.",
    retry_after: retry,
    global: false,
    code: 0,
  }),
};

// Pipedrive: 429 with `Retry-After` + `x-ratelimit-*`; token-budget per 2s.
const PIPEDRIVE: Omit<RateLimitProfile, "name"> = {
  limit: 80,
  windowSec: 2,
  exceededStatus: 429,
  rateLimitHeaders: false,
  extraHeaders: (state, profile) => ({
    "x-ratelimit-limit": String(profile.limit),
    "x-ratelimit-remaining": String(state.remaining),
  }),
  body: () => ({
    success: false,
    error: "rate limit exceeded",
    error_info: "Please refer to https://developers.pipedrive.com/docs/api/v1/#rate-limiting",
  }),
};

// Resend: 429 with `Retry-After` + `ratelimit-*`; default 2 requests/second.
const RESEND: Omit<RateLimitProfile, "name"> = {
  limit: 2,
  windowSec: 1,
  exceededStatus: 429,
  rateLimitHeaders: false,
  extraHeaders: (state, profile) => ({
    "ratelimit-limit": String(profile.limit),
    "ratelimit-remaining": String(state.remaining),
  }),
  body: () => ({
    statusCode: 429,
    name: "rate_limit_exceeded",
    message: "Too many requests. You have reached your rate limit.",
  }),
};

const PROFILES: Record<string, Omit<RateLimitProfile, "name">> = {
  github: GITHUB,
  stripe: STRIPE,
  slack: SLACK,
  google: GOOGLE,
  microsoft: MICROSOFT,
  salesforce: SALESFORCE,
  hubspot: HUBSPOT,
  zendesk: ZENDESK,
  intercom: INTERCOM,
  discord: DISCORD,
  pipedrive: PIPEDRIVE,
  resend: RESEND,
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
 * `X-RateLimit-*` only when the profile opts in; any provider-specific
 * `extraHeaders` (HubSpot/Discord/Intercom/…); `Retry-After` (whole seconds,
 * floored at 0) once the window is exhausted, for all profiles.
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
  if (profile.extraHeaders) {
    Object.assign(headers, profile.extraHeaders(state, profile, now));
  }
  if (state.remaining <= 0) {
    headers["Retry-After"] = String(Math.max(0, state.resetAt - now));
  }
  return headers;
}
