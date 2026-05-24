// Nango persona generators — the *unified-integration* variant.
//
// Instead of hitting each provider's own emulator directly (the personas in
// generators.ts), these stream writes through the **Nango emulator** mounted at
// `/nango` on apps/server. Nango fronts the "non-direct" providers it manages,
// exposing their native APIs under stable `*-emu` base paths that persist to
// Nango's store and (for Xero/QuickBooks) fire provider webhooks:
//
//   salesforce  → POST /nango/salesforce-emu/services/data/v60.0/sobjects/Lead
//   hubspot     → POST /nango/hubspot-emu/crm/v3/objects/{contacts,deals}
//   xero        → POST /nango/xero-emu/api.xro/2.0/Invoices
//   quickbooks  → POST /nango/quickbooks-emu/v3/company/:realmId/invoice
//
// Each is a `kind: "native"` tick; the stream's `pathPrefix: /nango` is
// prepended by the engine, so traffic dispatches to the Nango service and lands
// on the aggregate `/_activity` stream as service `nango`. Registered via the
// simulator's public `registerGenerator()` — no package fork.
//
// These are the **write** routes. Nango's unified *read* surface (`/proxy/*`)
// requires `Connection-Id` + `Provider-Config-Key` request headers; the engine's
// `kind: native` ticks now carry per-tick `headers`, so the unified read-back is
// driven by the engine too — see `nango-readback.ts`.

import { registerGenerator, type GeneratorFn } from "@emulators/simulator";
import type { PersonaData } from "./profiles.js";

const pick = <T>(arr: readonly T[], seq: number): T => arr[seq % arr.length];

const localPart = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

const emailFor = (data: PersonaData, seq: number): string =>
  `${localPart(pick(data.people, seq))}@${pick(data.emailDomains, seq)}`;

/** A stable demo realm/company id for the QuickBooks path. */
const QB_REALM = "9130000000";
/** Date-only stamp (YYYY-MM-DD) for accounting docs. */
const dateOnly = (now: Date): string => now.toISOString().slice(0, 10);

function nangoSalesforceLead(data: PersonaData): GeneratorFn {
  return (seq) => {
    const [first, ...rest] = pick(data.people, seq).split(" ");
    return {
      kind: "native",
      method: "POST",
      path: "/salesforce-emu/services/data/v60.0/sobjects/Lead",
      body: {
        FirstName: first,
        LastName: rest.join(" ") || "Lead",
        Company: pick(data.companies, seq),
        Email: emailFor(data, seq),
        LeadSource: "Nango",
      },
    };
  };
}

function nangoHubspotContact(data: PersonaData): GeneratorFn {
  return (seq, now) => {
    const [first, ...rest] = pick(data.people, seq).split(" ");
    return {
      kind: "native",
      method: "POST",
      path: "/hubspot-emu/crm/v3/objects/contacts",
      body: {
        properties: {
          email: emailFor(data, seq),
          firstname: first,
          lastname: rest.join(" ") || "—",
          company: pick(data.companies, seq),
          createdate: now.toISOString(),
        },
      },
    };
  };
}

function nangoHubspotDeal(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/hubspot-emu/crm/v3/objects/deals",
    body: {
      properties: {
        dealname: pick(data.dealTitles, seq),
        amount: String(pick(data.amounts, seq)),
        dealstage: pick(["appointmentscheduled", "qualifiedtobuy", "presentationscheduled", "closedwon"], seq),
        createdate: now.toISOString(),
      },
    },
  });
}

function nangoXeroInvoice(data: PersonaData): GeneratorFn {
  return (seq, now) => {
    const due = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    return {
      kind: "native",
      method: "POST",
      path: "/xero-emu/api.xro/2.0/Invoices",
      body: {
        Type: "ACCREC",
        Contact: { Name: pick(data.companies, seq) },
        LineItems: [{ Description: pick(data.dealTitles, seq), Quantity: 1, UnitAmount: pick(data.amounts, seq) }],
        Date: dateOnly(now),
        DueDate: dateOnly(due),
        Status: "AUTHORISED",
      },
    };
  };
}

function nangoQuickbooksInvoice(data: PersonaData): GeneratorFn {
  return (seq, now) => {
    const amount = pick(data.amounts, seq);
    return {
      kind: "native",
      method: "POST",
      path: `/quickbooks-emu/v3/company/${QB_REALM}/invoice`,
      body: {
        Line: [
          {
            Amount: amount,
            DetailType: "SalesItemLineDetail",
            Description: pick(data.dealTitles, seq),
            SalesItemLineDetail: { ItemRef: { value: "1", name: "Services" }, Qty: 1, UnitPrice: amount },
          },
        ],
        CustomerRef: { value: String((seq % 25) + 1), name: pick(data.companies, seq) },
        TxnDate: dateOnly(now),
      },
    };
  };
}

/** Channel grouping for the Nango providers (used by the driver's tallies). */
export const NANGO_CHANNEL_OF: Record<string, "email" | "chat" | "crm"> = {
  "nango-salesforce-lead": "crm",
  "nango-hubspot-contact": "crm",
  "nango-hubspot-deal": "crm",
  "nango-xero-invoice": "crm",
  "nango-quickbooks-invoice": "crm",
};

/**
 * Register the Nango-routed generators, closed over `data`. Scenario YAMLs
 * reference these provider keys. Safe to call alongside
 * `registerPersonaGenerators` — the keys don't collide.
 */
export function registerNangoGenerators(data: PersonaData): void {
  registerGenerator("nango-salesforce-lead", nangoSalesforceLead(data));
  registerGenerator("nango-hubspot-contact", nangoHubspotContact(data));
  registerGenerator("nango-hubspot-deal", nangoHubspotDeal(data));
  registerGenerator("nango-xero-invoice", nangoXeroInvoice(data));
  registerGenerator("nango-quickbooks-invoice", nangoQuickbooksInvoice(data));
}
