import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Hono } from "hono";
import { directSalesforceRoutes } from "./routes/direct-salesforce.js";

// Standalone direct-to-source salesforce emulator. The route logic is the same
// native surface the nango package exposes under "/salesforce-emu", but here it
// is served at the package root — clients hit the provider's real paths with
// no Nango envelope. Nango is left entirely untouched (this is a copy).

export const salesforcePlugin: ServicePlugin = {
  name: "salesforce",
  register(
    app: Hono<AppEnv>,
    store: Store,
    _webhooks: WebhookDispatcher,
    _baseUrl: string,
    _tokenMap?: TokenMap,
  ): void {
    directSalesforceRoutes(app, store);
  },
  seed(_store: Store, _baseUrl: string): void {
    // Native state is created on demand by writes; no default fixtures.
  },
};

export default salesforcePlugin;
