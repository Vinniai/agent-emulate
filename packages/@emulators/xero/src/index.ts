import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Hono } from "hono";
import { webhookRoutes } from "./webhooks.js";
import { directXeroRoutes } from "./routes/direct-xero.js";

// Standalone direct-to-source xero emulator. The route logic is the same
// native surface the nango package exposes under "/xero-emu", but here it
// is served at the package root — clients hit the provider's real paths with
// no Nango envelope. Nango is left entirely untouched (this is a copy).

export const xeroPlugin: ServicePlugin = {
  name: "xero",
  register(
    app: Hono<AppEnv>,
    store: Store,
    _webhooks: WebhookDispatcher,
    _baseUrl: string,
    _tokenMap?: TokenMap,
  ): void {
    webhookRoutes(app, store);
    directXeroRoutes(app, store);
  },
  seed(_store: Store, _baseUrl: string): void {
    // Native state is created on demand by writes; no default fixtures.
  },
};

export default xeroPlugin;
