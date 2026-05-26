/**
 * Bridge: Simpro emulator data → Nango Records API
 *
 * Owned by apps/server (private layer). Do NOT add Simpro-specific code
 * inside packages/@emulators/nango — that package stays provider-agnostic.
 *
 * The simpro and nango emulators each own a separate Store instance
 * (one per service).  This bridge accepts both stores so it can read from
 * the simpro store and write into the nango store.
 *
 * Usage:
 *   syncSimproIntoNango(simproStore, nangoStore)
 *
 * After calling this, the Nango records endpoint will return Simpro data:
 *   GET /nango/records?model=SimproCustomer
 *     Headers: Connection-Id: simpro-conn, Provider-Config-Key: simpro
 */

import type { Store } from "@emulators/core";
import { getNangoStore } from "@emulators/nango";
import { getSimproStore, formatCustomer, formatInvoice, formatQuote } from "@emulators/simpro";

export const SIMPRO_NANGO_CONNECTION_ID = "simpro-conn";
export const SIMPRO_PROVIDER_CONFIG_KEY = "simpro";

export interface SyncSimproOptions {
  /** Nango connection id to write records into. Defaults to "simpro-conn". */
  connectionId?: string;
  /** Nango provider_config_key. Defaults to "simpro". */
  providerConfigKey?: string;
}

export interface SyncSimproResult {
  connectionId: string;
  customers: number;
  invoices: number;
  quotes: number;
}

/**
 * Read all Simpro customers/invoices/quotes from `simproStore`, format them
 * using the canonical Simpro REST API formatters (the exact same JSON the
 * /simpro REST routes return), and write them into the Nango Records store
 * (`nangoStore`) under the given connection id.
 *
 * A Nango connection row is created/updated so GET /nango/records and
 * POST /nango/sync/trigger both function correctly.  Each record has a
 * top-level `ID` field (from the formatter output) which the Nango
 * id-filter check (`r.id ?? r.Id ?? r.ID`) will resolve correctly.
 */
export function syncSimproIntoNango(
  simproStore: Store,
  nangoStore: Store,
  opts: SyncSimproOptions = {},
): SyncSimproResult {
  const connectionId = opts.connectionId ?? SIMPRO_NANGO_CONNECTION_ID;
  const providerConfigKey = opts.providerConfigKey ?? SIMPRO_PROVIDER_CONFIG_KEY;

  const ss = getSimproStore(simproStore);
  const ns = getNangoStore(nangoStore);

  // Ensure a Nango connection exists for this provider so the records endpoint
  // and sync/trigger both resolve correctly.
  const existing = ns.getConnection(connectionId);
  if (!existing) {
    const now = new Date().toISOString();
    ns.upsertConnection({
      id: connectionId,
      connection_id: connectionId,
      provider: providerConfigKey,
      provider_config_key: providerConfigKey,
      credentials: {
        type: "OAuth2",
        access_token: `emulator-token-${connectionId}`,
        refresh_token: `emulator-refresh-${connectionId}`,
        expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        raw: {
          access_token: `emulator-token-${connectionId}`,
          token_type: "Bearer",
        },
      },
      connection_config: {},
      metadata: {},
      tags: {},
      created_at: now,
      updated_at: now,
      last_fetched_at: now,
      errors: [],
    });
  }

  // Format customers using the canonical Simpro REST formatter.
  const customerRows = ss.customers
    .all()
    .map((c) => formatCustomer(c) as Record<string, unknown>);
  ns.setRecords(connectionId, "SimproCustomer", customerRows);

  // Format invoices — pass ss for job/customer look-ups (same as REST routes).
  const invoiceRows = ss.invoices
    .all()
    .map((i) => formatInvoice(i, ss) as Record<string, unknown>);
  ns.setRecords(connectionId, "SimproInvoice", invoiceRows);

  // Format quotes — pass ss for customer/site/staff look-ups.
  const quoteRows = ss.quotes
    .all()
    .map((q) => formatQuote(q, ss) as Record<string, unknown>);
  ns.setRecords(connectionId, "SimproQuote", quoteRows);

  return {
    connectionId,
    customers: customerRows.length,
    invoices: invoiceRows.length,
    quotes: quoteRows.length,
  };
}
