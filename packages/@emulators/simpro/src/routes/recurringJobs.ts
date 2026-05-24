import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproRecurringJob, SimproRecurringJobCostCenter, SimproRecurringJobSection } from "../entities.js";
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

function formatRecurringJob(rj: SimproRecurringJob) {
  return {
    ID: rj.external_id,
    Name: rj.name,
    Description: rj.description,
    Customer: { ID: rj.customer_id },
    Site: rj.site_id ? { ID: rj.site_id } : null,
    Stage: rj.stage,
    BillingType: rj.billing_type,
    Frequency: rj.frequency,
    StartDate: rj.start_date,
    EndDate: rj.end_date,
    DateModified: rj.date_modified,
  };
}

function formatRecurringJobSection(s: SimproRecurringJobSection) {
  return { ID: s.external_id, Name: s.name, DisplayOrder: s.display_order };
}

function formatRecurringJobCostCenter(cc: SimproRecurringJobCostCenter) {
  return { ID: cc.external_id, Name: cc.name, BillingType: cc.billing_type, ExTax: cc.ex_tax, IncTax: cc.inc_tax };
}

export function recurringJobRoutes({ app, store }: RouteContext): void {
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
  // Recurring Jobs
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringJobs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.recurringJobs.all().filter((rj) => rj.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((rj) => rj.customer_id === Number(customerId));
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringJob));
  });

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rj = ss.recurringJobs.findOneBy("external_id", Number(c.req.param("rjid")));
    if (!rj) return simproNotFound(c);
    return c.json(formatRecurringJob(rj));
  });

  app.post("/api/v1.0/companies/:cid/recurringJobs/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const customerRef = body.Customer as { ID?: number } | undefined;
    if (!customerRef?.ID) return simproValidation(c, "Customer.ID", "Customer is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "recurringJobs", companyId);
    const now = nowIso();
    const rj = ss.recurringJobs.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      description: (body.Description as string | null) ?? null,
      customer_id: customerRef.ID,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      stage: (body.Stage as SimproRecurringJob["stage"]) ?? "Active",
      billing_type: (body.BillingType as SimproRecurringJob["billing_type"]) ?? "TimeAndMaterials",
      frequency: (body.Frequency as string) ?? "Monthly",
      start_date: (body.StartDate as string) ?? now.slice(0, 10),
      end_date: (body.EndDate as string | null) ?? null,
      date_modified: now,
    });
    return c.json(formatRecurringJob(rj), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringJobs/:rjid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rj = ss.recurringJobs.findOneBy("external_id", Number(c.req.param("rjid")));
    if (!rj) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringJobs.update(rj.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Stage !== undefined && { stage: body.Stage as SimproRecurringJob["stage"] }),
      ...(body.BillingType !== undefined && { billing_type: body.BillingType as SimproRecurringJob["billing_type"] }),
      ...(body.Frequency !== undefined && { frequency: body.Frequency as string }),
      ...(body.StartDate !== undefined && { start_date: body.StartDate as string }),
      ...(body.EndDate !== undefined && { end_date: body.EndDate as string | null }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringJobs/:rjid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rj = ss.recurringJobs.findOneBy("external_id", Number(c.req.param("rjid")));
    if (!rj) return simproNotFound(c);
    ss.recurringJobs.delete(rj.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Recurring Job Sections
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const items = ss.recurringJobSections.findBy("recurring_job_id", rjId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringJobSection));
  });

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const s = ss.recurringJobSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_job_id !== rjId) return simproNotFound(c);
    return c.json(formatRecurringJobSection(s));
  });

  app.post("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const rj = ss.recurringJobs.findOneBy("external_id", rjId);
    if (!rj) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "recurringJobSections", companyId);
    const existingSections = ss.recurringJobSections.findBy("recurring_job_id", rjId);
    const s = ss.recurringJobSections.insert({
      company_id: companyId,
      external_id: externalId,
      recurring_job_id: rjId,
      name: body.Name as string,
      display_order: existingSections.length + 1,
    });
    return c.json(formatRecurringJobSection(s), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const s = ss.recurringJobSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_job_id !== rjId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringJobSections.update(s.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const s = ss.recurringJobSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.recurring_job_id !== rjId) return simproNotFound(c);
    ss.recurringJobSections.delete(s.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Recurring Job Cost Centers
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const sId = Number(c.req.param("sid"));
    const items = ss.recurringJobCostCenters
      .all()
      .filter((cc) => cc.recurring_job_id === rjId && cc.section_id === sId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringJobCostCenter));
  });

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringJobCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_job_id !== rjId || cc.section_id !== sId) return simproNotFound(c);
    return c.json(formatRecurringJobCostCenter(cc));
  });

  app.post("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid/costCenters/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const sId = Number(c.req.param("sid"));
    const section = ss.recurringJobSections.findOneBy("external_id", sId);
    if (!section || section.recurring_job_id !== rjId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "recurringJobCostCenters", companyId);
    const cc = ss.recurringJobCostCenters.insert({
      company_id: companyId,
      external_id: externalId,
      recurring_job_id: rjId,
      section_id: sId,
      name: body.Name as string,
      billing_type: (body.BillingType as SimproRecurringJobCostCenter["billing_type"]) ?? "TimeAndMaterials",
      ex_tax: Number(body.ExTax ?? 0),
      inc_tax: Number(body.IncTax ?? 0),
    });
    return c.json(formatRecurringJobCostCenter(cc), 201);
  });

  app.patch("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid/costCenters/:ccid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringJobCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_job_id !== rjId || cc.section_id !== sId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.recurringJobCostCenters.update(cc.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.BillingType !== undefined && {
        billing_type: body.BillingType as SimproRecurringJobCostCenter["billing_type"],
      }),
      ...(body.ExTax !== undefined && { ex_tax: Number(body.ExTax) }),
      ...(body.IncTax !== undefined && { inc_tax: Number(body.IncTax) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/recurringJobs/:rjid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const rjId = Number(c.req.param("rjid"));
    const sId = Number(c.req.param("sid"));
    const cc = ss.recurringJobCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.recurring_job_id !== rjId || cc.section_id !== sId) return simproNotFound(c);
    ss.recurringJobCostCenters.delete(cc.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Flat alias lists
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringJobSections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.recurringJobSections.all().filter((s) => s.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringJobSection));
  });

  app.get("/api/v1.0/companies/:cid/recurringJobCostCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.recurringJobCostCenters.all().filter((cc) => cc.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatRecurringJobCostCenter));
  });

  // ──────────────────────────────────────────────────────────────
  // Timelines / Notes (stubs)
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/timelines/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  app.get("/api/v1.0/companies/:cid/recurringJobs/:rjid/notes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
