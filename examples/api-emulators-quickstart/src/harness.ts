// Tiny shared bootstrap so each provider demo stays a single readable file.
//
// Every emulator is just a `ServicePlugin` mounted by `@emulators/core`'s
// `createServer` onto a Hono app backed by an in-memory `Store` — exactly how
// `@emulators/server` runs them, but in-process so the demos need zero setup
// (`pnpm --filter api-emulators-quickstart github`). No ports, no Docker, no
// network: requests go straight through `app.request(...)`.
//
// `createServer` wires the same CORS + auth + rate-limit middleware the real
// server uses, so token-gated providers (GitHub, Vercel, Slack, Stripe, …)
// behave identically here. Pass `fallbackUser` so any bearer token resolves to
// that identity (the registry's `defaultFallback`), or `tokens` to register
// exact bearer tokens.
import { createServer } from "@emulators/core";
import type { ServicePlugin, Store, AuthFallback, WebhookDispatcher } from "@emulators/core";

export interface Emulator {
  app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> };
  store: Store;
  /** The plugin's webhook dispatcher — for seed-time webhook registration. */
  webhooks: WebhookDispatcher;
}

export interface MountOptions {
  /** Any non-empty bearer token resolves to this identity (registry defaultFallback). */
  fallbackUser?: AuthFallback;
  /** Register exact bearer tokens → identities. */
  tokens?: Record<string, { login: string; id: number; scopes?: string[] }>;
  /** Run the plugin's built-in `seed()` defaults after mounting. */
  seedDefaults?: boolean;
  /** Override the shared request bucket for high-volume contract simulations. */
  rateLimit?: { limit?: number; windowSec?: number };
}

export function mount(plugin: ServicePlugin, baseUrl: string, opts: MountOptions = {}): Emulator {
  const srv = createServer(plugin, {
    baseUrl,
    fallbackUser: opts.fallbackUser,
    tokens: opts.tokens,
    rateLimit: opts.rateLimit,
  });
  if (opts.seedDefaults) plugin.seed?.(srv.store, baseUrl);
  return { app: srv.app, store: srv.store, webhooks: srv.webhooks };
}

export function heading(title: string): void {
  console.log(`\n${"═".repeat(64)}\n${title}\n${"═".repeat(64)}`);
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/**
 * Issues a request against the in-process emulator, prints the result the way
 * you'd inspect it in a REST client, and returns the parsed JSON body (or the
 * raw text for non-JSON responses such as inspector HTML).
 */
export async function call(emu: Emulator, label: string, url: string, init?: RequestInit): Promise<unknown> {
  const res = await emu.app.request(url, init);
  const text = await res.text();
  const isJson = (res.headers.get("content-type") ?? "").includes("json");

  console.log(`\n▶ ${label}`);
  console.log(`  ${init?.method ?? "GET"} ${url}  →  ${res.status}`);

  let parsed: unknown = text;
  if (isJson && text) {
    parsed = JSON.parse(text);
    console.log(indent(JSON.stringify(parsed, null, 2)));
  } else if (text) {
    console.log(indent(text.length > 200 ? `${text.slice(0, 200)}… (${text.length} bytes)` : text));
  }
  return parsed;
}
