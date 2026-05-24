import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproPrebuild, SimproPrebuildGroup } from "../entities.js";
import {
  nowIso,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
} from "../helpers.js";
import { nextExternalId } from "./jobs.js";

function formatPrebuild(p: SimproPrebuild) {
  return {
    ID: p.external_id,
    Name: p.name,
    Description: p.description,
    Archived: p.archived,
    DateModified: p.date_modified,
  };
}

function formatPrebuildGroup(g: SimproPrebuildGroup) {
  return { ID: g.external_id, Name: g.name };
}

export function prebuildRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ──────────────────────────────────────────────────────────────
  // Prebuilds
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/prebuilds/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.prebuilds.all().filter((p) => p.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(q));
    }
    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((p) => p.archived);
    else if (archived !== "all") items = items.filter((p) => !p.archived);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPrebuild));
  });

  app.get("/api/v1.0/companies/:cid/prebuilds/:pid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.prebuilds.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p) return simproNotFound(c);
    return c.json(formatPrebuild(p));
  });

  app.post("/api/v1.0/companies/:cid/prebuilds/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "prebuilds", companyId);
    const p = ss.prebuilds.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      description: (body.Description as string | null) ?? null,
      archived: false,
      date_modified: nowIso(),
    });
    return c.json(formatPrebuild(p), 201);
  });

  app.patch("/api/v1.0/companies/:cid/prebuilds/:pid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.prebuilds.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.prebuilds.update(p.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/prebuilds/:pid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.prebuilds.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p) return simproNotFound(c);
    ss.prebuilds.delete(p.id);
    return c.body(null, 204);
  });

  // Prebuild catalog items
  app.get("/api/v1.0/companies/:cid/prebuilds/:pid/catalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const pid = Number(c.req.param("pid"));
    const items = ss.prebuildItems.findBy("prebuild_id", pid);
    return c.json(
      paginate(c, items, parsePagination(c)).map((item) => ({
        ID: item.external_id,
        Prebuild: { ID: item.prebuild_id },
        Name: item.name,
        Quantity: item.quantity,
        CostPrice: item.cost_price,
        Markup: item.markup,
        SellPrice: item.sell_price,
        ExTax: item.ex_tax,
      })),
    );
  });

  app.get("/api/v1.0/companies/:cid/prebuilds/:pid/catalogs/:catid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const pid = Number(c.req.param("pid"));
    const item = ss.prebuildItems.findOneBy("external_id", Number(c.req.param("catid")));
    if (!item || item.prebuild_id !== pid) return simproNotFound(c);
    return c.json({
      ID: item.external_id,
      Prebuild: { ID: item.prebuild_id },
      Name: item.name,
      Quantity: item.quantity,
      CostPrice: item.cost_price,
      Markup: item.markup,
      SellPrice: item.sell_price,
      ExTax: item.ex_tax,
    });
  });

  app.post("/api/v1.0/companies/:cid/prebuilds/:pid/catalogs/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const pid = Number(c.req.param("pid"));
    const prebuild = ss.prebuilds.findOneBy("external_id", pid);
    if (!prebuild) return simproNotFound(c);
    const externalId = nextExternalId(ss, "prebuildItems", companyId);
    const item = ss.prebuildItems.insert({
      company_id: companyId,
      external_id: externalId,
      cost_center_id: 0,
      prebuild_id: pid,
      name: (body.Name as string) ?? "",
      quantity: Number(body.Quantity ?? 1),
      cost_price: Number(body.CostPrice ?? 0),
      markup: Number(body.Markup ?? 0),
      sell_price: Number(body.SellPrice ?? 0),
      ex_tax: Number(body.ExTax ?? 0),
    });
    return c.json(
      {
        ID: item.external_id,
        Prebuild: { ID: item.prebuild_id },
        Name: item.name,
        Quantity: item.quantity,
        CostPrice: item.cost_price,
        Markup: item.markup,
        SellPrice: item.sell_price,
        ExTax: item.ex_tax,
      },
      201,
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Prebuild Groups
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/prebuildGroups/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.prebuildGroups.all().filter((g) => g.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPrebuildGroup));
  });

  app.get("/api/v1.0/companies/:cid/prebuildGroups/:gid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.prebuildGroups.findOneBy("external_id", Number(c.req.param("gid")));
    if (!g) return simproNotFound(c);
    return c.json(formatPrebuildGroup(g));
  });

  app.post("/api/v1.0/companies/:cid/prebuildGroups/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "prebuildGroups", companyId);
    const g = ss.prebuildGroups.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      parent_group_id: (body.ParentGroup as { ID?: number } | undefined)?.ID ?? null,
    });
    return c.json(formatPrebuildGroup(g), 201);
  });

  app.patch("/api/v1.0/companies/:cid/prebuildGroups/:gid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.prebuildGroups.findOneBy("external_id", Number(c.req.param("gid")));
    if (!g) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.prebuildGroups.update(g.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.ParentGroup !== undefined && {
        parent_group_id: (body.ParentGroup as { ID?: number } | null)?.ID ?? null,
      }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/prebuildGroups/:gid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.prebuildGroups.findOneBy("external_id", Number(c.req.param("gid")));
    if (!g) return simproNotFound(c);
    ss.prebuildGroups.delete(g.id);
    return c.body(null, 204);
  });

  app.get("/api/v1.0/companies/:cid/prebuildGroups/:gid/subGroups/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const gid = Number(c.req.param("gid"));
    const children = ss.prebuildGroups.all().filter((g) => g.parent_group_id === gid);
    return c.json(paginate(c, children, parsePagination(c)).map(formatPrebuildGroup));
  });
}
