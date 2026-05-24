import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Hono } from "hono";
import { webhookRoutes } from "./webhooks.js";
import { directQuickbooksRoutes } from "./routes/direct-quickbooks.js";

// Standalone direct-to-source quickbooks emulator. The route logic is the same
// native surface the nango package exposes under "/quickbooks-emu", but here it
// is served at the package root — clients hit the provider's real paths with
// no Nango envelope. Nango is left entirely untouched (this is a copy).

export const quickbooksPlugin: ServicePlugin = {
  name: "quickbooks",
  register(
    app: Hono<AppEnv>,
    store: Store,
    _webhooks: WebhookDispatcher,
    _baseUrl: string,
    _tokenMap?: TokenMap,
  ): void {
    webhookRoutes(app, store);
    directQuickbooksRoutes(app, store);
  },
  seed(_store: Store, _baseUrl: string): void {
    // Native state is created on demand by writes; no default fixtures.
  },
};

export default quickbooksPlugin;
