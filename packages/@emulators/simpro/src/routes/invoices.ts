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
import { formatInvoice } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function invoiceRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // Top-level invoice listing
  app.get("/api/v1.0/companies/:cid/invoices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.invoices.all().filter((i) => i.company_id === companyId || companyId === 0);

    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((i) => i.job_id === Number(jobId));

    const stage = c.req.query("Stage");
    if (stage) items = items.filter((i) => i.stage === Number(stage));

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((i) => formatInvoice(i, ss)));
  });

  app.get("/api/v1.0/companies/:cid/invoices/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const inv = ss.invoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!inv) return simproNotFound(c);
    return c.json(formatInvoice(inv, ss));
  });

  app.post("/api/v1.0/companies/:cid/invoices/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const jobRef = body.Job as { ID?: number } | undefined;
    if (!jobRef?.ID) return simproValidation(c, "Job.ID", "Job is required.");
    const job = ss.jobs.findOneBy("external_id", jobRef.ID);
    if (!job) return simproValidation(c, "Job.ID", "Job not found.", jobRef.ID);
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "invoices", companyId);
    const inv = ss.invoices.insert({
      company_id: companyId,
      external_id: externalId,
      job_id: jobRef.ID,
      type: (body.Type as "TaxInvoice" | "ProgressInvoice" | "Deposit" | "RequestForClaim") ?? "TaxInvoice",
      stage: 2,
      total_ex_tax: (body.TotalExTax as number) ?? 0,
      total_inc_tax: (body.TotalIncTax as number) ?? 0,
      paid: 0,
      date_issued: (body.DateIssued as string) ?? nowIso().slice(0, 10),
    });
    return c.json(formatInvoice(inv, ss), 201);
  });

  app.patch("/api/v1.0/companies/:cid/invoices/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const inv = ss.invoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!inv) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.invoices.update(inv.id, {
      ...(body.Stage !== undefined && { stage: Number(body.Stage) as 2 | 5 }),
      ...(body.Paid !== undefined && { paid: Number(body.Paid) }),
      ...(body.DateIssued !== undefined && { date_issued: body.DateIssued as string | null }),
      ...(body.TotalExTax !== undefined && { total_ex_tax: Number(body.TotalExTax) }),
      ...(body.TotalIncTax !== undefined && { total_inc_tax: Number(body.TotalIncTax) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/invoices/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const inv = ss.invoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!inv) return simproNotFound(c);
    ss.invoices.delete(inv.id);
    return c.body(null, 204);
  });

  // Per-job invoice listing
  app.get("/api/v1.0/companies/:cid/jobs/:jid/invoices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const items = ss.invoices.findBy("job_id", jobId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((i) => formatInvoice(i, ss)));
  });
}
