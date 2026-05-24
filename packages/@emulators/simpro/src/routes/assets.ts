import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
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
import { formatAsset } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function assetRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/assets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.assets.all().filter((a) => a.company_id === companyId || companyId === 0);

    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((a) => a.customer_id === Number(customerId));

    const siteId = c.req.query("Site.ID");
    if (siteId) items = items.filter((a) => a.site_id === Number(siteId));

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((a) => formatAsset(a, ss)));
  });

  app.get("/api/v1.0/companies/:cid/assets/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.assets.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    return c.json(formatAsset(a, ss));
  });

  app.post("/api/v1.0/companies/:cid/assets/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const customerRef = body.Customer as { ID?: number } | undefined;
    if (!customerRef?.ID) return simproValidation(c, "Customer.ID", "Customer is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "assets", companyId);
    const now = nowIso();
    const a = ss.assets.insert({
      company_id: companyId,
      external_id: externalId,
      customer_id: customerRef.ID,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      name: (body.Name as string) ?? `Asset ${externalId}`,
      description: (body.Description as string | null) ?? null,
      asset_type: (body.AssetType as string | null) ?? null,
      serial_number: (body.SerialNo as string | null) ?? null,
      status: (body.Status as string | null) ?? null,
      notes: (body.Notes as string | null) ?? null,
      date_installed: (body.DateInstalled as string | null) ?? null,
      date_next_service: (body.DateNextService as string | null) ?? null,
      date_modified: now,
    });
    return c.json(formatAsset(a, ss), 201);
  });

  app.patch("/api/v1.0/companies/:cid/assets/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.assets.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.assets.update(a.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.AssetType !== undefined && { asset_type: body.AssetType as string | null }),
      ...(body.SerialNo !== undefined && { serial_number: body.SerialNo as string | null }),
      ...(body.Status !== undefined && { status: body.Status as string | null }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
      ...(body.DateInstalled !== undefined && { date_installed: body.DateInstalled as string | null }),
      ...(body.DateNextService !== undefined && { date_next_service: body.DateNextService as string | null }),
      ...(body.Site !== undefined && { site_id: (body.Site as { ID?: number }).ID ?? null }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.put("/api/v1.0/companies/:cid/assets/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.assets.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const updated = ss.assets.update(a.id, {
      customer_id: (body.Customer as { ID?: number } | undefined)?.ID ?? a.customer_id,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      name: (body.Name as string) ?? a.name,
      description: (body.Description as string | null) ?? null,
      asset_type: (body.AssetType as string | null) ?? null,
      serial_number: (body.SerialNo as string | null) ?? null,
      status: (body.Status as string | null) ?? null,
      notes: (body.Notes as string | null) ?? null,
      date_installed: (body.DateInstalled as string | null) ?? null,
      date_next_service: (body.DateNextService as string | null) ?? null,
      date_modified: nowIso(),
    })!;
    return c.json(formatAsset(updated, ss));
  });

  app.delete("/api/v1.0/companies/:cid/assets/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.assets.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    ss.assets.delete(a.id);
    return c.body(null, 204);
  });

  // /customerAssets/ alias used by some SimPro API consumers
  app.get("/api/v1.0/companies/:cid/customerAssets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.assets.all().filter((a) => a.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((a) => a.customer_id === Number(customerId));
    const siteId = c.req.query("Site.ID");
    if (siteId) items = items.filter((a) => a.site_id === Number(siteId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((a) => formatAsset(a, ss)));
  });

  app.get("/api/v1.0/companies/:cid/customerAssets/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.assets.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    return c.json(formatAsset(a, ss));
  });
}
