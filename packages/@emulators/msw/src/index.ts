import { http, passthrough, type RequestHandler } from "msw";
import {
  createServer,
  type ServicePlugin,
  type ServerOptions,
  type Store,
  type WebhookDispatcher,
} from "@emulators/core";

/** One built emulator: the in-process Hono app plus its backing store. */
export interface EmulateService {
  /** The Hono app — `app.fetch(request)` runs entirely in-process, no socket. */
  app: { fetch: (req: Request) => Response | Promise<Response> };
  store: Store;
  webhooks: WebhookDispatcher;
  /** The origin this service is mounted at — the URL SDKs are pointed at. */
  baseUrl: string;
}

export interface EmulateHandlersOptions {
  /**
   * Map of service name → provider plugin, e.g. `{ google: googlePlugin }`.
   * Each becomes an in-process emulator with **its own origin**, exactly like
   * `agent-emulate start`: the first service is mounted at the base port, the
   * next at base+1, and so on (google → 4000, stripe → 4001, …).
   */
  services: Record<string, ServicePlugin>;
  /**
   * Base port. Service N is mounted at `http://localhost:(port + N)`, mirroring
   * the per-service ports `agent-emulate start` hands out. Default `4000`.
   * Ignored for services covered by `portless` or `baseUrls`.
   */
  port?: number;
  /**
   * Portless mode: mount each service at `https://<name>.emulate.localhost`,
   * mirroring `agent-emulate start --portless`. SDKs point at the subdomain
   * instead of a port — no path prefixes, one origin per provider.
   */
  portless?: boolean;
  /**
   * Explicit per-service origin overrides, e.g.
   * `{ google: "http://localhost:9000" }`. Wins over `port` / `portless`.
   */
  baseUrls?: Record<string, string>;
  /** Per-service `createServer` options (tokens, fallbackUser, multiTenant…). */
  serverOptions?: Omit<ServerOptions, "baseUrl" | "port">;
  /** Run each plugin's built-in seed on startup. Default `true`. */
  seed?: boolean;
}

export interface EmulateMsw {
  /** Drop these into `setupServer(...)` (Node) or `setupWorker(...)` (browser). */
  handlers: RequestHandler[];
  /** The built emulators, keyed by service name — reach in to seed/inspect state. */
  services: Map<string, EmulateService>;
}

const DEFAULT_PORT = 4000;

/** The origin a service is mounted at — matches `agent-emulate start` resolution. */
function resolveServiceBaseUrl(name: string, index: number, opts: EmulateHandlersOptions): string {
  const override = opts.baseUrls?.[name];
  if (override) return override.replace(/\/+$/, "");
  // Mirrors `portlessBaseUrl()` in the CLI.
  if (opts.portless) return `https://${name}.emulate.localhost`;
  return `http://localhost:${(opts.port ?? DEFAULT_PORT) + index}`;
}

/**
 * Turn a set of agent-emulate provider plugins into MSW request handlers that
 * run the emulators **in-process** — no server, no ports, no Service Worker
 * round-trip to a backend. Each provider gets **its own origin** — its own port
 * (`http://localhost:4000`, `:4001`, …) or, with `portless`, its own subdomain
 * (`https://google.emulate.localhost`) — exactly the addressing `agent-emulate
 * start` uses. Point your SDKs at the same URL you'd use against the live
 * server; switching a suite from the server to in-process MSW needs no other
 * change. Requests to that origin are dispatched straight through the
 * provider's Hono app, reusing the exact logic the standalone server runs.
 *
 * Pair this with MSW's `setupServer` (Node tests) or `setupWorker` (browser):
 *
 * ```ts
 * import { setupServer } from "msw/node";
 * import { emulateHandlers } from "@emulators/msw";
 * import { googlePlugin } from "@emulators/google";
 * import { stripePlugin } from "@emulators/stripe";
 *
 * // google → http://localhost:4000, stripe → http://localhost:4001
 * const { handlers, services } = emulateHandlers({
 *   services: { google: googlePlugin, stripe: stripePlugin },
 * });
 * const server = setupServer(...handlers);
 * server.listen({ onUnhandledRequest: "bypass" });
 * ```
 *
 * Note: interactive OAuth *login screens* (full-page redirects) are not covered
 * here — there is no separate origin to navigate to in-process. Use the live
 * `agent-emulate` server for redirect-login UX; use this for token/API mocking.
 */
export function emulateHandlers(opts: EmulateHandlersOptions): EmulateMsw {
  const services = new Map<string, EmulateService>();
  const handlers: RequestHandler[] = [];

  Object.entries(opts.services).forEach(([name, plugin], index) => {
    const baseUrl = resolveServiceBaseUrl(name, index, opts);
    const built = createServer(plugin, { ...opts.serverOptions, baseUrl });
    if (opts.seed !== false) plugin.seed?.(built.store, baseUrl);

    const service: EmulateService = {
      app: built.app,
      store: built.store,
      webhooks: built.webhooks,
      baseUrl,
    };
    services.set(name, service);

    // The service owns its whole origin — request paths are already
    // app-relative, so we hand them straight to the Hono app, no rewriting.
    const dispatch = ({ request }: { request: Request }): Response | Promise<Response> => service.app.fetch(request);

    // Match the origin root (`${baseUrl}`) and everything under it.
    handlers.push(http.all(`${baseUrl}/*`, dispatch));
    handlers.push(http.all(baseUrl, dispatch));
  });

  return { handlers, services };
}

/** Re-export so consumers can build their own catch-all passthrough handler. */
export { passthrough };
