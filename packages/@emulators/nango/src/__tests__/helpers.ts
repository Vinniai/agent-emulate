import { Hono } from "hono";
import { Store, WebhookDispatcher, type TokenMap } from "@emulators/core";
import { nangoPlugin, seedFromConfig, getNangoStore, type NangoSeedConfig } from "../index.js";

// Nango unified-API base. Real deployments use https://api.nango.dev — the
// emulator is path-compatible so only the host differs.
export const BASE = "http://localhost:14030";

export interface TestApp {
  app: Hono;
  store: Store;
}

/**
 * Builds an isolated Nango emulator. Nango connections are config-driven
 * (no default seed), so callers pass the connections/records they need.
 */
export function createTestApp(opts: { seed?: NangoSeedConfig } = {}): TestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();

  nangoPlugin.register(app as never, store, webhooks, BASE, tokenMap);

  if (opts.seed) seedFromConfig(store, BASE, opts.seed);

  return { app, store };
}

/** White-box accessor for tests that need to assert/mutate stored state. */
export function nangoStore(store: Store) {
  return getNangoStore(store);
}

export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * A representative org-wide multi-provider seed: the popular integrations the
 * Nango catalogue groups under Accounting / CRM / Comms. Mirrors how a single
 * org links several SaaS accounts through one Nango account.
 */
export const ORG_SEED: NangoSeedConfig = {
  connections: [
    {
      id: "quickbooks-acme",
      provider: "quickbooks",
      provider_config_key: "quickbooks",
      connection_config: { realmId: "9341453644728342" },
      metadata: { organizationId: "org_acme" },
      records: {
        Invoice: [{ id: "qb-inv-1", DocNumber: "1001", TotalAmt: 1100 }],
        Customer: [{ id: "qb-cust-1", DisplayName: "Acme Co" }],
      },
    },
    {
      id: "xero-acme",
      provider: "xero",
      provider_config_key: "xero",
      connection_config: { tenantId: "tenant-acme-0001" },
      metadata: { organizationId: "org_acme" },
      records: {
        Invoice: [{ InvoiceID: "xero-inv-1", InvoiceNumber: "INV-001", Total: 990 }],
        Contact: [{ ContactID: "xero-c-1", Name: "Acme Pty Ltd" }],
      },
    },
    {
      id: "hubspot-acme",
      provider: "hubspot",
      provider_config_key: "hubspot",
      metadata: { organizationId: "org_acme" },
    },
    {
      id: "salesforce-acme",
      provider: "salesforce",
      provider_config_key: "salesforce",
      metadata: { organizationId: "org_acme" },
    },
    { id: "slack-acme", provider: "slack", provider_config_key: "slack", metadata: { organizationId: "org_acme" } },
  ],
};
