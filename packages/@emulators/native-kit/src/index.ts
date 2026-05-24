// @emulators/native-kit — the generic "direct to source" engine.
//
// The Nango emulator speaks one uniform `/records` + `/proxy` envelope for
// every provider. This kit is the *other* shape: it turns a provider's
// SDK-aligned seed slice into a standalone `ServicePlugin` that serves each
// provider's records at the provider's OWN native REST path, behind the
// provider's own bearer-token endpoint — no Nango connection / records /
// proxy layer anywhere. One engine, spec-driven, so every seed-library
// provider gets a faithful direct-to-source emulator without 30+ hand-written
// API surfaces.
//
// A `NativeSpec` is derived (at package build time) from one provider block in
// `examples/nango-seeds.yaml`: its models, the seed rows, and — inferred from
// each row's own `url` / `self` / `*_url` field — the real native collection
// path (e.g. Salesforce `/services/data/v59.0/sobjects/Account`, SendGrid
// `/v3/marketing/contacts`). Where a row carries no native URL we fall back to
// the conventional `/<model-plural-lower>` collection.

import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Context, Hono } from "hono";

export interface NativeModelSpec {
  /** Logical model name as it appears in the seed (e.g. "Account"). */
  model: string;
  /** Native collection path, leading slash, no id (e.g. "/v3/marketing/contacts"). */
  collectionPath: string;
  /** Field that holds the record id (e.g. "Id", "id", "uuid", "gid"). */
  idField: string;
  /** Seed rows for this model. */
  rows: Array<Record<string, unknown>>;
  /**
   * JSON key the row array appears under in a dialect's list envelope
   * (e.g. Jira `issues`, Zendesk `tickets`, Shopify `products`). Defaults to a
   * naive plural of the lowercased model. Ignored by the `default` dialect.
   */
  collectionKey?: string;
}

/**
 * Response dialect — selects the list-envelope shape, the error-body shape and
 * the pagination model so a provider's *real* SDK strict-parses the emulator.
 *
 *  - `default` — `{ data, total, model }` + `{ error, message }`; `?limit` /
 *    `?page_size` truncation. Unchanged historical behaviour; the shape every
 *    seed-derived provider used before per-provider parity existed.
 *  - `jira`    — `{ startAt, maxResults, total, <key>: [...] }`; offset
 *    pagination via `?startAt` / `?maxResults`; `{ errorMessages, errors }`.
 *  - `zendesk` — `{ <key>: [...], count, next_page, previous_page }`; offset
 *    pagination via `?page` / `?per_page`; `{ error, description }`.
 *  - `shopify` — `{ <key>: [...] }` + a `Link` response header for cursor
 *    pagination via `?limit` / `?page_info`; `{ errors }`.
 */
export type NativeDialectName = "default" | "jira" | "zendesk" | "shopify";

export interface NativeSpec {
  /** Provider id, matches the seed `provider:` (e.g. "sendgrid"). */
  name: string;
  /** OAuth2 token endpoint path. Defaults to "/oauth/token". */
  tokenPath?: string;
  /** Prefix for the access/refresh token strings (e.g. "sg"). */
  tokenPrefix?: string;
  /** connection_config from the seed (instance_url, api_domain, …) — informational. */
  connectionConfig?: Record<string, unknown>;
  /** Response dialect. Defaults to `"default"`. */
  dialect?: NativeDialectName;
  models: NativeModelSpec[];
}

export interface NativeSeedConfig {
  /** Replace/extend seed rows per model. */
  records?: Record<string, Array<Record<string, unknown>>>;
}

const dataKey = (name: string, model: string): string => `${name}.${model}`;

type Bucket = Map<string, Record<string, unknown>>;

const bucket = (store: Store, name: string, model: string): Bucket => {
  const k = dataKey(name, model);
  let m = store.getData<Bucket>(k);
  if (!m) {
    m = new Map();
    store.setData(k, m);
  }
  return m;
};

const seqKey = (name: string): string => `${name}.__seq`;
const nextId = (store: Store, name: string): string => {
  const n = (store.getData<number>(seqKey(name)) ?? 0) + 1;
  store.setData(seqKey(name), n);
  return String(n);
};

/** Read the id off a row given a model's id field, tolerating string/number. */
const rowId = (row: Record<string, unknown>, idField: string): string | null => {
  const v = row[idField];
  if (v === undefined || v === null) return null;
  return String(v);
};

/** Native APIs are bearer-gated; only the token's presence is enforced. */
const authed = (c: Context): boolean => (c.req.header("Authorization") ?? "").toLowerCase().startsWith("bearer ");

const KNOWN_GRANTS = new Set(["client_credentials", "authorization_code", "password", "refresh_token"]);

/** RFC 6749 §5.2 error body. invalid_client is 401, everything else 400. */
const oauthError = (c: Context, error: string, description: string): Response =>
  c.json({ error, error_description: description }, error === "invalid_client" ? 401 : 400);

/** A value is a deterministic "make this fail" sentinel if it is exactly
 *  `invalid` or begins with `invalid_` / `invalid-` (case-insensitive). This
 *  lets consumers exercise unhappy paths with zero per-spec client config. */
const isInvalidSentinel = (v: string | null): boolean => v != null && /^invalid([_-]|$)/i.test(v);

/**
 * Validate an OAuth2 token request the way a real provider would, *without*
 * breaking the deliberately-lax happy path: a request that simply omits
 * credentials still succeeds (these emulators only enforce token presence on
 * data routes). What this adds is testable failure: an unknown grant, a
 * required-but-absent `code`/`refresh_token`, or any credential set to the
 * reserved `invalid…` sentinel returns the canonical RFC 6749 error. Returns
 * an error Response, or null when the request should mint a token.
 */
function validateGrant(c: Context, params: URLSearchParams): Response | null {
  const grant = params.get("grant_type") ?? "client_credentials";
  if (!KNOWN_GRANTS.has(grant)) {
    return oauthError(c, "unsupported_grant_type", `Unsupported grant_type: ${grant}`);
  }
  const clientId = params.get("client_id");
  const clientSecret = params.get("client_secret");
  if (isInvalidSentinel(clientId) || isInvalidSentinel(clientSecret)) {
    return oauthError(c, "invalid_client", "Client authentication failed");
  }
  if (grant === "authorization_code") {
    const code = params.get("code");
    if (!code) return oauthError(c, "invalid_request", "Missing required parameter: code");
    if (isInvalidSentinel(code)) {
      return oauthError(c, "invalid_grant", "Authorization code is invalid or expired");
    }
  }
  if (grant === "refresh_token") {
    const rt = params.get("refresh_token");
    if (!rt) return oauthError(c, "invalid_request", "Missing required parameter: refresh_token");
    if (isInvalidSentinel(rt)) return oauthError(c, "invalid_grant", "Refresh token is invalid or expired");
  }
  if (grant === "password") {
    const u = params.get("username");
    const pw = params.get("password");
    if (isInvalidSentinel(u) || isInvalidSentinel(pw)) {
      return oauthError(c, "invalid_grant", "Invalid resource owner credentials");
    }
  }
  return null;
}

/** Naive English plural for the dialect collection-key fallback (mirrors the
 *  pluraliser the standalone generator uses): Issue→issues, Project→projects,
 *  Ticket→tickets, User→users, Product→products, Order→orders. */
const plural = (model: string): string => {
  const s = model.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(s)) return /s$/.test(s) ? s : `${s}es`;
  if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
};

const collectionKey = (m: NativeModelSpec): string => m.collectionKey ?? plural(m.model);

/** A positive integer query param, else the fallback. */
const intParam = (c: Context, name: string, fallback: number): number => {
  const n = Number(c.req.query(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

interface Dialect {
  /** Build the list response for one model (owns its own pagination model). */
  list(c: Context, rows: Array<Record<string, unknown>>, m: NativeModelSpec): Response;
  unauthorized(c: Context): Response;
  notFound(c: Context, id: string): Response;
}

const DEFAULT_DIALECT: Dialect = {
  list(c, rows, m) {
    const limit = Number(c.req.query("limit") ?? c.req.query("page_size") ?? 0);
    const out = limit > 0 ? rows.slice(0, limit) : rows;
    return c.json({ data: out, total: rows.length, model: m.model });
  },
  unauthorized: (c) => c.json({ error: "unauthorized", message: "Missing or invalid bearer token" }, 401),
  notFound: (c, id) => c.json({ error: "not_found", message: `No such resource: ${id}` }, 404),
};

// Jira (REST v3): search-style offset envelope; the official jira.js / Atlassian
// SDKs read `issues`/`values`, `startAt`, `maxResults`, `total`. Errors are the
// canonical `{ errorMessages: string[], errors: {} }`.
const JIRA_DIALECT: Dialect = {
  list(c, rows, m) {
    const startAt = intParam(c, "startAt", 0);
    const maxResults = intParam(c, "maxResults", 50);
    const page = rows.slice(startAt, startAt + maxResults);
    return c.json({ startAt, maxResults, total: rows.length, [collectionKey(m)]: page });
  },
  unauthorized: (c) =>
    c.json({ errorMessages: ["Client must be authenticated to access this resource."], errors: {} }, 401),
  notFound: (c, id) =>
    c.json({ errorMessages: [`Issue does not exist or you do not have permission to see it: ${id}`], errors: {} }, 404),
};

// Zendesk (API v2): `{ <resource>: [...], count, next_page, previous_page }`
// with absolute page URLs; offset pagination via `?page` / `?per_page`.
const ZENDESK_DIALECT: Dialect = {
  list(c, rows, m) {
    const perPage = intParam(c, "per_page", 100);
    const pageNo = intParam(c, "page", 1);
    const start = (pageNo - 1) * perPage;
    const slice = rows.slice(start, start + perPage);
    const pageUrl = (p: number): string => {
      const u = new URL(c.req.url);
      u.searchParams.set("page", String(p));
      u.searchParams.set("per_page", String(perPage));
      return u.toString();
    };
    const hasNext = start + slice.length < rows.length;
    return c.json({
      [collectionKey(m)]: slice,
      count: rows.length,
      next_page: hasNext ? pageUrl(pageNo + 1) : null,
      previous_page: pageNo > 1 ? pageUrl(pageNo - 1) : null,
    });
  },
  unauthorized: (c) => c.json({ error: "Couldn't authenticate you" }, 401),
  notFound: (c, id) => c.json({ error: "RecordNotFound", description: `Not found: ${id}` }, 404),
};

// Shopify (Admin REST 2024-01): `{ <resource>: [...] }` body, cursor pagination
// via an opaque `page_info` token carried in a `Link` response header.
const b64 = (n: number): string => Buffer.from(String(n)).toString("base64url");
const unB64 = (s: string | undefined): number => {
  if (!s) return 0;
  const n = Number(Buffer.from(s, "base64url").toString());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const SHOPIFY_DIALECT: Dialect = {
  list(c, rows, m) {
    const limit = Math.min(250, intParam(c, "limit", 50));
    const start = unB64(c.req.query("page_info"));
    const slice = rows.slice(start, start + limit);
    const url = new URL(c.req.url);
    const link = (offset: number, rel: string): string => {
      const u = new URL(url);
      u.searchParams.set("limit", String(limit));
      u.searchParams.set("page_info", b64(offset));
      return `<${u.toString()}>; rel="${rel}"`;
    };
    const links: string[] = [];
    if (start + slice.length < rows.length) links.push(link(start + slice.length, "next"));
    if (start > 0) links.push(link(Math.max(0, start - limit), "previous"));
    const headers: Record<string, string> = links.length > 0 ? { Link: links.join(", ") } : {};
    return c.json({ [collectionKey(m)]: slice }, 200, headers);
  },
  unauthorized: (c) =>
    c.json({ errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" }, 401),
  notFound: (c, id) => c.json({ errors: `Not Found: ${id}` }, 404),
};

const DIALECTS: Record<NativeDialectName, Dialect> = {
  default: DEFAULT_DIALECT,
  jira: JIRA_DIALECT,
  zendesk: ZENDESK_DIALECT,
  shopify: SHOPIFY_DIALECT,
};

function loadSeed(store: Store, spec: NativeSpec, models: NativeModelSpec[]): void {
  for (const m of models) {
    const b = bucket(store, spec.name, m.model);
    for (const row of m.rows) {
      const id = rowId(row, m.idField) ?? nextId(store, spec.name);
      if (!b.has(id)) b.set(id, { ...row, [m.idField]: id });
    }
  }
}

/**
 * Build a standalone direct-to-source plugin from a provider spec, plus the
 * `seedFromConfig` / `storeToSeedConfig` round-trip pair every emulate package
 * exposes. The plugin's default `seed()` loads the embedded seed slice.
 */
export function makeNativePlugin(spec: NativeSpec): {
  plugin: ServicePlugin;
  seedFromConfig: (store: Store, baseUrl: string, config: NativeSeedConfig) => void;
  storeToSeedConfig: (store: Store, baseUrl: string) => NativeSeedConfig;
} {
  const tokenPath = spec.tokenPath ?? "/oauth/token";
  const tokenPrefix = spec.tokenPrefix ?? spec.name.replace(/[^a-z0-9]/gi, "").slice(0, 4);
  const D = DIALECTS[spec.dialect ?? "default"];

  const modelByPath = new Map<string, NativeModelSpec>();
  for (const m of spec.models) modelByPath.set(m.collectionPath, m);

  const seedFromConfig = (store: Store, _baseUrl: string, config: NativeSeedConfig): void => {
    const merged = spec.models.map((m) => ({
      ...m,
      rows: config.records?.[m.model] ?? m.rows,
    }));
    loadSeed(store, spec, merged);
  };

  const storeToSeedConfig = (store: Store, _baseUrl: string): NativeSeedConfig => {
    const records: Record<string, Array<Record<string, unknown>>> = {};
    for (const m of spec.models) {
      const rows = [...bucket(store, spec.name, m.model).values()];
      if (rows.length > 0) records[m.model] = rows;
    }
    return { records };
  };

  const plugin: ServicePlugin = {
    name: spec.name,
    register(app: Hono<AppEnv>, store: Store, _webhooks: WebhookDispatcher, _baseUrl: string, _tokenMap?: TokenMap) {
      app.get("/health", (c) => c.json({ ok: true, provider: spec.name, native: true }));

      // Discovery: model → native collection path + live row count. Powers the
      // server's provider-browser inspector; harmless for direct consumers.
      app.get("/_models", (c) =>
        c.json({
          provider: spec.name,
          tokenPath,
          models: spec.models.map((m) => ({
            model: m.model,
            collectionPath: m.collectionPath,
            idField: m.idField,
            count: bucket(store, spec.name, m.model).size,
          })),
        }),
      );

      // OAuth2 token endpoint. The happy path stays lax (missing credentials
      // still mint a token), but unknown grants, an absent required
      // code/refresh_token, or a reserved `invalid…` credential return the
      // canonical RFC 6749 error so failure flows are testable.
      app.post(tokenPath, async (c) => {
        const params = new URLSearchParams(await c.req.text().catch(() => ""));
        const grantError = validateGrant(c, params);
        if (grantError) return grantError;
        const grant = params.get("grant_type") ?? "client_credentials";
        const rnd = () => Math.random().toString(16).slice(2).padEnd(24, "0").slice(0, 24);
        return c.json({
          access_token: `${tokenPrefix}_at_${rnd()}`,
          refresh_token: `${tokenPrefix}_rt_${rnd()}`,
          token_type: "bearer",
          expires_in: 3600,
          scope: params.get("scope") ?? "read write",
          grant_type: grant,
        });
      });

      for (const m of spec.models) {
        const col = m.collectionPath;

        // List collection (envelope + pagination per the provider's dialect).
        app.get(col, (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const rows = [...bucket(store, spec.name, m.model).values()];
          return D.list(c, rows, m);
        });

        // Create.
        app.post(col, async (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
          const id = rowId(body, m.idField) ?? nextId(store, spec.name);
          const row = { ...body, [m.idField]: id };
          bucket(store, spec.name, m.model).set(id, row);
          return c.json(row, 201);
        });

        // Read one.
        app.get(`${col}/:id`, (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const id = c.req.param("id");
          const row = bucket(store, spec.name, m.model).get(id);
          if (!row) return D.notFound(c, id);
          return c.json(row);
        });

        // Update.
        app.patch(`${col}/:id`, async (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const id = c.req.param("id");
          const b = bucket(store, spec.name, m.model);
          const row = b.get(id);
          if (!row) return D.notFound(c, id);
          const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
          const next = { ...row, ...patch, [m.idField]: id };
          b.set(id, next);
          return c.json(next);
        });
        app.put(`${col}/:id`, async (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const id = c.req.param("id");
          const b = bucket(store, spec.name, m.model);
          const row = b.get(id);
          if (!row) return D.notFound(c, id);
          const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
          const next = { ...row, ...patch, [m.idField]: id };
          b.set(id, next);
          return c.json(next);
        });

        // Delete.
        app.delete(`${col}/:id`, (c) => {
          if (!authed(c)) return D.unauthorized(c);
          const id = c.req.param("id");
          const b = bucket(store, spec.name, m.model);
          if (!b.has(id)) return D.notFound(c, id);
          b.delete(id);
          return c.body(null, 204);
        });
      }
    },
    seed(store: Store, _baseUrl: string) {
      loadSeed(store, spec, spec.models);
    },
  };

  return { plugin, seedFromConfig, storeToSeedConfig };
}
