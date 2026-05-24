import type { Hono } from "hono";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getMicrosoftStore } from "./store.js";
import { generateOid, DEFAULT_TENANT_ID } from "./helpers.js";
import { oauthRoutes } from "./routes/oauth.js";
import {
  graphRoutes,
  seedGraphDefaults,
  seedGraphFromConfig,
  storeToGraphSeedConfig,
  type MicrosoftGraphSeedConfig,
} from "./routes/graph.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getMicrosoftStore, type MicrosoftStore } from "./store.js";
export * from "./entities.js";
export type { MicrosoftGraphSeedConfig } from "./routes/graph.js";

export interface MicrosoftSeedConfig {
  users?: Array<{
    email: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    tenant_id?: string;
  }>;
  oauth_clients?: Array<{
    client_id: string;
    client_secret: string;
    name: string;
    redirect_uris: string[];
    tenant_id?: string;
  }>;
  /** Seed Outlook mail, Calendar, OneDrive, and Teams data from config instead of hardcoded defaults. */
  mail_messages?: MicrosoftGraphSeedConfig["mail_messages"];
  calendars?: MicrosoftGraphSeedConfig["calendars"];
  calendar_events?: MicrosoftGraphSeedConfig["calendar_events"];
  drive_items?: MicrosoftGraphSeedConfig["drive_items"];
  teams?: MicrosoftGraphSeedConfig["teams"];
  contacts?: MicrosoftGraphSeedConfig["contacts"];
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const ms = getMicrosoftStore(store);

  ms.users.insert({
    oid: generateOid(),
    email: "testuser@agent-emulate.dev",
    name: "Test User",
    given_name: "Test",
    family_name: "User",
    email_verified: true,
    tenant_id: DEFAULT_TENANT_ID,
    preferred_username: "testuser@agent-emulate.dev",
  });
}

export function seedFromConfig(store: Store, _baseUrl: string, config: MicrosoftSeedConfig): void {
  const ms = getMicrosoftStore(store);

  if (config.users) {
    for (const u of config.users) {
      const existing = ms.users.findOneBy("email", u.email);
      if (existing) continue;

      const nameParts = (u.name ?? "").split(/\s+/);
      ms.users.insert({
        oid: generateOid(),
        email: u.email,
        name: u.name ?? u.email.split("@")[0],
        given_name: u.given_name ?? nameParts[0] ?? "",
        family_name: u.family_name ?? nameParts.slice(1).join(" ") ?? "",
        email_verified: true,
        tenant_id: u.tenant_id ?? DEFAULT_TENANT_ID,
        preferred_username: u.email,
      });
    }
  }

  if (config.oauth_clients) {
    for (const client of config.oauth_clients) {
      const existing = ms.oauthClients.findOneBy("client_id", client.client_id);
      if (existing) continue;
      ms.oauthClients.insert({
        client_id: client.client_id,
        client_secret: client.client_secret,
        name: client.name,
        redirect_uris: client.redirect_uris,
        tenant_id: client.tenant_id ?? DEFAULT_TENANT_ID,
      });
    }
  }

  // If any Graph data is provided in config, seed it (overwrites hardcoded defaults).
  const hasGraphConfig =
    config.mail_messages ||
    config.calendars ||
    config.calendar_events ||
    config.drive_items ||
    config.teams ||
    config.contacts;

  if (hasGraphConfig) {
    seedGraphFromConfig(store, _baseUrl, {
      mail_messages: config.mail_messages,
      calendars: config.calendars,
      calendar_events: config.calendar_events,
      drive_items: config.drive_items,
      teams: config.teams,
      contacts: config.contacts,
    });
  }
}

/**
 * Project live Microsoft state back into the `MicrosoftSeedConfig` shape so
 * the export round-trips through `seedFromConfig` verbatim. Identity (users,
 * oauth_clients) is read from the entity store; Graph data (mail, calendar,
 * drive, teams, contacts) is reversed by `storeToGraphSeedConfig`. `tenant_id`
 * is omitted when it equals the default tenant, matching the compact
 * seed-file style (`seedFromConfig` re-defaults it). `client_secret` is
 * retained — it is static config needed to replay the OAuth flow.
 */
export function storeToSeedConfig(store: Store, _baseUrl: string): MicrosoftSeedConfig {
  const ms = getMicrosoftStore(store);
  const out: MicrosoftSeedConfig = {};

  const tenant = (id: string): { tenant_id?: string } => (id === DEFAULT_TENANT_ID ? {} : { tenant_id: id });

  const users = ms.users.all();
  if (users.length)
    out.users = users.map((u) => ({
      email: u.email,
      name: u.name,
      given_name: u.given_name,
      family_name: u.family_name,
      ...tenant(u.tenant_id),
    }));

  const clients = ms.oauthClients.all();
  if (clients.length)
    out.oauth_clients = clients.map((c) => ({
      client_id: c.client_id,
      client_secret: c.client_secret,
      name: c.name,
      redirect_uris: c.redirect_uris,
      ...tenant(c.tenant_id),
    }));

  return { ...out, ...storeToGraphSeedConfig(store) };
}

export const microsoftPlugin: ServicePlugin = {
  name: "microsoft",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    inspectorRoutes(ctx);
    oauthRoutes(ctx);
    graphRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
    seedGraphDefaults(store, baseUrl);
  },
};

export default microsoftPlugin;
