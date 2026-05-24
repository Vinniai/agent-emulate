import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore, type SimproStore } from "../store.js";
import type { JobStage, JobType, SimproJob } from "../entities.js";
import {
  applyColumns,
  isDisplayAll,
  jobStageFromString,
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
import { formatJob } from "../formatters.js";

export function jobRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guardedAuth = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  const parseCompanyId = (c: Context): number => Number(c.req.param("cid")) || 0;

  app.get("/api/v1.0/companies/:cid/jobs/", (c) => {
    const blocked = guardedAuth(c);
    if (blocked) return blocked;

    const companyId = parseCompanyId(c);
    let items = ss.jobs.all().filter((j) => j.company_id === companyId || companyId === 0);

    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((j) => j.customer_id === Number(customerId));

    const siteId = c.req.query("Site.ID");
    if (siteId) items = items.filter((j) => j.site_id === Number(siteId));

    const type = c.req.query("Type");
    if (type) items = items.filter((j) => j.type === (type as JobType));

    const stageQuery = c.req.query("Stage");
    if (stageQuery) items = items.filter((j) => j.stage === (Number(stageQuery) as JobStage));

    const statusId = c.req.query("Status.ID");
    if (statusId) items = items.filter((j) => j.status_id === Number(statusId));

    const modifiedSince = c.req.query("modifiedSince");
    if (modifiedSince) items = items.filter((j) => j.date_modified >= modifiedSince);

    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((j) => j.name.toLowerCase().includes(q) || (j.order_no ?? "").toLowerCase().includes(q));
    }

    const orderBy = c.req.query("OrderBy");
    if (orderBy === "DateModified") items.sort((a, b) => a.date_modified.localeCompare(b.date_modified));
    else if (orderBy === "-DateModified") items.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
    else items.sort((a, b) => a.external_id - b.external_id);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);

    const displayAll = isDisplayAll(c);
    const columnsParam = c.req.query("columns");
    const columns = displayAll ? columnsParam : (columnsParam ?? "ID,Name");
    const formatted = page.map((job) => applyColumns(formatJob(job, { displayAll, ss }), columns));
    return c.json(formatted);
  });

  app.get("/api/v1.0/companies/:cid/jobs/:jid", (c) => {
    const blocked = guardedAuth(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const job = ss.jobs.findOneBy("external_id", jobId);
    if (!job) return simproNotFound(c);

    const displayAll = isDisplayAll(c);
    return c.json(formatJob(job, { displayAll, ss }));
  });

  app.post("/api/v1.0/companies/:cid/jobs/", async (c) => {
    const blocked = guardedAuth(c);
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

    const siteRef = body.Site as { ID?: number } | undefined;
    if (siteRef?.ID) {
      const site = ss.sites.findOneBy("external_id", siteRef.ID);
      if (!site) return simproValidation(c, "Site.ID", "Site not found.", siteRef.ID);
    }

    const companyId = parseCompanyId(c);
    const externalId = nextExternalId(ss, "jobs", companyId);
    const now = nowIso();

    const salesperson = (body.Salesperson as { ID?: number } | undefined)?.ID ?? null;
    const projectManager = (body.ProjectManager as { ID?: number } | undefined)?.ID ?? null;
    const status = (body.Status as { ID?: number } | undefined)?.ID ?? null;

    const job = ss.jobs.insert({
      company_id: companyId,
      external_id: externalId,
      type: (body.Type as JobType) ?? "Service",
      name: (body.Name as string) ?? `Job ${externalId}`,
      description: (body.Description as string) ?? null,
      order_no: (body.OrderNo as string) ?? null,
      request_no: (body.RequestNo as string) ?? null,
      customer_id: customerRef.ID,
      customer_contact_id: (body.CustomerContact as { ID?: number } | undefined)?.ID ?? null,
      site_id: siteRef?.ID ?? null,
      site_contact_id: (body.SiteContact as { ID?: number } | undefined)?.ID ?? null,
      salesperson_id: salesperson,
      project_manager_id: projectManager,
      technician_ids: ((body.Technicians as Array<{ ID: number }> | undefined) ?? []).map((t) => t.ID),
      stage: 2,
      status_id: status,
      date_issued: (body.DateIssued as string) ?? now.slice(0, 10),
      due_date: (body.DueDate as string) ?? null,
      due_time: (body.DueTime as string) ?? null,
      tags: (body.Tags as string[]) ?? [],
      custom_fields: [],
      total_ex_tax: 0,
      total_tax: 0,
      total_inc_tax: 0,
      invoiced_ex_tax: 0,
      date_modified: now,
    });

    return c.json(formatJob(job, { ss }), 201);
  });

  app.patch("/api/v1.0/companies/:cid/jobs/:jid", async (c) => {
    const blocked = guardedAuth(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const job = ss.jobs.findOneBy("external_id", jobId);
    if (!job) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    ss.jobs.update(job.id, {
      ...(body.Name !== undefined && { name: String(body.Name) }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Stage !== undefined && {
        stage: (typeof body.Stage === "string" ? jobStageFromString(body.Stage) : Number(body.Stage)) as JobStage,
      }),
      ...(body.DueDate !== undefined && { due_date: body.DueDate as string | null }),
      ...(body.Status !== undefined && { status_id: (body.Status as { ID?: number }).ID ?? null }),
      ...(body.OrderNo !== undefined && { order_no: body.OrderNo as string | null }),
      ...(body.Tags !== undefined && { tags: body.Tags as string[] }),
      date_modified: nowIso(),
    });

    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/jobs/:jid", (c) => {
    const blocked = guardedAuth(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const job = ss.jobs.findOneBy("external_id", jobId);
    if (!job) return simproNotFound(c);
    ss.jobs.delete(job.id);
    return c.body(null, 204);
  });

  app.get("/api/v1.0/companies/:cid/jobs/:jid/attachments/", (c) => {
    const blocked = guardedAuth(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}

export function nextExternalId(ss: SimproStore, collection: keyof SimproStore, companyId: number): number {
  const col = ss[collection] as { all(): Array<{ company_id: number; external_id: number }> };
  const siblings = col.all().filter((r) => r.company_id === companyId);
  if (siblings.length === 0) return 10000 + companyId;
  return Math.max(...siblings.map((s) => s.external_id)) + 1;
}
