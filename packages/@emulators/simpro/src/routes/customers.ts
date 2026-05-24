import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore, type SimproStore } from "../store.js";
import type { SimproAddress, SimproCustomer } from "../entities.js";
import {
  isDisplayAll,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
} from "../helpers.js";
import { formatCustomer } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function customerRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  const list = (type?: "company" | "individual") => (c: Context) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.customers.all().filter((x) => x.company_id === companyId || companyId === 0);
    if (type) items = items.filter((x) => x.type === type);

    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (x) =>
          (x.company_name ?? "").toLowerCase().includes(q) ||
          (x.given_name ?? "").toLowerCase().includes(q) ||
          (x.family_name ?? "").toLowerCase().includes(q) ||
          (x.email ?? "").toLowerCase().includes(q),
      );
    }

    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((x) => x.archived);
    if (archived === "false") items = items.filter((x) => !x.archived);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatCustomer));
  };

  app.get("/api/v1.0/companies/:cid/customers/", list());
  app.get("/api/v1.0/companies/:cid/customers/companies/", list("company"));
  app.get("/api/v1.0/companies/:cid/customers/individuals/", list("individual"));

  app.get("/api/v1.0/companies/:cid/customers/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const customer = ss.customers.findOneBy("external_id", Number(c.req.param("id")));
    if (!customer) return simproNotFound(c);
    return c.json(formatCustomer(customer));
  });

  const createCustomer = async (c: Context, type: "company" | "individual") => {
    const blocked = guard(c);
    if (blocked) return blocked;

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    if (type === "company" && !body.CompanyName) {
      return simproValidation(c, "CompanyName", "CompanyName is required for company customers.");
    }
    if (type === "individual" && !body.FamilyName) {
      return simproValidation(c, "FamilyName", "FamilyName is required for individual customers.");
    }

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "customers", companyId);

    const customer = ss.customers.insert({
      company_id: companyId,
      external_id: externalId,
      type,
      company_name: (body.CompanyName as string) ?? null,
      given_name: (body.GivenName as string) ?? null,
      family_name: (body.FamilyName as string) ?? null,
      title: (body.Title as string) ?? null,
      email: (body.Email as string) ?? null,
      phone_primary: (body.Phone as { Primary?: string } | undefined)?.Primary ?? null,
      website: (body.Website as string) ?? null,
      ein: (body.EIN as string) ?? null,
      address: (body.Address as SimproAddress) ?? null,
      tax_code_id: (body.TaxCode as { ID?: number } | undefined)?.ID ?? null,
      payment_terms: (body.PaymentTerms as number) ?? null,
      archived: false,
      tags: (body.Tags as string[]) ?? [],
      custom_fields: [],
    });

    return c.json(formatCustomer(customer), 201);
  };

  app.post("/api/v1.0/companies/:cid/customers/companies/", (c) => createCustomer(c, "company"));
  app.post("/api/v1.0/companies/:cid/customers/individuals/", (c) => createCustomer(c, "individual"));

  const updateCustomer = async (c: Context) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const customer = ss.customers.findOneBy("external_id", Number(c.req.param("id")));
    if (!customer) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const patch: Partial<SimproCustomer> = {
      ...(body.CompanyName !== undefined && { company_name: body.CompanyName as string | null }),
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string | null }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string | null }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
      ...(body.Tags !== undefined && { tags: body.Tags as string[] }),
      ...(body.Address !== undefined && { address: body.Address as SimproAddress | null }),
    };
    const phone = body.Phone as { Primary?: string } | undefined;
    if (phone?.Primary !== undefined) patch.phone_primary = phone.Primary;

    ss.customers.update(customer.id, patch);
    return c.body(null, 204);
  };

  app.put("/api/v1.0/companies/:cid/customers/:id", updateCustomer);
  app.patch("/api/v1.0/companies/:cid/customers/:id", updateCustomer);

  app.delete("/api/v1.0/companies/:cid/customers/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const customer = ss.customers.findOneBy("external_id", Number(c.req.param("id")));
    if (!customer) return simproNotFound(c);
    ss.customers.delete(customer.id);
    return c.body(null, 204);
  });
}

export function _customerStoreRef(ss: SimproStore) {
  return ss.customers;
}
