import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type {
  SimproRecurringInvoice,
  SimproRecurringInvoiceCostCenter,
  SimproRecurringInvoiceSection,
} from "../entities.js";
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

function formatRecurringInvoice(ri: SimproRecurringInvoice) {
  return {
    ID: ri.external_id,
    Customer: { ID: ri.customer_id },
    Site: ri.site_id ? { ID: ri.site_id } : null,
    Stage: ri.stage,
    Frequency: ri.frequency,
    StartDate: ri.start_date,
    NextInvoiceDate: ri.next_invoice_date,
    DateModified: ri.date_modified,
  };
}

function formatRecurringInvoiceSection(s: SimproRecurringInvoiceSection) {
  return { ID: s.external_id, Name: s.name, DisplayOrder: s.display_order };
}

function formatRecurringInvoiceCostCenter(cc: SimproRecurringInvoiceCostCenter) {
  return { ID: cc.external_id, Name: cc.name, BillingType: cc.billing_type, ExTax: cc.ex_tax, IncTax: cc.inc_tax };
}

export function recurringInvoiceRoutes({ app, store }: RouteContext): void {
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
  // Recurring Invoices
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringInvoices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.recurringInvoices.all().filter((ri) => ri.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((ri) => ri.customer_id === Number(customerId));
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringInvoice));
  });

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ri = ss.recurringInvoices.findOneBy("external_id", Number(c.req.param("riid")));
    if (!ri) return simproNotFound(c);
    return c.json(formatRecurringInvoice(ri));
  });

  app.post("/api/v1.0/companies/:cid/recurringInvoices/", async (c) => {
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
    const externalId = nextExternalId(ss, "recurringInvoices", companyId);
    const now = nowIso();
    const ri = ss.recurringInvoices.insert({
      company_id: companyId,
      external_id: externalId,
      customer_id: customerRef.ID,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      stage: (body.Stage as SimproRecurringInvoice["stage"]) ?? "Active",
      frequency: (body.Frequency as string) ?? "Monthly",
      start_date: (body.StartDate as string) ?? now.slice(0, 10),
      next_invoice_date: (body.NextInvoiceDate as string | null) ?? null,
      date_modified: now,
    });
    return c.json(formatRecurringInvoice(ri), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringInvoices/:riid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ri = ss.recurringInvoices.findOneBy("external_id", Number(c.req.param("riid")));
    if (!ri) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringInvoices.update(ri.id, {
      ...(body.Stage !== undefined && { stage: body.Stage as SimproRecurringInvoice["stage"] }),
      ...(body.Frequency !== undefined && { frequency: body.Frequency as string }),
      ...(body.StartDate !== undefined && { start_date: body.StartDate as string }),
      ...(body.NextInvoiceDate !== undefined && { next_invoice_date: body.NextInvoiceDate as string | null }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringInvoices/:riid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ri = ss.recurringInvoices.findOneBy("external_id", Number(c.req.param("riid")));
    if (!ri) return simproNotFound(c);
    ss.recurringInvoices.delete(ri.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Recurring Invoice Sections
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const items = ss.recurringInvoiceSections.findBy("recurring_invoice_id", riId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringInvoiceSection));
  });

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const s = ss.recurringInvoiceSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_invoice_id !== riId) return simproNotFound(c);
    return c.json(formatRecurringInvoiceSection(s));
  });

  app.post("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const ri = ss.recurringInvoices.findOneBy("external_id", riId);
    if (!ri) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "recurringInvoiceSections", companyId);
    const existingSections = ss.recurringInvoiceSections.findBy("recurring_invoice_id", riId);
    const s = ss.recurringInvoiceSections.insert({
      company_id: companyId,
      external_id: externalId,
      recurring_invoice_id: riId,
      name: body.Name as string,
      display_order: existingSections.length + 1,
    });
    return c.json(formatRecurringInvoiceSection(s), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const s = ss.recurringInvoiceSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_invoice_id !== riId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringInvoiceSections.update(s.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const s = ss.recurringInvoiceSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_invoice_id !== riId) return simproNotFound(c);
    ss.recurringInvoiceSections.delete(s.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Recurring Invoice Cost Centers
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const sId = Number(c.req.param("sid"));
    const items = ss.recurringInvoiceCostCenters
      .all()
      .filter((cc) => cc.recurring_invoice_id === riId && cc.section_id === sId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringInvoiceCostCenter));
  });

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringInvoiceCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_invoice_id !== riId || cc.section_id !== sId) return simproNotFound(c);
    return c.json(formatRecurringInvoiceCostCenter(cc));
  });

  app.post("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid/costCenters/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const sId = Number(c.req.param("sid"));
    const section = ss.recurringInvoiceSections.findOneBy("external_id", sId);
    if (!section || section.recurring_invoice_id !== riId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "recurringInvoiceCostCenters", companyId);
    const cc = ss.recurringInvoiceCostCenters.insert({
      company_id: companyId,
      external_id: externalId,
      recurring_invoice_id: riId,
      section_id: sId,
      name: body.Name as string,
      billing_type: (body.BillingType as SimproRecurringInvoiceCostCenter["billing_type"]) ?? "TimeAndMaterials",
      ex_tax: Number(body.ExTax ?? 0),
      inc_tax: Number(body.IncTax ?? 0),
    });
    return c.json(formatRecurringInvoiceCostCenter(cc), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid/costCenters/:ccid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringInvoiceCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_invoice_id !== riId || cc.section_id !== sId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringInvoiceCostCenters.update(cc.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.BillingType !== undefined && {
        billing_type: body.BillingType as SimproRecurringInvoiceCostCenter["billing_type"],
      }),
      ...(body.ExTax !== undefined && { ex_tax: Number(body.ExTax) }),
      ...(body.IncTax !== undefined && { inc_tax: Number(body.IncTax) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringInvoices/:riid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const riId = Number(c.req.param("riid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringInvoiceCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_invoice_id !== riId || cc.section_id !== sId) return simproNotFound(c);
    ss.recurringInvoiceCostCenters.delete(cc.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Flat alias lists
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringInvoiceSections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.recurringInvoiceSections.all().filter((s) => s.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringInvoiceSection));
  });

  app.get("/api/v1.0/companies/:cid/recurringInvoiceCostCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.recurringInvoiceCostCenters.all().filter((cc) => cc.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringInvoiceCostCenter));
  });

  // ──────────────────────────────────────────────────────────────
  // Timelines (stub)
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringInvoices/:riid/timelines/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
