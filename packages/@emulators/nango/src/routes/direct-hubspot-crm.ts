// Direct HubSpot CRM v3/v4 emulator routes (mounted under the nango plugin
// alongside the OAuth routes in direct-hubspot.ts). This is the stateful
// object API a real integration exercises against HubSpot:
//
//   POST   /hubspot-emu/crm/v3/objects/:type                 → create
//   GET    /hubspot-emu/crm/v3/objects/:type                 → list (paged)
//   GET    /hubspot-emu/crm/v3/objects/:type/:id             → read
//   PATCH  /hubspot-emu/crm/v3/objects/:type/:id             → update
//   DELETE /hubspot-emu/crm/v3/objects/:type/:id             → archive
//   POST   /hubspot-emu/crm/v3/objects/:type/search          → CRM Search
//   POST   /hubspot-emu/crm/v3/objects/:type/batch/{create,read,update,archive}
//   PUT    /hubspot-emu/crm/v4/objects/:ft/:fid/associations/:tt/:tid
//   GET    /hubspot-emu/crm/v4/objects/:ft/:fid/associations/:tt
//   DELETE /hubspot-emu/crm/v4/objects/:ft/:fid/associations/:tt/:tid
//
// State lives in the shared store under "hubspot.crm.*" so /reset clears it.
// HubSpot object ids are stringified integers; createdAt/updatedAt are ISO.

import type { Context } from "hono";
import type { Hono } from "hono";
import type { AppEnv, Store } from "@emulators/core";

interface HsObject {
  id: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

interface Assoc {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
}

type ObjectsByType = Map<string, Map<string, HsObject>>;

const OBJECTS_KEY = "hubspot.crm.objects";
const SEQ_KEY = "hubspot.crm.seq";
const ASSOC_KEY = "hubspot.crm.assoc";

const getObjects = (store: Store): ObjectsByType => {
  let m = store.getData<ObjectsByType>(OBJECTS_KEY);
  if (!m) {
    m = new Map();
    store.setData(OBJECTS_KEY, m);
  }
  return m;
};

const getAssocs = (store: Store): Assoc[] => {
  let a = store.getData<Assoc[]>(ASSOC_KEY);
  if (!a) {
    a = [];
    store.setData(ASSOC_KEY, a);
  }
  return a;
};

const nextId = (store: Store): string => {
  const n = (store.getData<number>(SEQ_KEY) ?? 0) + 1;
  store.setData(SEQ_KEY, n);
  return String(n);
};

const typeBucket = (store: Store, type: string): Map<string, HsObject> => {
  const objects = getObjects(store);
  let bucket = objects.get(type);
  if (!bucket) {
    bucket = new Map();
    objects.set(type, bucket);
  }
  return bucket;
};

const unauthorized = (c: Context) =>
  c.json(
    {
      status: "error",
      message: "Authentication credentials not found. This API supports OAuth 2.0 authentication.",
      category: "INVALID_AUTHENTICATION",
    },
    401,
  );

const notFound = (c: Context, id: string) =>
  c.json({ status: "error", message: `resource not found: ${id}`, category: "OBJECT_NOT_FOUND" }, 404);

/** HubSpot accepts any Bearer access token; only its presence is enforced. */
const authed = (c: Context): boolean => (c.req.header("Authorization") ?? "").toLowerCase().startsWith("bearer ");

const view = (o: HsObject): HsObject => ({
  id: o.id,
  properties: { ...o.properties },
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  archived: o.archived,
});

function matchesFilter(o: HsObject, f: { propertyName: string; operator: string; value?: unknown }): boolean {
  const actual = o.properties[f.propertyName];
  const want = f.value;
  switch (f.operator) {
    case "EQ":
      return String(actual) === String(want);
    case "NEQ":
      return String(actual) !== String(want);
    case "CONTAINS_TOKEN":
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(want ?? "").toLowerCase());
    case "GT":
      return Number(actual) > Number(want);
    case "GTE":
      return Number(actual) >= Number(want);
    case "LT":
      return Number(actual) < Number(want);
    case "LTE":
      return Number(actual) <= Number(want);
    case "HAS_PROPERTY":
      return actual !== undefined && actual !== null && actual !== "";
    case "NOT_HAS_PROPERTY":
      return actual === undefined || actual === null || actual === "";
    default:
      return false;
  }
}

export const directHubspotCrmRoutes = (app: Hono<AppEnv>, store: Store): void => {
  const base = "/hubspot-emu/crm";

  // ---- Batch (must precede /:type/:id) ----------------------------------

  app.post(`${base}/v3/objects/:type/batch/create`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const body = (await c.req.json().catch(() => ({}))) as { inputs?: Array<{ properties?: Record<string, unknown> }> };
    const bucket = typeBucket(store, type);
    const now = new Date().toISOString();
    const results = (body.inputs ?? []).map((input) => {
      const obj: HsObject = {
        id: nextId(store),
        properties: { ...(input.properties ?? {}) },
        createdAt: now,
        updatedAt: now,
        archived: false,
      };
      bucket.set(obj.id, obj);
      return view(obj);
    });
    return c.json({ status: "COMPLETE", results }, 201);
  });

  app.post(`${base}/v3/objects/:type/batch/read`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const bucket = typeBucket(store, c.req.param("type"));
    const body = (await c.req.json().catch(() => ({}))) as { inputs?: Array<{ id: string | number }> };
    const results = (body.inputs ?? [])
      .map((i) => bucket.get(String(i.id)))
      .filter((o): o is HsObject => !!o && !o.archived)
      .map(view);
    return c.json({ status: "COMPLETE", results });
  });

  app.post(`${base}/v3/objects/:type/batch/update`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const bucket = typeBucket(store, c.req.param("type"));
    const body = (await c.req.json().catch(() => ({}))) as {
      inputs?: Array<{ id: string | number; properties?: Record<string, unknown> }>;
    };
    const now = new Date().toISOString();
    const results: HsObject[] = [];
    for (const i of body.inputs ?? []) {
      const obj = bucket.get(String(i.id));
      if (!obj) continue;
      obj.properties = { ...obj.properties, ...(i.properties ?? {}) };
      obj.updatedAt = now;
      results.push(view(obj));
    }
    return c.json({ status: "COMPLETE", results });
  });

  app.post(`${base}/v3/objects/:type/batch/archive`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const bucket = typeBucket(store, c.req.param("type"));
    const body = (await c.req.json().catch(() => ({}))) as { inputs?: Array<{ id: string | number }> };
    for (const i of body.inputs ?? []) {
      const obj = bucket.get(String(i.id));
      if (obj) obj.archived = true;
    }
    return c.body(null, 204);
  });

  // ---- CRM Search (must precede /:type/:id) -----------------------------

  app.post(`${base}/v3/objects/:type/search`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const bucket = typeBucket(store, c.req.param("type"));
    const body = (await c.req.json().catch(() => ({}))) as {
      filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value?: unknown }> }>;
      query?: string;
      limit?: number;
      after?: string | number;
      properties?: string[];
    };
    let rows = [...bucket.values()].filter((o) => !o.archived);

    const groups = body.filterGroups ?? [];
    if (groups.length > 0) {
      rows = rows.filter((o) => groups.some((g) => (g.filters ?? []).every((f) => matchesFilter(o, f))));
    }
    if (body.query) {
      const q = body.query.toLowerCase();
      rows = rows.filter((o) => Object.values(o.properties).some((v) => String(v).toLowerCase().includes(q)));
    }

    const total = rows.length;
    const limit = Number(body.limit) > 0 ? Number(body.limit) : 100;
    const start = Number(body.after) > 0 ? Number(body.after) : 0;
    const page = rows.slice(start, start + limit);
    const out: Record<string, unknown> = { total, results: page.map(view) };
    if (start + page.length < total) out.paging = { next: { after: String(start + page.length) } };
    return c.json(out);
  });

  // ---- v4 associations (precede generic v3 /:type/:id) ------------------

  app.put(`${base}/v4/objects/:ft/:fid/associations/:tt/:tid`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const a: Assoc = {
      fromType: c.req.param("ft"),
      fromId: c.req.param("fid"),
      toType: c.req.param("tt"),
      toId: c.req.param("tid"),
    };
    const assocs = getAssocs(store);
    if (
      !assocs.some(
        (x) => x.fromType === a.fromType && x.fromId === a.fromId && x.toType === a.toType && x.toId === a.toId,
      )
    ) {
      assocs.push(a);
    }
    return c.json({
      fromObjectTypeId: a.fromType,
      fromObjectId: a.fromId,
      toObjectTypeId: a.toType,
      toObjectId: a.toId,
      labels: [],
    });
  });

  app.delete(`${base}/v4/objects/:ft/:fid/associations/:tt/:tid`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const ft = c.req.param("ft");
    const fid = c.req.param("fid");
    const tt = c.req.param("tt");
    const tid = c.req.param("tid");
    const assocs = getAssocs(store);
    const idx = assocs.findIndex((x) => x.fromType === ft && x.fromId === fid && x.toType === tt && x.toId === tid);
    if (idx >= 0) assocs.splice(idx, 1);
    return c.body(null, 204);
  });

  app.get(`${base}/v4/objects/:ft/:fid/associations/:tt`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const ft = c.req.param("ft");
    const fid = c.req.param("fid");
    const tt = c.req.param("tt");
    const results = getAssocs(store)
      .filter((x) => x.fromType === ft && x.fromId === fid && x.toType === tt)
      .map((x) => ({
        toObjectId: x.toId,
        associationTypes: [{ category: "USER_DEFINED", typeId: 1, label: null }],
      }));
    return c.json({ results });
  });

  // ---- Object collection -------------------------------------------------

  app.get(`${base}/v3/objects/:type`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const bucket = typeBucket(store, c.req.param("type"));
    const rows = [...bucket.values()].filter((o) => !o.archived);
    const limit = Number(c.req.query("limit")) > 0 ? Number(c.req.query("limit")) : 100;
    const start = Number(c.req.query("after")) > 0 ? Number(c.req.query("after")) : 0;
    const page = rows.slice(start, start + limit);
    const out: Record<string, unknown> = { results: page.map(view) };
    if (start + page.length < rows.length) {
      out.paging = { next: { after: String(start + page.length) } };
    }
    return c.json(out);
  });

  app.post(`${base}/v3/objects/:type`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const type = c.req.param("type");
    const body = (await c.req.json().catch(() => ({}))) as { properties?: Record<string, unknown> };
    const now = new Date().toISOString();
    const obj: HsObject = {
      id: nextId(store),
      properties: { ...(body.properties ?? {}) },
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    typeBucket(store, type).set(obj.id, obj);
    return c.json(view(obj), 201);
  });

  // ---- Single object -----------------------------------------------------

  app.get(`${base}/v3/objects/:type/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const id = c.req.param("id");
    const obj = typeBucket(store, c.req.param("type")).get(id);
    if (!obj || obj.archived) return notFound(c, id);
    return c.json(view(obj));
  });

  app.patch(`${base}/v3/objects/:type/:id`, async (c) => {
    if (!authed(c)) return unauthorized(c);
    const id = c.req.param("id");
    const obj = typeBucket(store, c.req.param("type")).get(id);
    if (!obj || obj.archived) return notFound(c, id);
    const body = (await c.req.json().catch(() => ({}))) as { properties?: Record<string, unknown> };
    obj.properties = { ...obj.properties, ...(body.properties ?? {}) };
    obj.updatedAt = new Date().toISOString();
    return c.json(view(obj));
  });

  app.delete(`${base}/v3/objects/:type/:id`, (c) => {
    if (!authed(c)) return unauthorized(c);
    const id = c.req.param("id");
    const obj = typeBucket(store, c.req.param("type")).get(id);
    if (!obj || obj.archived) return notFound(c, id);
    obj.archived = true;
    return c.body(null, 204);
  });
};
