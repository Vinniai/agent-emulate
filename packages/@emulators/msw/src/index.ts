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
  baseUrl: string;
}

export interface EmulateHandlersOptions {
  /**
   * Map of service name → provider plugin, e.g. `{ google: googlePlugin }`.
   * Each becomes an in-process emulator mounted under `${baseUrl}/<service>`.
   */
  services: Record<string, ServicePlugin>;
  /**
   * Origin (+ optional path) the SDKs are pointed at. Requests to
   * `${baseUrl}/<service>/*` are routed into the matching in-process app.
   * Default `http://localhost:4000` — the same base URL the standalone
   * `agent-emulate` server uses, so switching a test suite from the live
   * server to in-process MSW needs no other change.
   */
  baseUrl?: string;
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

/** Build a new Request at `app`-relative path, copying method/headers/body. */
async function relocate(request: Request, path: string, origin: string): Promise<Request> {
  const target = new URL(request.url);
  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers: request.headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Buffer the body so we don't need streaming half-duplex semantics.
    init.body = await request.arrayBuffer();
  }
  return new Request(new URL(path + target.search, origin).toString(), init);
}

/**
 * Turn a set of agent-emulate provider plugins into MSW request handlers that
 * run the emulators **in-process** — no server, no ports, no Service Worker
 * round-trip to a backend. Each request to `${baseUrl}/<service>/*` is rewritten
 * to the app-relative path and dispatched through the provider's Hono app,
 * reusing the exact same logic the standalone server runs.
 *
 * Pair this with MSW's `setupServer` (Node tests) or `setupWorker` (browser):
 *
 * ```ts
 * import { setupServer } from "msw/node";
 * import { emulateHandlers } from "@emulators/msw";
 * import { googlePlugin } from "@emulators/google";
 *
 * const { handlers, services } = emulateHandlers({ services: { google: googlePlugin } });
 * const server = setupServer(...handlers);
 * server.listen({ onUnhandledRequest: "bypass" });
 * ```
 *
 * Note: interactive OAuth *login screens* (full-page redirects) are not covered
 * here — there is no separate origin to navigate to in-process. Use the live
 * `agent-emulate` server for redirect-login UX; use this for token/API mocking.
 */
export function emulateHandlers(opts: EmulateHandlersOptions): EmulateMsw {
  const baseUrl = (opts.baseUrl ?? "http://localhost:4000").replace(/\/+$/, "");
  const origin = new URL(baseUrl).origin;
  const services = new Map<string, EmulateService>();
  const handlers: RequestHandler[] = [];

  for (const [name, plugin] of Object.entries(opts.services)) {
    const svcBase = `${baseUrl}/${name}`;
    const built = createServer(plugin, { ...opts.serverOptions, baseUrl: svcBase });
    if (opts.seed !== false) plugin.seed?.(built.store, svcBase);

    const service: EmulateService = {
      app: built.app,
      store: built.store,
      webhooks: built.webhooks,
      baseUrl: svcBase,
    };
    services.set(name, service);

    const prefix = `/${name}`;
    const dispatch = async ({ request }: { request: Request }): Promise<Response> => {
      const path = new URL(request.url).pathname;
      // Strip the `/<service>` prefix — provider routes are mounted at the app root.
      const appPath = path === prefix ? "/" : path.slice(prefix.length) || "/";
      return service.app.fetch(await relocate(request, appPath, origin));
    };

    // `/<service>/*` (sub-paths) and `/<service>` (the bare root) both route in.
    handlers.push(http.all(`${svcBase}/*`, dispatch));
    handlers.push(http.all(svcBase, dispatch));
  }

  return { handlers, services };
}

/** Re-export so consumers can build their own catch-all passthrough handler. */
export { passthrough };
