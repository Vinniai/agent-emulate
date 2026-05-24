// Direct quickbooks native routes — standalone (extracted from the nango
// alongside the HubSpot / Salesforce / Xero direct routes). The pre-existing
// nango proxy only did read-only query passthrough for QuickBooks; this is the
// stateful write surface — and creating an invoice fires QuickBooks' *own*
// Event Notification webhook to the registered destination, so the
// "invoice create → QuickBooks → webhook to our destination" chain is
// end-to-end:
//
//   POST /oauth2/v1/tokens/bearer        → OAuth2 token
//   POST /v3/company/:realmId/invoice     → create → webhook
//   GET  /v3/company/:realmId/invoice/:id → read one
//   GET  /v3/company/:realmId/query?query=SELECT * FROM Invoice
//
// State lives in the shared store under "quickbooks.*" so /reset clears it.
// On create, a faithful QuickBooks Event Notification
// (eventNotifications[].dataChangeEvent.entities[].operation="Create",
// signed base64-HMAC under `intuit-signature`) is POSTed to the URL
// registered via /webhook-settings and logged to /webhook-deliveries.

import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { AppEnv, Store } from "@emulators/core";
import { dispatchProviderWebhook } from "../webhooks.js";

const INVOICES_KEY = "quickbooks.invoices";
const SEQ_KEY = "quickbooks.seq";

type Invoices = Map<string, Record<string, unknown>>;

const getInvoices = (store: Store): Invoices => {
  let m = store.getData<Invoices>(INVOICES_KEY);
  if (!m) {
    m = new Map();
    store.setData(INVOICES_KEY, m);
  }
  return m;
};

const nextId = (store: Store): number => {
  const n = (store.getData<number>(SEQ_KEY) ?? 0) + 1;
  store.setData(SEQ_KEY, n);
  return n;
};

/** QuickBooks accepts any Bearer access token; only its presence is enforced. */
const authed = (c: Context): boolean => (c.req.header("Authorization") ?? "").toLowerCase().startsWith("bearer ");

const unauthorized = (c: Context) =>
  c.json(
    {
      fault: {
        error: [{ message: "AuthenticationFailed", detail: "Token expired or invalid", code: "3200" }],
        type: "AUTHENTICATION",
      },
      time: new Date().toISOString(),
    },
    401,
  );

/** "SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100" → "Invoice" */
function parseEntity(q: string): string | null {
  const m = /\bfrom\s+([A-Za-z]+)/i.exec(q);
  return m ? m[1] : null;
}

function computeTotal(inv: Record<string, unknown>): number {
  if (typeof inv.TotalAmt === "number") return inv.TotalAmt;
  const lines = Array.isArray(inv.Line) ? (inv.Line as Array<Record<string, unknown>>) : [];
  return lines.reduce((sum, li) => sum + (typeof li.Amount === "number" ? li.Amount : 0), 0);
}

export const directQuickbooksRoutes = (app: Hono<AppEnv>, store: Store): void => {
  const base = "";

  // ---- OAuth2 token (authorization_code / refresh_token) ----------------

  app.post(`${base}/oauth2/v1/tokens/bearer`, async (c) => {
    const params = new URLSearchParams(await c.req.text());
    const grant = params.get("grant_type") ?? "";
    if (grant !== "authorization_code" && grant !== "refresh_token" && grant !== "client_credentials") {
      return c.json({ error: "unsupported_grant_type", error_description: grant }, 400);
    }
    return c.json({
      token_type: "bearer",
      expires_in: 3600,
      access_token: `qb_at_${randomBytes(24).toString("hex")}`,
      refresh_token: `qb_rt_${randomBytes(24).toString("hex")}`,
      x_refresh_token_expires_in: 8726400,
    });
  });

  // ---- Create an invoice → emit QuickBooks' own Event Notification ------

  app.post(`${base}/v3/company/:realmId/invoice`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const realmId = c.req.param("realmId");
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(nextId(store));
    const now = new Date().toISOString();
    const inv: Record<string, unknown> = {
      ...raw,
      Id: id,
      SyncToken: "0",
      domain: "QBO",
      sparse: false,
      DocNumber: raw.DocNumber ?? `10${id.padStart(2, "0")}`,
      TotalAmt: computeTotal(raw),
      Balance: computeTotal(raw),
      CurrencyRef: raw.CurrencyRef ?? { value: "USD", name: "United States Dollar" },
      MetaData: { CreateTime: now, LastUpdatedTime: now },
    };
    getInvoices(store).set(id, inv);

    await dispatchProviderWebhook(store, {
      signatureHeader: "intuit-signature",
      payload: {
        eventNotifications: [
          {
            realmId,
            dataChangeEvent: {
              entities: [{ name: "Invoice", id, operation: "Create", lastUpdated: now }],
            },
          },
        ],
      },
    });

    return c.json({ Invoice: inv, time: now });
  });

  // ---- Read back: by id + query (precede nothing; distinct paths) -------

  app.get(`${base}/v3/company/:realmId/invoice/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const inv = getInvoices(store).get(c.req.param("id"));
    if (!inv) {
      return c.json(
        {
          fault: { error: [{ message: "Object Not Found", code: "610" }], type: "ValidationFault" },
          time: new Date().toISOString(),
        },
        404,
      );
    }
    return c.json({ Invoice: inv, time: new Date().toISOString() });
  });

  app.get(`${base}/v3/company/:realmId/query`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const query = c.req.query("query") ?? "";
    const entity = parseEntity(query);
    if (!entity) return c.json({ error: "Could not parse entity from query", query }, 400);
    const rows = entity.toLowerCase() === "invoice" ? [...getInvoices(store).values()] : [];
    return c.json({
      QueryResponse: {
        [entity]: rows,
        startPosition: 1,
        maxResults: rows.length,
        totalCount: rows.length,
      },
      time: new Date().toISOString(),
    });
  });
};
