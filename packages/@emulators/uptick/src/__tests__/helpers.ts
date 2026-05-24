import { Hono } from "hono";
import { Store, WebhookDispatcher, type TokenMap } from "@emulators/core";
import { uptickPlugin, seedFromConfig, type UptickSeedConfig } from "../index.js";

// Uptick tenant base, e.g. https://<subdomain>.onuptick.com
export const BASE = "http://localhost:14020";

// The API is version-pinned in the path: /api/v2/... — see `/api/version/`.
export const VER = "v2";

export interface TestApp {
  app: Hono;
  store: Store;
}

/**
 * Builds an isolated Uptick emulator. By default seeds one client →
 * property → asset → defect chain plus an asset type and a user so
 * relationship/filter assertions have something to resolve against.
 */
export function createTestApp(opts: { seed?: UptickSeedConfig | false } = {}): TestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();

  uptickPlugin.register(app as never, store, webhooks, BASE, tokenMap);

  if (opts.seed !== false) {
    seedFromConfig(store, BASE, opts.seed ?? DEFAULT_SEED);
  }

  return { app, store };
}

export const DEFAULT_SEED: UptickSeedConfig = {
  asset_types: [{ name: "Fire Extinguisher", description: "Portable extinguisher" }],
  users: [{ username: "tech1", email: "tech@agent-emulate.dev", first_name: "Demo", last_name: "Tech" }],
  clients: [
    {
      name: "Demo Property Group",
      sector: "Commercial",
      ref: "DPG-001",
      contact_name: "Jane Citizen",
      contact_email: "jane@agent-emulate.dev",
    },
  ],
  properties: [
    {
      name: "Demo Building A",
      client_name: "Demo Property Group",
      address_streetline: "1 Demo St",
      address_city: "Melbourne",
      address_state: "VIC",
      address_postcode: "3000",
    },
  ],
  assets: [
    {
      name: "Extinguisher 01",
      asset_number: "EX-01",
      property_name: "Demo Building A",
      client_name: "Demo Property Group",
      asset_type_name: "Fire Extinguisher",
    },
  ],
  defects: [
    {
      description: "Gauge in red zone",
      severity: "high",
      status: "open",
      asset_name: "Extinguisher 01",
    },
  ],
};

/**
 * Performs the password grant the Postman collection documents and returns
 * the bearer token. Client credentials go in HTTP Basic (not validated by
 * the emulator), grant params in the form body.
 */
export async function getAccessToken(app: Hono): Promise<string> {
  const res = await app.request(`${BASE}/api/oauth2/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from("client_id:client_secret").toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: "tech@agent-emulate.dev",
      password: "hunter2",
    }).toString(),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
}
