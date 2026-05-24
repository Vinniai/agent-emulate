// Direct Xero Accounting emulator routes (mounted under the nango plugin
// alongside the HubSpot / Salesforce direct routes). The pre-existing nango
// proxy only did read-only record passthrough for Xero; this is the stateful
// write surface a real integration exercises — and, crucially, creating an
// invoice fires Xero's *own* webhook to the registered destination so the
// "invoice create → Xero → webhook to our destination" chain is end-to-end:
//
//   POST /xero-emu/connect/token                  → OAuth2 token (cc/refresh)
//   GET  /xero-emu/connections                    → tenant list (tenantId)
//   POST /xero-emu/api.xro/2.0/Invoices           → create → emit webhook
//   GET  /xero-emu/api.xro/2.0/Invoices           → list
//   GET  /xero-emu/api.xro/2.0/Invoices/:id       → read one
//
// State lives in the shared store under "xero.*" so /reset clears it. On
// create, a faithful Xero webhook (events[].eventCategory="INVOICE",
// eventType="CREATE", signed base64-HMAC under `x-xero-signature`) is POSTed
// to the URL registered via /webhook-settings and logged to
// /webhook-deliveries.

import { randomBytes, randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import type { AppEnv, Store } from "@emulators/core";
import { dispatchProviderWebhook } from "../webhooks.js";

const INVOICES_KEY = "xero.invoices";
const SEQ_KEY = "xero.seq";
const TENANT_KEY = "xero.tenantId";

type Invoices = Map<string, Record<string, unknown>>;

const getInvoices = (store: Store): Invoices => {
  let m = store.getData<Invoices>(INVOICES_KEY);
  if (!m) {
    m = new Map();
    store.setData(INVOICES_KEY, m);
  }
  return m;
};

const nextNumber = (store: Store): number => {
  const n = (store.getData<number>(SEQ_KEY) ?? 0) + 1;
  store.setData(SEQ_KEY, n);
  return n;
};

const tenantId = (store: Store): string => {
  let t = store.getData<string>(TENANT_KEY);
  if (!t) {
    t = randomUUID();
    store.setData(TENANT_KEY, t);
  }
  return t;
};

/** Xero accepts any Bearer access token; only its presence is enforced. */
const authed = (c: Context): boolean => (c.req.header("Authorization") ?? "").toLowerCase().startsWith("bearer ");

const unauthorized = (c: Context) =>
  c.json({ Type: null, Title: "Unauthorized", Status: 401, Detail: "AuthenticationUnsuccessful" }, 401);

const origin = (c: Context): string => new URL(c.req.url).origin;

/** Sum LineItems → Total when the caller didn't provide one. */
function computeTotal(inv: Record<string, unknown>): number {
  if (typeof inv.Total === "number") return inv.Total;
  const lines = Array.isArray(inv.LineItems) ? (inv.LineItems as Array<Record<string, unknown>>) : [];
  return lines.reduce((sum, li) => {
    if (typeof li.LineAmount === "number") return sum + li.LineAmount;
    const q = Number(li.Quantity ?? 1);
    const u = Number(li.UnitAmount ?? 0);
    return sum + (Number.isFinite(q * u) ? q * u : 0);
  }, 0);
}

const envelope = (rows: Record<string, unknown>[]): Record<string, unknown> => ({
  Id: randomUUID(),
  Status: "OK",
  ProviderName: "Xero API Emulator",
  DateTimeUTC: new Date().toISOString(),
  Invoices: rows,
});

export const directXeroRoutes = (app: Hono<AppEnv>, store: Store): void => {
  const base = "/xero-emu";
  const api = `${base}/api.xro/2.0`;

  // ---- OAuth2 token (client_credentials / refresh_token) ----------------

  app.post(`${base}/connect/token`, async (c) => {
    const params = new URLSearchParams(await c.req.text());
    const grant = params.get("grant_type") ?? "";
    if (grant !== "client_credentials" && grant !== "refresh_token" && grant !== "authorization_code") {
      return c.json({ error: "unsupported_grant_type", error_description: grant }, 400);
    }
    return c.json({
      access_token: `xero_at_${randomBytes(24).toString("hex")}`,
      refresh_token: `xero_rt_${randomBytes(24).toString("hex")}`,
      token_type: "Bearer",
      expires_in: 1800,
      scope: "accounting.transactions accounting.contacts offline_access",
    });
  });

  // Real Xero: GET https://api.xero.com/connections → tenants you can call.
  app.get(`${base}/connections`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const now = new Date().toISOString();
    return c.json([
      {
        id: randomUUID(),
        tenantId: tenantId(store),
        tenantType: "ORGANISATION",
        tenantName: "Demo Company (AU)",
        createdDateUtc: now,
        updatedDateUtc: now,
      },
    ]);
  });

  // ---- Create an invoice → emit Xero's own webhook ----------------------

  app.post(`${api}/Invoices`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const body = (await c.req.json().catch(() => ({}))) as
      | { Invoices?: Array<Record<string, unknown>> }
      | Record<string, unknown>;
    const incoming = Array.isArray((body as { Invoices?: unknown[] }).Invoices)
      ? ((body as { Invoices: Array<Record<string, unknown>> }).Invoices ?? [])
      : [body as Record<string, unknown>];

    const created: Record<string, unknown>[] = [];
    for (const raw of incoming) {
      const n = nextNumber(store);
      const id = randomUUID();
      const now = new Date().toISOString();
      const inv: Record<string, unknown> = {
        Type: raw.Type ?? "ACCREC",
        ...raw,
        InvoiceID: id,
        InvoiceNumber: raw.InvoiceNumber ?? `INV-${String(n).padStart(4, "0")}`,
        Status: raw.Status ?? "AUTHORISED",
        Total: computeTotal(raw),
        CurrencyCode: raw.CurrencyCode ?? "AUD",
        UpdatedDateUTC: now,
        DateString: now,
        HasErrors: false,
      };
      getInvoices(store).set(id, inv);
      created.push(inv);

      // Xero POSTs your webhook URL with an events batch — not the invoice
      // itself. The consumer then GETs resourceUrl to pull the new record.
      await dispatchProviderWebhook(store, {
        signatureHeader: "x-xero-signature",
        payload: {
          events: [
            {
              resourceUrl: `${origin(c)}${api}/Invoices/${id}`,
              resourceId: id,
              eventDateUtc: now,
              eventType: "CREATE",
              eventCategory: "INVOICE",
              tenantId: tenantId(store),
              tenantType: "ORGANISATION",
            },
          ],
          firstEventSequence: n,
          lastEventSequence: n,
          entropy: randomBytes(10).toString("hex"),
        },
      });
    }
    return c.json(envelope(created));
  });

  // ---- Read back --------------------------------------------------------

  app.get(`${api}/Invoices/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const inv = getInvoices(store).get(c.req.param("id"));
    if (!inv) return c.json({ Type: null, Title: "Not Found", Status: 404 }, 404);
    return c.json(envelope([inv]));
  });

  app.get(`${api}/Invoices`, (c) => {
    if (!authed(c)) return unauthorized(c);
    return c.json(envelope([...getInvoices(store).values()]));
  });
};
