// Direct salesforce native routes — standalone (extracted from the nango
// alongside the HubSpot routes). The pre-existing nango proxy only did
// read-only record passthrough for Salesforce; this is the stateful surface a
// real integration exercises:
//
//   GET  /services/oauth2/authorize           → consent page
//   POST /services/oauth2/authorize/callback   → mints code
//   POST /services/oauth2/token                → password +
//                                                                authorization_code +
//                                                                refresh_token
//   POST   /services/data/:ver/sobjects/:type                 → create
//   GET    /services/data/:ver/sobjects/:type/:id             → read
//   PATCH  /services/data/:ver/sobjects/:type/:id             → update
//   DELETE /services/data/:ver/sobjects/:type/:id             → delete
//   GET    /services/data/:ver/sobjects/:type/describe        → describe
//   GET    /services/data/:ver/query?q=<SOQL>                  → SOQL query
//   POST   /services/data/:ver/composite/sobjects             → collection create
//
// State lives in the shared store under "salesforce.*" so /reset clears it.
// Salesforce ids are keyPrefix + base-62-ish; access tokens look like org
// session ids (00D…). Errors use the Salesforce array envelope
// [{ message, errorCode }].

import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyStr, renderCardPage, renderUserButton, type AppEnv, type Store } from "@emulators/core";

const SERVICE_LABEL = "Salesforce";
const PENDING_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 7200;

type SobjectsByType = Map<string, Map<string, Record<string, unknown>>>;

interface PendingCode {
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

const SOBJECTS_KEY = "salesforce.sobjects";
const SEQ_KEY = "salesforce.seq";
const PENDING_KEY = "salesforce.oauth.pendingCodes";
const TOKENS_KEY = "salesforce.oauth.issuedTokens";

/** Real Salesforce key prefixes for the common standard objects. */
const KEY_PREFIX: Record<string, string> = {
  Account: "001",
  Contact: "003",
  Lead: "00Q",
  Opportunity: "006",
  Case: "500",
  User: "005",
};

const getSobjects = (store: Store): SobjectsByType => {
  let m = store.getData<SobjectsByType>(SOBJECTS_KEY);
  if (!m) {
    m = new Map();
    store.setData(SOBJECTS_KEY, m);
  }
  return m;
};

const bucket = (store: Store, type: string): Map<string, Record<string, unknown>> => {
  const all = getSobjects(store);
  let b = all.get(type);
  if (!b) {
    b = new Map();
    all.set(type, b);
  }
  return b;
};

const nextId = (store: Store, type: string): string => {
  const n = (store.getData<number>(SEQ_KEY) ?? 0) + 1;
  store.setData(SEQ_KEY, n);
  const prefix = KEY_PREFIX[type] ?? "0XX";
  return `${prefix}${n.toString().padStart(15, "0")}`;
};

const getPending = (store: Store): Map<string, PendingCode> => {
  let m = store.getData<Map<string, PendingCode>>(PENDING_KEY);
  if (!m) {
    m = new Map();
    store.setData(PENDING_KEY, m);
  }
  return m;
};

const getTokens = (store: Store): Map<string, { expiresAt: number }> => {
  let m = store.getData<Map<string, { expiresAt: number }>>(TOKENS_KEY);
  if (!m) {
    m = new Map();
    store.setData(TOKENS_KEY, m);
  }
  return m;
};

const unauthorized = (c: Context) =>
  c.json([{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }], 401);

const notFound = (c: Context) =>
  c.json([{ message: "The requested resource does not exist", errorCode: "NOT_FOUND" }], 404);

/** Salesforce accepts any Bearer session id; only its presence is enforced. */
const authed = (c: Context): boolean => (c.req.header("Authorization") ?? "").toLowerCase().startsWith("bearer ");

const instanceUrl = (c: Context): string => `${new URL(c.req.url).origin}`;

const recordView = (
  type: string,
  ver: string,
  id: string,
  fields: Record<string, unknown>,
): Record<string, unknown> => ({
  attributes: { type, url: `/services/data/${ver}/sobjects/${type}/${id}` },
  Id: id,
  ...fields,
});

interface ParsedSoql {
  fields: string[];
  sobject: string;
  where?: { field: string; op: string; value: string };
  limit?: number;
}

function parseSoql(q: string): ParsedSoql | null {
  const m = /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\d+))?\s*$/i.exec(q.trim());
  if (!m) return null;
  const fields = m[1].split(",").map((f) => f.trim());
  const parsed: ParsedSoql = { fields, sobject: m[2] };
  if (m[3]) {
    const w = /^\s*(\w+)\s*(=|!=|>=|<=|>|<)\s*(.+?)\s*$/.exec(m[3]);
    if (w) {
      let value = w[3].trim();
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      parsed.where = { field: w[1], op: w[2], value };
    }
  }
  if (m[4]) parsed.limit = Number(m[4]);
  return parsed;
}

function whereMatches(rec: Record<string, unknown>, w: { field: string; op: string; value: string }): boolean {
  const actual = w.field === "Id" ? rec.Id : rec[w.field];
  const bothNumeric = !Number.isNaN(Number(actual)) && !Number.isNaN(Number(w.value));
  const a: number | string = bothNumeric ? Number(actual) : String(actual);
  const b: number | string = bothNumeric ? Number(w.value) : w.value;
  switch (w.op) {
    case "=":
      return a === b;
    case "!=":
      return a !== b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    default:
      return false;
  }
}

export const directSalesforceRoutes = (app: Hono<AppEnv>, store: Store): void => {
  const base = "";

  // ---- OAuth ------------------------------------------------------------

  app.get(`${base}/services/oauth2/authorize`, (c) => {
    const client_id = c.req.query("client_id") ?? "";
    const redirect_uri = c.req.query("redirect_uri") ?? "";
    const state = c.req.query("state") ?? "";
    const body = renderUserButton({
      letter: "S",
      login: "Connect to Salesforce",
      name: "Salesforce emulator org",
      email: "admin@agent-emulate.dev",
      formAction: `${base}/services/oauth2/authorize/callback`,
      hiddenFields: { client_id, redirect_uri, state },
    });
    return c.html(
      renderCardPage(
        "Sign in to Salesforce",
        "Authorize <strong>Taskr</strong> to access your Salesforce org.",
        body,
        SERVICE_LABEL,
      ),
    );
  });

  app.post(`${base}/services/oauth2/authorize/callback`, async (c) => {
    const form = await c.req.parseBody();
    const client_id = bodyStr(form.client_id);
    const redirect_uri = bodyStr(form.redirect_uri);
    const state = bodyStr(form.state);
    const code = randomBytes(20).toString("hex");
    getPending(store).set(code, { clientId: client_id, redirectUri: redirect_uri, createdAt: Date.now() });
    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

  app.post(`${base}/services/oauth2/token`, async (c) => {
    const params = new URLSearchParams(await c.req.text());
    const grantType = params.get("grant_type") ?? "";

    const issue = (): Record<string, unknown> => {
      const accessToken = `00D${randomBytes(28).toString("hex")}`;
      const refreshToken = `5Aep${randomBytes(28).toString("hex")}`;
      const expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000;
      const tokens = getTokens(store);
      tokens.set(accessToken, { expiresAt });
      tokens.set(refreshToken, { expiresAt });
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        instance_url: instanceUrl(c),
        id: `${instanceUrl(c)}/id/00Demu/005emu`,
        token_type: "Bearer",
        issued_at: String(Date.now()),
        signature: randomBytes(16).toString("base64"),
        scope: "api refresh_token",
      };
    };

    if (grantType === "password") {
      if (!params.get("username") || !params.get("password")) {
        return c.json({ error: "invalid_grant", error_description: "authentication failure" }, 400);
      }
      return c.json(issue());
    }
    if (grantType === "authorization_code") {
      const code = params.get("code") ?? "";
      const pending = getPending(store).get(code);
      if (!pending || Date.now() - pending.createdAt > PENDING_CODE_TTL_MS) {
        return c.json({ error: "invalid_grant", error_description: "invalid authorization code" }, 400);
      }
      getPending(store).delete(code);
      return c.json(issue());
    }
    if (grantType === "refresh_token") {
      const rt = params.get("refresh_token") ?? "";
      if (!getTokens(store).has(rt)) {
        return c.json({ error: "invalid_grant", error_description: "expired access/refresh token" }, 400);
      }
      return c.json(issue());
    }
    return c.json({ error: "unsupported_grant_type", error_description: grantType }, 400);
  });

  // ---- SOQL query (precede generic sobjects routes) ---------------------

  app.get(`${base}/services/data/:ver/query`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const ver = c.req.param("ver");
    const q = c.req.query("q") ?? "";
    const parsed = parseSoql(q);
    if (!parsed) {
      return c.json([{ message: `unexpected token: ${q}`, errorCode: "MALFORMED_QUERY" }], 400);
    }
    let rows = [...bucket(store, parsed.sobject).entries()];
    if (parsed.where) {
      const w = parsed.where;
      rows = rows.filter(([id, fields]) => whereMatches({ Id: id, ...fields }, w));
    }
    if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit);
    const wantAll = parsed.fields.some((f) => f === "*" || /FIELDS\(/i.test(f));
    const records = rows.map(([id, fields]) => {
      const full = recordView(parsed.sobject, ver, id, fields);
      if (wantAll) return full;
      const projected: Record<string, unknown> = {
        attributes: full.attributes,
      };
      for (const f of parsed.fields) {
        const key = f === "Id" ? "Id" : f;
        if (key in full) projected[key] = full[key];
      }
      if (!("Id" in projected)) projected.Id = id;
      return projected;
    });
    return c.json({ totalSize: records.length, done: true, records });
  });

  // ---- composite collection create -------------------------------------

  app.post(`${base}/services/data/:ver/composite/sobjects`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      records?: Array<Record<string, unknown> & { attributes?: { type?: string } }>;
    };
    const results = (body.records ?? []).map((r) => {
      const { attributes, ...fields } = r;
      const type = attributes?.type ?? "Account";
      const id = nextId(store, type);
      bucket(store, type).set(id, fields);
      return { id, success: true, errors: [] };
    });
    return c.json(results);
  });

  // ---- sObject describe (precede /:type/:id) ---------------------------

  app.get(`${base}/services/data/:ver/sobjects/:type/describe`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const names = new Set<string>(["Id", "Name"]);
    for (const fields of bucket(store, type).values()) {
      for (const k of Object.keys(fields)) names.add(k);
    }
    return c.json({
      name: type,
      label: type,
      fields: [...names].map((n) => ({
        name: n,
        label: n,
        type: n === "Id" ? "id" : "string",
        custom: n.endsWith("__c"),
      })),
    });
  });

  // ---- sObject CRUD -----------------------------------------------------

  app.post(`${base}/services/data/:ver/sobjects/:type`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const fields = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = nextId(store, type);
    bucket(store, type).set(id, fields);
    return c.json({ id, success: true, errors: [] }, 201);
  });

  app.get(`${base}/services/data/:ver/sobjects/:type/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const id = c.req.param("id");
    const rec = bucket(store, type).get(id);
    if (!rec) return notFound(c);
    return c.json(recordView(type, c.req.param("ver"), id, rec));
  });

  app.patch(`${base}/services/data/:ver/sobjects/:type/:id`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const id = c.req.param("id");
    const b = bucket(store, type);
    const rec = b.get(id);
    if (!rec) return notFound(c);
    const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    b.set(id, { ...rec, ...patch });
    return c.body(null, 204);
  });

  app.delete(`${base}/services/data/:ver/sobjects/:type/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const id = c.req.param("id");
    const b = bucket(store, type);
    if (!b.has(id)) return notFound(c);
    b.delete(id);
    return c.body(null, 204);
  });
};
