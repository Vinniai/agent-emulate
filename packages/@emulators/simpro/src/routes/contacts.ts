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
import { formatContact } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

/**
 * Contact endpoints for Simpro Build v1.0:
 *   GET /api/v1.0/companies/:cid/contacts/
 *   GET /api/v1.0/companies/:cid/contacts/:id
 *   GET /api/v1.0/companies/:cid/customers/:customerId/contacts/
 *   GET /api/v1.0/companies/:cid/sites/:siteId/contacts/
 */
export function contactRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/contacts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.contacts.all().filter((x) => x.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatContact));
  });

  app.get("/api/v1.0/companies/:cid/contacts/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contact = ss.contacts.findOneBy("external_id", Number(c.req.param("id")));
    if (!contact) return simproNotFound(c);
    return c.json(formatContact(contact));
  });

  app.get("/api/v1.0/companies/:cid/customers/:customerId/contacts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const customerId = Number(c.req.param("customerId"));
    const items = ss.contacts.findBy("customer_id", customerId).filter((x) => x.type === "Customer");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatContact));
  });

  app.get("/api/v1.0/companies/:cid/sites/:siteId/contacts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const siteId = Number(c.req.param("siteId"));
    const items = ss.contacts.findBy("site_id", siteId);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatContact));
  });

  app.get("/api/v1.0/companies/:cid/sites/:siteId/contacts/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const siteId = Number(c.req.param("siteId"));
    const contact = ss.contacts.findOneBy("external_id", Number(c.req.param("id")));
    if (!contact || contact.site_id !== siteId) return simproNotFound(c);
    return c.json(formatContact(contact));
  });

  app.post("/api/v1.0/companies/:cid/sites/:siteId/contacts/", async (c) => {
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
    const siteId = Number(c.req.param("siteId"));
    const externalId = nextExternalId(ss, "contacts", companyId);
    const contact = ss.contacts.insert({
      company_id: companyId,
      external_id: externalId,
      type: "Site",
      customer_id: null,
      site_id: siteId,
      salutation: (body.Salutation as string | null) ?? null,
      given_name: body.GivenName as string,
      family_name: body.FamilyName as string,
      position: (body.Position as string | null) ?? null,
      department: (body.Department as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
      alt_email: (body.AltEmail as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      cell_phone: (body.CellPhone as string | null) ?? null,
      fax: (body.Fax as string | null) ?? null,
      primary_contact: (body.PrimaryContact as boolean) ?? false,
      archived: false,
    });
    return c.json(formatContact(contact), 201);
  });

  app.post("/api/v1.0/companies/:cid/contacts/", async (c) => {
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
    const externalId = nextExternalId(ss, "contacts", companyId);
    const contact = ss.contacts.insert({
      company_id: companyId,
      external_id: externalId,
      type: (body.Type as "Customer" | "Site") ?? "Customer",
      customer_id: (body.Customer as { ID?: number } | undefined)?.ID ?? null,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      salutation: (body.Salutation as string | null) ?? null,
      given_name: body.GivenName as string,
      family_name: body.FamilyName as string,
      position: (body.Position as string | null) ?? null,
      department: (body.Department as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
      alt_email: (body.AltEmail as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      cell_phone: (body.CellPhone as string | null) ?? null,
      fax: (body.Fax as string | null) ?? null,
      primary_contact: (body.PrimaryContact as boolean) ?? false,
      archived: false,
    });
    return c.json(formatContact(contact), 201);
  });

  app.patch("/api/v1.0/companies/:cid/contacts/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contact = ss.contacts.findOneBy("external_id", Number(c.req.param("id")));
    if (!contact) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.contacts.update(contact.id, {
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string }),
      ...(body.Salutation !== undefined && { salutation: body.Salutation as string | null }),
      ...(body.Position !== undefined && { position: body.Position as string | null }),
      ...(body.Department !== undefined && { department: body.Department as string | null }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.AltEmail !== undefined && { alt_email: body.AltEmail as string | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.CellPhone !== undefined && { cell_phone: body.CellPhone as string | null }),
      ...(body.Fax !== undefined && { fax: body.Fax as string | null }),
      ...(body.PrimaryContact !== undefined && { primary_contact: Boolean(body.PrimaryContact) }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/contacts/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contact = ss.contacts.findOneBy("external_id", Number(c.req.param("id")));
    if (!contact) return simproNotFound(c);
    ss.contacts.delete(contact.id);
    return c.body(null, 204);
  });

  // Contacts under customer
  app.post("/api/v1.0/companies/:cid/customers/:customerId/contacts/", async (c) => {
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
    const customerId = Number(c.req.param("customerId"));
    const externalId = nextExternalId(ss, "contacts", companyId);
    const contact = ss.contacts.insert({
      company_id: companyId,
      external_id: externalId,
      type: "Customer",
      customer_id: customerId,
      site_id: null,
      salutation: (body.Salutation as string | null) ?? null,
      given_name: body.GivenName as string,
      family_name: body.FamilyName as string,
      position: (body.Position as string | null) ?? null,
      department: (body.Department as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
      alt_email: (body.AltEmail as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      cell_phone: (body.CellPhone as string | null) ?? null,
      fax: (body.Fax as string | null) ?? null,
      primary_contact: (body.PrimaryContact as boolean) ?? false,
      archived: false,
    });
    return c.json(formatContact(contact), 201);
  });
}
