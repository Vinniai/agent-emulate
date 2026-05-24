// Plugin registry shim — owned by apps/server, NOT by upstream `emulate`.
//
// Upstream's packages/emulate/src/registry.ts hardcodes SERVICE_REGISTRY and a
// closed SERVICE_NAMES union. Editing that file (and packages/emulate/package.json)
// to register our private adapters caused a merge conflict on every upstream
// sync. Instead, those upstream files now track upstream verbatim, and the
// private adapters (workos/nango/simpro/uptick) are registered here by merging
// our entries on top of the built-in registry. Adding/removing a private
// adapter only touches this file.
import { SERVICE_REGISTRY as BUILTIN_REGISTRY, SERVICE_NAMES as BUILTIN_NAMES } from "emulate";
import type { ServiceEntry, ServiceName as BuiltinServiceName } from "emulate";
// Generated: every Nango-proxied provider, also available standalone direct.
import { DIRECT_REGISTRY, DIRECT_NAMES } from "./direct-emulators.js";

const CUSTOM_NAME_LIST = ["workos", "nango", "simpro", "uptick"] as const;
export type CustomServiceName = (typeof CUSTOM_NAME_LIST)[number];
export type DirectServiceName = (typeof DIRECT_NAMES)[number];

/** Built-in upstream services, our private adapters, and the direct emulators. */
export type ServiceName = BuiltinServiceName | CustomServiceName | DirectServiceName;

const CUSTOM_REGISTRY: Record<CustomServiceName, ServiceEntry> = {
  simpro: {
    label: "Simpro Premium REST API emulator",
    endpoints:
      "OAuth 2.0, jobs, sections, cost centers, customers (companies + individuals), sites, staff, contractors, quotes, invoices, schedules, assets, reference data (tax codes, labour rates, statuses, stock), webhooks, inspector UI",
    async load() {
      const mod = await import("@emulators/simpro");
      return {
        plugin: mod.simproPlugin,
        seedFromConfig: mod.seedFromConfig,
        storeToSeedConfig: mod.storeToSeedConfig,
      };
    },
    defaultFallback() {
      return { login: "admin@agent-emulate.dev", id: 1, scopes: [] };
    },
    initConfig: {
      simpro: {
        rate_limit_enabled: false,
        oauth: { client_id: "taskr_dev", client_secret: "taskr_dev_secret" },
        companies: [{ id: 0, name: "Taskr Test Co" }],
        tax_codes: [
          { id: 1, name: "GST", rate: 10 },
          { id: 2, name: "GST Free", rate: 0 },
        ],
        master_cost_centers: [
          { id: 12, name: "Plumbing Materials", income_account: "4-1000" },
          { id: 15, name: "Electrical Labour", income_account: "4-1010" },
        ],
        customers: [
          {
            id: 200,
            type: "company",
            company_name: "Acme Facilities Pty Ltd",
            email: "ops@agent-emulate.dev",
            sites: [{ id: 55, name: "North Campus Building A" }],
          },
        ],
        jobs: [
          {
            id: 12345,
            type: "Project",
            name: "Sprinkler Overhaul Q3",
            customer_id: 200,
            site_id: 55,
            stage: 3,
            order_no: "PO-4481",
            sections: [
              {
                id: 1001,
                name: "Zone 1 – Ground Floor",
                cost_centers: [
                  { id: 5001, master_cost_center_id: 12, billing_type: "TimeAndMaterials", stage: 3 },
                  { id: 5002, master_cost_center_id: 15, billing_type: "Fixed", stage: 2 },
                ],
              },
              {
                id: 1002,
                name: "Zone 2 – Level 1",
                cost_centers: [
                  { id: 5003, master_cost_center_id: 12, billing_type: "TimeAndMaterials", stage: 2 },
                  { id: 5004, master_cost_center_id: 15, billing_type: "FlatRate", stage: 2 },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  workos: {
    label: "WorkOS User Management emulator",
    endpoints:
      "OAuth 2.0/OIDC authorize, token exchange (code/password/org-selection/refresh), JWKS, organization memberships, session revocation, invitations, webhook simulation",
    async load() {
      const mod = await import("@emulators/workos");
      return { plugin: mod.workosPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "dev@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: [] };
    },
    initConfig: {
      workos: {
        users: [
          {
            id: "user_dev",
            email: "dev@agent-emulate.dev",
            first_name: "Dev",
            last_name: "User",
            password: "DevPassword123!",
          },
        ],
        organizations: [{ id: "org_dev", name: "Dev Org", slug: "dev-org" }],
        memberships: [{ user_email: "dev@agent-emulate.dev", organization_slug: "dev-org", role: "owner" }],
        oauth_clients: [
          {
            client_id: "client_test_01",
            client_secret: "sk_test_emulator_secret",
            name: "Taskr Local",
            redirect_uris: ["http://localhost:3000/callback", "taskr://auth/callback"],
          },
        ],
      },
    },
  },

  nango: {
    label: "Nango integration platform emulator",
    endpoints:
      "connections (get/list/create/metadata), connect sessions (create/reconnect), proxy (QuickBooks /v3/company/:id/query, Xero /api.xro/2.0/*, MYOB, generic)",
    async load() {
      const mod = await import("@emulators/nango");
      return {
        plugin: mod.nangoPlugin,
        seedFromConfig: mod.seedFromConfig,
        storeToSeedConfig: mod.storeToSeedConfig,
      };
    },
    defaultFallback() {
      return { login: "nango-emulator", id: 1, scopes: [] };
    },
    initConfig: {
      nango: {
        connections: [
          {
            id: "xero-demo",
            provider: "xero",
            provider_config_key: "xero",
            metadata: { activeTenantId: "demo-tenant-xero-001" },
            records: {
              Invoice: [
                {
                  id: "INV-001",
                  InvoiceNumber: "INV-001",
                  Total: 1100.0,
                  AmountDue: 1100.0,
                  Status: "AUTHORISED",
                  DateString: "2024-01-15",
                  DueDateString: "2024-02-15",
                  Contact: { ContactID: "CONTACT-001", Name: "Demo Customer" },
                },
              ],
              Contact: [{ id: "CONTACT-001", Name: "Demo Customer", EmailAddress: "customer@agent-emulate.dev" }],
            },
          },
          {
            id: "quickbooks-demo",
            provider: "quickbooks",
            provider_config_key: "quickbooks-sandbox",
            connection_config: { realmId: "sandbox-realm-001" },
            records: {
              Invoice: [
                {
                  Id: "1",
                  DocNumber: "1001",
                  TotalAmt: 550.0,
                  Balance: 550.0,
                  TxnDate: "2024-01-10",
                  DueDate: "2024-02-10",
                  CustomerRef: { value: "1", name: "Test Customer" },
                },
              ],
              Customer: [
                {
                  Id: "1",
                  DisplayName: "Test Customer",
                  PrimaryEmailAddr: { Address: "customer@agent-emulate.dev" },
                },
              ],
            },
          },
        ],
      },
    },
  },

  uptick: {
    label: "Uptick fire protection field service API emulator",
    endpoints: "clients, properties, assets, defects, asset types, users, oauth2 token",
    async load() {
      const mod = await import("@emulators/uptick");
      return {
        plugin: mod.uptickPlugin,
        seedFromConfig: mod.seedFromConfig,
        storeToSeedConfig: mod.storeToSeedConfig,
      };
    },
    defaultFallback() {
      return { login: "sk_test_uptick", id: 1, scopes: [] };
    },
    initConfig: {
      uptick: {
        clients: [
          {
            name: "Demo Property Group",
            contact_email: "admin@agent-emulate.dev",
            contact_name: "Demo Admin",
          },
        ],
        properties: [
          {
            name: "Demo Building A",
            client_name: "Demo Property Group",
            address_city: "Melbourne",
            address_state: "VIC",
          },
        ],
        assets: [
          {
            name: "Fire Hose Reel 01",
            property_name: "Demo Building A",
            client_name: "Demo Property Group",
            asset_type_name: "Fire Hose Reel",
          },
        ],
        asset_types: [{ name: "Fire Hose Reel" }, { name: "Fire Extinguisher" }, { name: "Fire Panel" }],
        users: [
          {
            username: "tech1",
            email: "tech@agent-emulate.dev",
            first_name: "Demo",
            last_name: "Tech",
          },
        ],
      },
    },
  },
};

/** Built-in upstream registry merged with our private adapters. */
export const SERVICE_REGISTRY: Record<ServiceName, ServiceEntry> = {
  ...(BUILTIN_REGISTRY as Record<ServiceName, ServiceEntry>),
  ...CUSTOM_REGISTRY,
  ...(DIRECT_REGISTRY as Record<ServiceName, ServiceEntry>),
};

export const SERVICE_NAMES: readonly ServiceName[] = [...BUILTIN_NAMES, ...CUSTOM_NAME_LIST, ...DIRECT_NAMES];
