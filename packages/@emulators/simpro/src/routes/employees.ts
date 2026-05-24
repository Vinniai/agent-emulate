import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproEmployee } from "../entities.js";
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

function formatEmployee(e: SimproEmployee) {
  return {
    ID: e.external_id,
    GivenName: e.given_name,
    FamilyName: e.family_name,
    Name: `${e.given_name} ${e.family_name}`,
    Email: e.email,
    Phone: { Work: e.phone, Mobile: null, Fax: null },
    Active: e.active,
    Archived: e.archived,
    AccountSetup: { Email: e.email },
    DateModified: null,
  };
}

export function employeeRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // GET /employees/
  app.get("/api/v1.0/companies/:cid/employees/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.employees.all().filter((e) => e.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.given_name.toLowerCase().includes(q) ||
          e.family_name.toLowerCase().includes(q) ||
          (e.email ?? "").toLowerCase().includes(q),
      );
    }
    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((e) => e.archived);
    else if (archived !== "all") items = items.filter((e) => !e.archived);
    const active = c.req.query("Active");
    if (active === "true") items = items.filter((e) => e.active);
    else if (active === "false") items = items.filter((e) => !e.active);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatEmployee));
  });

  // GET /employees/:id
  app.get("/api/v1.0/companies/:cid/employees/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const e = ss.employees.findOneBy("external_id", Number(c.req.param("id")));
    if (!e) return simproNotFound(c);
    return c.json(formatEmployee(e));
  });

  // POST /employees/
  app.post("/api/v1.0/companies/:cid/employees/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.GivenName) return simproValidation(c, "GivenName", "GivenName is required.");
    if (!body.FamilyName) return simproValidation(c, "FamilyName", "FamilyName is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "employees", companyId);
    const e = ss.employees.insert({
      company_id: companyId,
      external_id: externalId,
      given_name: body.GivenName as string,
      family_name: body.FamilyName as string,
      email: (body.Email as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      active: body.Active !== undefined ? Boolean(body.Active) : true,
      archived: false,
    });
    return c.json(formatEmployee(e), 201);
  });

  // PATCH /employees/:id
  app.patch("/api/v1.0/companies/:cid/employees/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const e = ss.employees.findOneBy("external_id", Number(c.req.param("id")));
    if (!e) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.employees.update(e.id, {
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.Active !== undefined && { active: Boolean(body.Active) }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  // DELETE /employees/:id
  app.delete("/api/v1.0/companies/:cid/employees/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const e = ss.employees.findOneBy("external_id", Number(c.req.param("id")));
    if (!e) return simproNotFound(c);
    ss.employees.delete(e.id);
    return c.body(null, 204);
  });

  // GET /employees/:id/timesheets/ — stub
  app.get("/api/v1.0/companies/:cid/employees/:id/timesheets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const e = ss.employees.findOneBy("external_id", Number(c.req.param("id")));
    if (!e) return simproNotFound(c);
    return c.json([]);
  });

  // GET /staff/ — alias, GET only
  app.get("/api/v1.0/companies/:cid/staff/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.employees.all().filter((e) => e.company_id === companyId || companyId === 0);
    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((e) => e.archived);
    else if (archived !== "all") items = items.filter((e) => !e.archived);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatEmployee));
  });

  // GET /staff/:id — alias, GET only
  app.get("/api/v1.0/companies/:cid/staff/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const e = ss.employees.findOneBy("external_id", Number(c.req.param("id")));
    if (!e) return simproNotFound(c);
    return c.json(formatEmployee(e));
  });
}
