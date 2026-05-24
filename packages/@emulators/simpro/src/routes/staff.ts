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
import { formatStaff } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function staffRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/staff/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.staff.all().filter((s) => s.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (s) =>
          `${s.given_name} ${s.family_name}`.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
      );
    }
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStaff));
  });

  app.get("/api/v1.0/companies/:cid/staff/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const staff = ss.staff.findOneBy("external_id", Number(c.req.param("id")));
    if (!staff) return simproNotFound(c);
    return c.json(formatStaff(staff));
  });

  app.post("/api/v1.0/companies/:cid/staff/", async (c) => {
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
    const externalId = nextExternalId(ss, "staff", companyId);
    const s = ss.staff.insert({
      company_id: companyId,
      external_id: externalId,
      given_name: body.GivenName as string,
      family_name: body.FamilyName as string,
      email: (body.Email as string | null) ?? null,
      active: (body.Active as boolean) ?? true,
    });
    return c.json(formatStaff(s), 201);
  });

  app.patch("/api/v1.0/companies/:cid/staff/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const staff = ss.staff.findOneBy("external_id", Number(c.req.param("id")));
    if (!staff) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.staff.update(staff.id, {
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Active !== undefined && { active: Boolean(body.Active) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/staff/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const staff = ss.staff.findOneBy("external_id", Number(c.req.param("id")));
    if (!staff) return simproNotFound(c);
    ss.staff.delete(staff.id);
    return c.body(null, 204);
  });

  // /employees/ is an alias used by some SimPro API versions
  app.get("/api/v1.0/companies/:cid/employees/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.staff.all().filter((s) => s.company_id === companyId || companyId === 0);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (s) =>
          `${s.given_name} ${s.family_name}`.toLowerCase().includes(q) || (s.email ?? "").toLowerCase().includes(q),
      );
    }
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStaff));
  });

  app.get("/api/v1.0/companies/:cid/employees/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const staff = ss.staff.findOneBy("external_id", Number(c.req.param("id")));
    if (!staff) return simproNotFound(c);
    return c.json(formatStaff(staff));
  });
}
