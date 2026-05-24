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
import { formatCreditNote } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function creditNoteRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/creditNotes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.creditNotes.all().filter((cn) => cn.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((cn) => cn.customer_id === Number(customerId));
    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((cn) => cn.job_id === Number(jobId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((cn) => formatCreditNote(cn)));
  });

  app.get("/api/v1.0/companies/:cid/creditNotes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cn = ss.creditNotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!cn) return simproNotFound(c);
    return c.json(formatCreditNote(cn));
  });

  app.post("/api/v1.0/companies/:cid/creditNotes/", async (c) => {
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
    const externalId = nextExternalId(ss, "creditNotes", companyId);
    const now = nowIso();

    const cn = ss.creditNotes.insert({
      company_id: companyId,
      external_id: externalId,
      customer_id: customerRef.ID,
      invoice_id: (body.InvoiceNo as number | null) ?? (body.Invoice as { ID?: number } | undefined)?.ID ?? null,
      job_id: (body.Job as { ID?: number } | undefined)?.ID ?? null,
      total_ex_tax: Number(body.TotalExTax ?? 0),
      total_inc_tax: Number(body.TotalIncTax ?? 0),
      date_issued: (body.DateIssued as string) ?? now.slice(0, 10),
      stage: 2,
      notes: (body.Notes as string | null) ?? null,
    });

    return c.json(formatCreditNote(cn), 201);
  });

  app.patch("/api/v1.0/companies/:cid/creditNotes/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cn = ss.creditNotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!cn) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.creditNotes.update(cn.id, {
      ...(body.TotalExTax !== undefined && { total_ex_tax: Number(body.TotalExTax) }),
      ...(body.TotalIncTax !== undefined && { total_inc_tax: Number(body.TotalIncTax) }),
      ...(body.DateIssued !== undefined && { date_issued: body.DateIssued as string }),
      ...(body.Stage !== undefined && { stage: Number(body.Stage) as 2 | 5 }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/creditNotes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cn = ss.creditNotes.findOneBy("external_id", Number(c.req.param("id")));
    if (!cn) return simproNotFound(c);
    ss.creditNotes.delete(cn.id);
    return c.body(null, 204);
  });
}
