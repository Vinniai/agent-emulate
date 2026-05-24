import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Hono } from "hono";
import { directHubspotRoutes } from "./routes/direct-hubspot.js";
import { directHubspotCrmRoutes } from "./routes/direct-hubspot-crm.js";

// Standalone direct-to-source hubspot emulator. The route logic is the same
// native surface the nango package exposes under "/hubspot-emu", but here it
// is served at the package root — clients hit the provider's real paths with
// no Nango envelope. Nango is left entirely untouched (this is a copy).

export const hubspotPlugin: ServicePlugin = {
  name: "hubspot",
  register(
    app: Hono<AppEnv>,
    store: Store,
    _webhooks: WebhookDispatcher,
    _baseUrl: string,
    _tokenMap?: TokenMap,
  ): void {
    directHubspotRoutes(app, store);
    directHubspotCrmRoutes(app, store);
  },
  seed(_store: Store, _baseUrl: string): void {
    // Native state is created on demand by writes; no default fixtures.
  },
};

export default hubspotPlugin;
