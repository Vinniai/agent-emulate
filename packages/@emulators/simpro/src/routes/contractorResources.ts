import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproContractorInvoice, SimproContractorJob } from "../entities.js";
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

function formatContractorInvoice(ci: SimproContractorInvoice) {
  return {
    ID: ci.external_id,
    Contractor: { ID: ci.contractor_id },
    Job: ci.job_id ? { ID: ci.job_id } : null,
    Stage: ci.stage,
    TotalExTax: ci.total_ex_tax,
    TotalIncTax: ci.total_inc_tax,
    DateIssued: ci.date_issued,
    DateModified: ci.date_modified,
  };
}

function formatContractorJob(cj: SimproContractorJob) {
  return {
    ID: cj.external_id,
    Job: { ID: cj.job_id },
    Section: cj.section_id ? { ID: cj.section_id } : null,
    CostCenter: cj.cost_center_id ? { ID: cj.cost_center_id } : null,
    Contractor: { ID: cj.contractor_id },
    Description: cj.description,
    TotalExTax: cj.total_ex_tax,
    TotalIncTax: cj.total_inc_tax,
    DateModified: cj.date_modified,
  };
}

export function contractorResourceRoutes({ app, store }: RouteContext): void {
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
  // Contractor Invoices
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/contractorInvoices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.contractorInvoices.all().filter((ci) => ci.company_id === companyId || companyId === 0);
    const contractorId = c.req.query("Contractor.ID");
    if (contractorId) items = items.filter((ci) => ci.contractor_id === Number(contractorId));
    return c.json(paginate(c, items, parsePagination(c)).map(formatContractorInvoice));
  });

  app.get("/api/v1.0/companies/:cid/contractorInvoices/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ci = ss.contractorInvoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!ci) return simproNotFound(c);
    return c.json(formatContractorInvoice(ci));
  });

  app.post("/api/v1.0/companies/:cid/contractorInvoices/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const contractorRef = body.Contractor as { ID?: number } | undefined;
    if (!contractorRef?.ID) return simproValidation(c, "Contractor.ID", "Contractor is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "contractorInvoices", companyId);
    const now = nowIso();
    const ci = ss.contractorInvoices.insert({
      company_id: companyId,
      external_id: externalId,
      contractor_id: contractorRef.ID,
      job_id: (body.Job as { ID?: number } | undefined)?.ID ?? null,
      stage: (body.Stage as SimproContractorInvoice["stage"]) ?? "Draft",
      total_ex_tax: Number(body.TotalExTax ?? 0),
      total_inc_tax: Number(body.TotalIncTax ?? 0),
      date_issued: (body.DateIssued as string) ?? now.slice(0, 10),
      date_modified: now,
    });
    return c.json(formatContractorInvoice(ci), 201);
  });

  app.patch("/api/v1.0/companies/:cid/contractorInvoices/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ci = ss.contractorInvoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!ci) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.contractorInvoices.update(ci.id, {
      ...(body.Stage !== undefined && { stage: body.Stage as SimproContractorInvoice["stage"] }),
      ...(body.TotalExTax !== undefined && { total_ex_tax: Number(body.TotalExTax) }),
      ...(body.TotalIncTax !== undefined && { total_inc_tax: Number(body.TotalIncTax) }),
      ...(body.DateIssued !== undefined && { date_issued: body.DateIssued as string }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/contractorInvoices/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ci = ss.contractorInvoices.findOneBy("external_id", Number(c.req.param("id")));
    if (!ci) return simproNotFound(c);
    ss.contractorInvoices.delete(ci.id);
    return c.body(null, 204);
  });

  // Contractor variances stub under contractor invoice
  app.get("/api/v1.0/companies/:cid/contractorInvoices/:id/contractorVariances/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ──────────────────────────────────────────────────────────────
  // Contractor Jobs
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/contractorJobs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.contractorJobs.all().filter((cj) => cj.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatContractorJob));
  });

  app.get("/api/v1.0/companies/:cid/contractorJobs/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cj = ss.contractorJobs.findOneBy("external_id", Number(c.req.param("id")));
    if (!cj) return simproNotFound(c);
    return c.json(formatContractorJob(cj));
  });

  // Contractor jobs nested under job / section / cost center
  app.get("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid/contractorJobs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param("ccid"));
    const items = ss.contractorJobs.all().filter((cj) => cj.cost_center_id === ccId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatContractorJob));
  });

  // ──────────────────────────────────────────────────────────────
  // Contractor Variances (global stub)
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/contractorVariances/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
