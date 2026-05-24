import type { Hono } from "hono";
import { requireAuthWhen } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { getUptickStore } from "./store.js";
import { assetRoutes } from "./routes/assets.js";
import { clientRoutes } from "./routes/clients.js";
import { defectRoutes } from "./routes/defects.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { oauthRoutes } from "./routes/oauth.js";
import { optionsRoutes } from "./routes/options.js";
import { propertyRoutes } from "./routes/properties.js";
import { referenceRoutes } from "./routes/reference.js";

export { getUptickStore, type UptickStore } from "./store.js";
export * from "./entities.js";

export interface UptickSeedConfig {
  clients?: Array<{
    name: string;
    is_active?: boolean;
    sector?: string;
    ref?: string;
    contact_name?: string;
    contact_email?: string;
  }>;
  properties?: Array<{
    name: string;
    client_name?: string;
    is_active?: boolean;
    address_display?: string;
    address_streetline?: string;
    address_city?: string;
    address_state?: string;
    address_postcode?: string;
    address_country?: string;
  }>;
  assets?: Array<{
    name: string;
    asset_number?: string;
    is_active?: boolean;
    standard_maintenance?: string;
    property_name?: string;
    client_name?: string;
    asset_type_name?: string;
  }>;
  defects?: Array<{
    description: string;
    notes?: string;
    severity?: string;
    status?: string;
    asset_name?: string;
    property_name?: string;
    client_name?: string;
  }>;
  asset_types?: Array<{
    name: string;
    description?: string;
  }>;
  users?: Array<{
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    is_active?: boolean;
  }>;
}

export function seedFromConfig(store: Store, _baseUrl: string, config: UptickSeedConfig): void {
  const us = getUptickStore(store);

  // 1. Asset types
  for (const at of config.asset_types ?? []) {
    if (!us.assetTypes.all().find((t) => t.name === at.name)) {
      us.assetTypes.insert({ name: at.name, description: at.description ?? "" });
    }
  }

  // 2. Users
  for (const u of config.users ?? []) {
    if (!us.users.findOneBy("email", u.email)) {
      us.users.insert({
        username: u.username,
        email: u.email,
        first_name: u.first_name ?? "",
        last_name: u.last_name ?? "",
        is_active: u.is_active !== false,
      });
    }
  }

  // 3. Clients
  for (const cl of config.clients ?? []) {
    const existing = us.clients.all().find((c) => c.name === cl.name);
    if (existing) continue;
    us.clients.insert({
      name: cl.name,
      is_active: cl.is_active !== false,
      sector: cl.sector ?? "",
      ref: cl.ref ?? "",
      contact_name: cl.contact_name ?? "",
      contact_email: cl.contact_email ?? "",
    });
  }

  // 4. Properties (depends on clients)
  for (const p of config.properties ?? []) {
    const client = p.client_name ? us.clients.all().find((c) => c.name === p.client_name) : null;

    if (p.client_name && !client) {
      console.warn(`[uptick] seedFromConfig: property "${p.name}" — client "${p.client_name}" not found, skipping`);
      continue;
    }

    const existing = client
      ? us.properties.findBy("client_id", client.id).find((pr) => pr.name === p.name)
      : us.properties.all().find((pr) => pr.name === p.name);
    if (existing) continue;

    us.properties.insert({
      name: p.name,
      client_id: client?.id ?? 0,
      is_active: p.is_active !== false,
      address_display: p.address_display ?? "",
      address_streetline: p.address_streetline ?? "",
      address_city: p.address_city ?? "",
      address_state: p.address_state ?? "",
      address_postal_code: p.address_postcode ?? "",
      address_country: p.address_country ?? "AU",
    });
  }

  // 5. Assets (depends on clients, properties, asset_types)
  for (const a of config.assets ?? []) {
    const client = a.client_name ? us.clients.all().find((c) => c.name === a.client_name) : null;
    const property = a.property_name ? us.properties.all().find((p) => p.name === a.property_name) : null;
    const assetType = a.asset_type_name ? us.assetTypes.all().find((t) => t.name === a.asset_type_name) : null;

    const duplicate = us.assets
      .all()
      .find((asset) => asset.name === a.name && asset.property_id === (property?.id ?? null));
    if (duplicate) continue;

    us.assets.insert({
      name: a.name,
      asset_number: a.asset_number ?? "",
      is_active: a.is_active !== false,
      standard_maintenance: a.standard_maintenance ?? "",
      property_id: property?.id ?? null,
      client_id: client?.id ?? (property ? (us.properties.get(property.id)?.client_id ?? null) : null),
      asset_type_id: assetType?.id ?? null,
      asset_type_name: assetType?.name ?? a.asset_type_name ?? "",
    });
  }

  // 6. Defects (depends on assets, properties, clients)
  for (const d of config.defects ?? []) {
    const asset = d.asset_name ? us.assets.all().find((a) => a.name === d.asset_name) : null;
    const property = d.property_name
      ? us.properties.all().find((p) => p.name === d.property_name)
      : asset?.property_id
        ? (us.properties.get(asset.property_id) ?? null)
        : null;
    const client = d.client_name
      ? us.clients.all().find((c) => c.name === d.client_name)
      : property?.client_id
        ? (us.clients.get(property.client_id) ?? null)
        : null;

    const duplicate = us.defects
      .all()
      .find(
        (def) =>
          def.description === d.description &&
          def.asset_id === (asset?.id ?? null) &&
          def.property_id === (property?.id ?? null),
      );
    if (duplicate) continue;

    us.defects.insert({
      description: d.description,
      notes: d.notes ?? "",
      severity: d.severity ?? "",
      status: d.status ?? "open",
      asset_id: asset?.id ?? null,
      property_id: property?.id ?? null,
      client_id: client?.id ?? null,
    });
  }
}

/**
 * Project live Uptick state back into the `UptickSeedConfig` shape. Foreign
 * keys are resolved back to the name-refs `seedFromConfig` expects. Object
 * insertion order matches `seedFromConfig`'s dependency order
 * (asset_types → users → clients → properties → assets → defects) so a
 * round-trip reconstructs equivalent relationships.
 */
export function storeToSeedConfig(store: Store, _baseUrl: string): UptickSeedConfig {
  const us = getUptickStore(store);
  const clientName = (id: number | null | undefined): string | undefined =>
    id != null ? (us.clients.get(id)?.name ?? undefined) : undefined;
  const propertyName = (id: number | null | undefined): string | undefined =>
    id != null ? (us.properties.get(id)?.name ?? undefined) : undefined;
  const assetName = (id: number | null | undefined): string | undefined =>
    id != null ? (us.assets.get(id)?.name ?? undefined) : undefined;

  return {
    asset_types: us.assetTypes.all().map((t) => ({ name: t.name, description: t.description })),
    users: us.users.all().map((u) => ({
      username: u.username,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      is_active: u.is_active,
    })),
    clients: us.clients.all().map((c) => ({
      name: c.name,
      is_active: c.is_active,
      sector: c.sector,
      ref: c.ref,
      contact_name: c.contact_name,
      contact_email: c.contact_email,
    })),
    properties: us.properties.all().map((p) => ({
      name: p.name,
      client_name: clientName(p.client_id),
      is_active: p.is_active,
      address_display: p.address_display,
      address_streetline: p.address_streetline,
      address_city: p.address_city,
      address_state: p.address_state,
      address_postcode: p.address_postal_code,
      address_country: p.address_country,
    })),
    assets: us.assets.all().map((a) => ({
      name: a.name,
      asset_number: a.asset_number,
      is_active: a.is_active,
      standard_maintenance: a.standard_maintenance,
      property_name: propertyName(a.property_id),
      client_name: clientName(a.client_id),
      asset_type_name: a.asset_type_name || undefined,
    })),
    defects: us.defects.all().map((d) => ({
      description: d.description,
      notes: d.notes,
      severity: d.severity,
      status: d.status,
      asset_name: assetName(d.asset_id),
      property_name: propertyName(d.property_id),
      client_name: clientName(d.client_id),
    })),
  };
}

export const uptickPlugin: ServicePlugin = {
  name: "uptick",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    // Health check — used by dev-emulate.sh wait loop
    app.get("/health", (c) => c.json({ status: "ok", service: "uptick" }));
    oauthRoutes(ctx);
    inspectorRoutes(ctx);
    optionsRoutes(ctx);
    // Opt-in: real Uptick rejects API calls without a bearer token. The
    // OAuth token endpoint and inspector are registered above so they stay
    // open; only the `/api/:ver/*` data routes below are gated. Off by
    // default so smoke tests / the config-driven quickstart stay green.
    app.use("/api/*", requireAuthWhen("EMULATE_UPTICK_REQUIRE_AUTH", "EMULATE_REQUIRE_AUTH"));
    referenceRoutes(ctx);
    clientRoutes(ctx);
    propertyRoutes(ctx);
    assetRoutes(ctx);
    defectRoutes(ctx);
  },
  seed(_store: Store, _baseUrl: string): void {
    // No hardcoded defaults — all data is config-driven
  },
};

export default uptickPlugin;
