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
import { formatJob, formatQuote } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function quoteRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/quotes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.quotes.all().filter((q) => q.company_id === companyId || companyId === 0);

    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((q) => q.customer_id === Number(customerId));

    const stage = c.req.query("Stage");
    if (stage) items = items.filter((q) => q.stage === stage);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((q) => formatQuote(q, ss)));
  });

  app.get("/api/v1.0/companies/:cid/quotes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const q = ss.quotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!q) return simproNotFound(c);
    return c.json(formatQuote(q, ss));
  });

  app.post("/api/v1.0/companies/:cid/quotes/", async (c) => {
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
    const externalId = nextExternalId(ss, "quotes", companyId);

    const q = ss.quotes.insert({
      company_id: companyId,
      external_id: externalId,
      name: (body.Name as string) ?? `Quote ${externalId}`,
      description: (body.Description as string | null) ?? null,
      order_no: (body.OrderNo as string | null) ?? null,
      customer_id: customerRef.ID,
      customer_contact_id: (body.CustomerContact as { ID?: number } | undefined)?.ID ?? null,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      site_contact_id: (body.SiteContact as { ID?: number } | undefined)?.ID ?? null,
      salesperson_id: (body.Salesperson as { ID?: number } | undefined)?.ID ?? null,
      project_manager_id: (body.ProjectManager as { ID?: number } | undefined)?.ID ?? null,
      status_id: (body.Status as { ID?: number } | undefined)?.ID ?? null,
      stage: "InProgress",
      total_ex_tax: 0,
      total_tax: 0,
      total_inc_tax: 0,
      date_issued: (body.DateIssued as string) ?? nowIso().slice(0, 10),
      due_date: (body.DueDate as string | null) ?? null,
      tags: (body.Tags as string[] | undefined) ?? [],
      converted_job_id: null,
      date_modified: nowIso(),
    });
    return c.json(formatQuote(q, ss), 201);
  });

  app.patch("/api/v1.0/companies/:cid/quotes/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const q = ss.quotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!q) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.quotes.update(q.id, {
      ...(body.Name !== undefined && { name: String(body.Name) }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Stage !== undefined && {
        stage: body.Stage as "InProgress" | "Complete" | "Approved" | "Cancelled" | "Converted",
      }),
      ...(body.DueDate !== undefined && { due_date: body.DueDate as string | null }),
      ...(body.Status !== undefined && { status_id: (body.Status as { ID?: number }).ID ?? null }),
      ...(body.OrderNo !== undefined && { order_no: body.OrderNo as string | null }),
      ...(body.Tags !== undefined && { tags: body.Tags as string[] }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.put("/api/v1.0/companies/:cid/quotes/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const q = ss.quotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!q) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const updated = ss.quotes.update(q.id, {
      name: (body.Name as string) ?? q.name,
      description: (body.Description as string | null) ?? null,
      order_no: (body.OrderNo as string | null) ?? null,
      customer_id: (body.Customer as { ID?: number } | undefined)?.ID ?? q.customer_id,
      site_id: (body.Site as { ID?: number } | undefined)?.ID ?? null,
      salesperson_id: (body.Salesperson as { ID?: number } | undefined)?.ID ?? null,
      project_manager_id: (body.ProjectManager as { ID?: number } | undefined)?.ID ?? null,
      status_id: (body.Status as { ID?: number } | undefined)?.ID ?? null,
      stage: (body.Stage as "InProgress" | "Complete" | "Approved" | "Cancelled" | "Converted") ?? q.stage,
      due_date: (body.DueDate as string | null) ?? null,
      tags: (body.Tags as string[]) ?? [],
      date_modified: nowIso(),
    })!;
    return c.json(formatQuote(updated, ss));
  });

  app.delete("/api/v1.0/companies/:cid/quotes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const q = ss.quotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!q) return simproNotFound(c);
    ss.quotes.delete(q.id);
    return c.body(null, 204);
  });

  // Convert quote to job
  app.post("/api/v1.0/companies/:cid/quotes/:id/convert/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const q = ss.quotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!q) return simproNotFound(c);
    if (q.stage === "Converted") return simproError(c, 409, "Quote has already been converted.");
    let body: Record<string, unknown> = {};
    try {
      body = await parseJson(c);
    } catch {
      /* body is optional */
    }
    const now = nowIso();
    const jobId = nextExternalId(ss, "jobs", companyId);
    const job = ss.jobs.insert({
      company_id: companyId,
      external_id: jobId,
      type: "Project",
      name: (body.Name as string) ?? q.name,
      description: q.description,
      order_no: q.order_no,
      request_no: null,
      customer_id: q.customer_id,
      customer_contact_id: q.customer_contact_id,
      site_id: q.site_id,
      site_contact_id: q.site_contact_id,
      salesperson_id: q.salesperson_id,
      project_manager_id: q.project_manager_id,
      technician_ids: [],
      stage: 2,
      status_id: q.status_id,
      date_issued: now.slice(0, 10),
      due_date: q.due_date,
      due_time: null,
      tags: q.tags,
      custom_fields: [],
      total_ex_tax: q.total_ex_tax,
      total_tax: q.total_tax,
      total_inc_tax: q.total_inc_tax,
      invoiced_ex_tax: 0,
      date_modified: now,
    });
    ss.quotes.update(q.id, { stage: "Converted", converted_job_id: jobId, date_modified: now });
    return c.json(formatJob(job, { ss }), 201);
  });
}
