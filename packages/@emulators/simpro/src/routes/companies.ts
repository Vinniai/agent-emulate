import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import { rateLimit, requireAuth, simproNotFound } from "../helpers.js";

export function companyRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  const formatCompany = (co: { company_id: number; name: string }) => ({
    ID: co.company_id,
    Name: co.name,
  });

  app.get("/api/v1.0/companies/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json(ss.companies.all().map(formatCompany));
  });

  app.get("/api/v1.0/companies/:cid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cid = Number(c.req.param("cid"));
    const co = ss.companies.findOneBy("company_id", cid);
    if (!co) return simproNotFound(c);
    return c.json(formatCompany(co));
  });
}
