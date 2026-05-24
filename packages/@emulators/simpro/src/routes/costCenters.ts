import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { BillingType, CostCenterStage } from "../entities.js";
import {
  isDisplayAll,
  nowIso,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
} from "../helpers.js";
import { formatCostCenter, formatMasterCostCenter } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function costCenterRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Parameters<typeof rateLimit>[0]): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // Section-nested cost centers (primary path).
  app.get("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const sectionId = Number(c.req.param("sid"));
    const section = ss.sections.findOneBy("external_id", sectionId);
    if (!section) return simproNotFound(c);

    const items = ss.costCenters.findBy("section_id", sectionId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    const displayAll = isDisplayAll(c);
    return c.json(page.map((cc) => formatCostCenter(cc, { displayAll, ss })));
  });

  app.get("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const cc = ss.costCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.section_id !== Number(c.req.param("sid"))) return simproNotFound(c);

    const displayAll = isDisplayAll(c);
    return c.json(formatCostCenter(cc, { displayAll, ss }));
  });

  app.post("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const sectionId = Number(c.req.param("sid"));
    const section = ss.sections.findOneBy("external_id", sectionId);
    if (!section) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const masterRef = body.CostCenter as { ID?: number } | undefined;
    const taxRef = body.TaxCode as { ID?: number } | undefined;

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "costCenters", companyId);
    const now = nowIso();

    const cc = ss.costCenters.insert({
      company_id: companyId,
      external_id: externalId,
      job_id: jobId,
      section_id: sectionId,
      master_cost_center_id: masterRef?.ID ?? null,
      tax_code_id: taxRef?.ID ?? null,
      name: (body.Name as string) ?? `Cost Center ${externalId}`,
      description: (body.Description as string | null) ?? null,
      billing_type: (body.BillingType as BillingType) ?? "TimeAndMaterials",
      billable: (body.Billable as boolean) ?? true,
      stage: (body.Stage as CostCenterStage) ?? 2,
      ex_tax: (body.ExTax as number) ?? 0,
      tax: (body.Tax as number) ?? 0,
      inc_tax: (body.IncTax as number) ?? 0,
      invoiced_ex_tax: 0,
      markup: (body.Markup as number) ?? 0,
      discount: (body.Discount as number) ?? 0,
      is_variation: (body.IsVariation as boolean) ?? false,
      contractor_work_order_id: null,
      date_modified: now,
    });

    return c.json(formatCostCenter(cc, { ss }), 201);
  });

  app.patch("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const cc = ss.costCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    ss.costCenters.update(cc.id, {
      ...(body.Name !== undefined && { name: String(body.Name) }),
      ...(body.BillingType !== undefined && { billing_type: body.BillingType as BillingType }),
      ...(body.Stage !== undefined && { stage: Number(body.Stage) as CostCenterStage }),
      ...(body.ExTax !== undefined && { ex_tax: Number(body.ExTax) }),
      ...(body.Tax !== undefined && { tax: Number(body.Tax) }),
      ...(body.IncTax !== undefined && { inc_tax: Number(body.IncTax) }),
      date_modified: nowIso(),
    });

    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const cc = ss.costCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc) return simproNotFound(c);
    ss.costCenters.delete(cc.id);
    return c.body(null, 204);
  });

  // Top-level cross-section cost center listing for a job.
  app.get("/api/v1.0/companies/:cid/jobs/:jid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const items = ss.costCenters.findBy("job_id", jobId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    const displayAll = isDisplayAll(c);
    return c.json(page.map((cc) => formatCostCenter(cc, { displayAll, ss })));
  });

  // Master (company-level) cost centers.
  app.get("/api/v1.0/companies/:cid/setup/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.masterCostCenters.all().filter((m) => m.company_id === companyId || companyId === 0);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatMasterCostCenter));
  });

  app.get("/api/v1.0/companies/:cid/setup/costCenters/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const master = ss.masterCostCenters.findOneBy("external_id", Number(c.req.param("id")));
    if (!master) return simproNotFound(c);
    return c.json(formatMasterCostCenter(master));
  });

  // Top-level cost centers (aliases for master — matches dist/ behaviour).
  app.get("/api/v1.0/companies/:cid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.masterCostCenters.all().filter((m) => m.company_id === companyId || companyId === 0);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatMasterCostCenter));
  });

  app.get("/api/v1.0/companies/:cid/costCenters/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const master = ss.masterCostCenters.findOneBy("external_id", Number(c.req.param("id")));
    if (!master) return simproNotFound(c);
    return c.json(formatMasterCostCenter(master));
  });
}
