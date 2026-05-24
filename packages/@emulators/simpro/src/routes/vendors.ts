import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import {
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
} from "../helpers.js";
import { formatVendor } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function vendorRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/vendors/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendors.all().filter((v) => v.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((v) => v.name.toLowerCase().includes(q));
    }
    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((v) => v.archived);
    else if (archived !== "all") items = items.filter((v) => !v.archived);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendor));
  });

  app.get("/api/v1.0/companies/:cid/vendors/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const v = ss.vendors.findOneBy("external_id", Number(c.req.param("id")));
    if (!v) return simproNotFound(c);
    return c.json(formatVendor(v));
  });

  app.post("/api/v1.0/companies/:cid/vendors/", async (c) => {
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
    const externalId = nextExternalId(ss, "vendors", companyId);
    const v = ss.vendors.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      ein: (body.EIN as string | null) ?? null,
      company_no: (body.CompanyNo as string | null) ?? null,
      website: (body.Website as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      fax: (body.Fax as string | null) ?? null,
      address: (body.Address as Record<string, string> | null) ?? null,
      archived: false,
    });
    return c.json(formatVendor(v), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendors/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const v = ss.vendors.findOneBy("external_id", Number(c.req.param("id")));
    if (!v) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendors.update(v.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.EIN !== undefined && { ein: body.EIN as string | null }),
      ...(body.CompanyNo !== undefined && { company_no: body.CompanyNo as string | null }),
      ...(body.Website !== undefined && { website: body.Website as string | null }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.Fax !== undefined && { fax: body.Fax as string | null }),
      ...(body.Address !== undefined && { address: body.Address as Record<string, string> | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendors/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const v = ss.vendors.findOneBy("external_id", Number(c.req.param("id")));
    if (!v) return simproNotFound(c);
    ss.vendors.delete(v.id);
    return c.body(null, 204);
  });
}
