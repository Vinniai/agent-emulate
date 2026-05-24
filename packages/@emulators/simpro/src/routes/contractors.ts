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
import { formatContractor } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function contractorRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/contractors/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.contractors.all().filter((x) => x.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((x) =>
        `${x.given_name ?? ""} ${x.family_name ?? ""} ${x.company_name ?? ""}`.toLowerCase().includes(q),
      );
    }
    const archived = c.req.query("Archived");
    if (archived !== undefined) items = items.filter((x) => x.archived === (archived === "true"));
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatContractor));
  });

  app.get("/api/v1.0/companies/:cid/contractors/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contractor = ss.contractors.findOneBy("external_id", Number(c.req.param("id")));
    if (!contractor) return simproNotFound(c);
    return c.json(formatContractor(contractor));
  });

  app.post("/api/v1.0/companies/:cid/contractors/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.CompanyName && !body.GivenName)
      return simproValidation(c, "CompanyName", "CompanyName or GivenName is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "contractors", companyId);
    const contractor = ss.contractors.insert({
      company_id: companyId,
      external_id: externalId,
      company_name: (body.CompanyName as string | null) ?? null,
      given_name: (body.GivenName as string | null) ?? null,
      family_name: (body.FamilyName as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      cell_phone: (body.CellPhone as string | null) ?? null,
      fax: (body.Fax as string | null) ?? null,
      address: (body.Address as Record<string, string> | null) ?? null,
      archived: false,
    });
    return c.json(formatContractor(contractor), 201);
  });

  app.patch("/api/v1.0/companies/:cid/contractors/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contractor = ss.contractors.findOneBy("external_id", Number(c.req.param("id")));
    if (!contractor) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.contractors.update(contractor.id, {
      ...(body.CompanyName !== undefined && { company_name: body.CompanyName as string | null }),
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string | null }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string | null }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.CellPhone !== undefined && { cell_phone: body.CellPhone as string | null }),
      ...(body.Fax !== undefined && { fax: body.Fax as string | null }),
      ...(body.Address !== undefined && { address: body.Address as Record<string, string> | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/contractors/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contractor = ss.contractors.findOneBy("external_id", Number(c.req.param("id")));
    if (!contractor) return simproNotFound(c);
    ss.contractors.delete(contractor.id);
    return c.body(null, 204);
  });
}
