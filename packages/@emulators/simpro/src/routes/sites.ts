import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproAddress, SimproSite } from "../entities.js";
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
import { formatSite } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function siteRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/sites/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.sites.all().filter((s) => s.company_id === companyId || companyId === 0);

    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((s) => s.customer_id === Number(customerId));

    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((s) => s.name.toLowerCase().includes(q));
    }

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(
      page.map((site) => {
        const contact = site.contact_id
          ? (ss.contacts.findOneBy("external_id", site.contact_id) ?? undefined)
          : undefined;
        return formatSite(site, contact);
      }),
    );
  });

  app.get("/api/v1.0/companies/:cid/sites/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const site = ss.sites.findOneBy("external_id", Number(c.req.param("id")));
    if (!site) return simproNotFound(c);
    const contact = site.contact_id ? (ss.contacts.findOneBy("external_id", site.contact_id) ?? undefined) : undefined;
    return c.json(formatSite(site, contact));
  });

  app.post("/api/v1.0/companies/:cid/sites/", async (c) => {
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
    const customer = ss.customers.findOneBy("external_id", customerRef.ID);
    if (!customer) return simproValidation(c, "Customer.ID", "Customer not found.", customerRef.ID);

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "sites", companyId);

    const site = ss.sites.insert({
      company_id: companyId,
      external_id: externalId,
      customer_id: customerRef.ID,
      name: (body.Name as string) ?? `Site ${externalId}`,
      address: (body.Address as SimproAddress) ?? null,
      contact_id: (body.Contact as { ID?: number } | undefined)?.ID ?? null,
      archived: false,
    });

    return c.json(formatSite(site), 201);
  });

  const updateSite = async (c: Context) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const site = ss.sites.findOneBy("external_id", Number(c.req.param("id")));
    if (!site) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const patch: Partial<SimproSite> = {
      ...(body.Name !== undefined && { name: String(body.Name) }),
      ...(body.Address !== undefined && { address: body.Address as SimproAddress | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    };
    const contact = body.Contact as { ID?: number } | undefined;
    if (contact?.ID !== undefined) patch.contact_id = contact.ID;

    ss.sites.update(site.id, patch);
    return c.body(null, 204);
  };

  app.put("/api/v1.0/companies/:cid/sites/:id", updateSite);
  app.patch("/api/v1.0/companies/:cid/sites/:id", updateSite);

  app.delete("/api/v1.0/companies/:cid/sites/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const site = ss.sites.findOneBy("external_id", Number(c.req.param("id")));
    if (!site) return simproNotFound(c);
    ss.sites.delete(site.id);
    return c.body(null, 204);
  });
}
