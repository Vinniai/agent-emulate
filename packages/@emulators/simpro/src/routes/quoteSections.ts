import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproQuoteCostCenter, SimproQuoteSection } from "../entities.js";
import {
  nowIso,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
} from "../helpers.js";
import { nextExternalId } from "./jobs.js";

function formatQuoteSection(s: SimproQuoteSection) {
  return {
    ID: s.external_id,
    Name: s.name,
    Description: s.description,
    DisplayOrder: s.display_order,
    DateModified: s.date_modified,
  };
}

function formatQuoteCostCenter(cc: SimproQuoteCostCenter) {
  return {
    ID: cc.external_id,
    Name: cc.name,
    Description: cc.description,
    BillingType: cc.billing_type,
    Stage: cc.stage,
    Total: { ExTax: cc.ex_tax, Tax: cc.tax, IncTax: cc.inc_tax },
    DateModified: cc.date_modified,
  };
}

export function quoteSectionRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ── Quote Sections ────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const quote = ss.quotes.findOneBy("external_id", quoteId);
    if (!quote) return simproNotFound(c);
    const items = ss.quoteSections.findBy("quote_id", quoteId).sort((a, b) => a.display_order - b.display_order);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatQuoteSection));
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const s = ss.quoteSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.quote_id !== quoteId) return simproNotFound(c);
    return c.json(formatQuoteSection(s));
  });

  app.post("/api/v1.0/companies/:cid/quotes/:qid/sections/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const quote = ss.quotes.findOneBy("external_id", quoteId);
    if (!quote) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "quoteSections", companyId);
    const siblings = ss.quoteSections.findBy("quote_id", quoteId);
    const displayOrder = siblings.length === 0 ? 1 : Math.max(...siblings.map((s) => s.display_order)) + 1;
    const s = ss.quoteSections.insert({
      company_id: companyId,
      external_id: externalId,
      quote_id: quoteId,
      name: (body.Name as string) ?? `Section ${externalId}`,
      description: (body.Description as string | null) ?? null,
      display_order: (body.DisplayOrder as number) ?? displayOrder,
      date_modified: nowIso(),
    });
    return c.json(formatQuoteSection(s), 201);
  });

  app.patch("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const s = ss.quoteSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.quote_id !== quoteId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.quoteSections.update(s.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.DisplayOrder !== undefined && { display_order: Number(body.DisplayOrder) }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const s = ss.quoteSections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!s || s.quote_id !== quoteId) return simproNotFound(c);
    // Cascade delete cost centers
    for (const cc of ss.quoteCostCenters.findBy("section_id", s.external_id)) {
      ss.quoteCostCenters.delete(cc.id);
    }
    ss.quoteSections.delete(s.id);
    return c.body(null, 204);
  });

  // ── Quote Cost Centers ────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sectionId = Number(c.req.param("sid"));
    const section = ss.quoteSections.findOneBy("external_id", sectionId);
    if (!section) return simproNotFound(c);
    const items = ss.quoteCostCenters.findBy("section_id", sectionId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatQuoteCostCenter));
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sectionId = Number(c.req.param("sid"));
    const cc = ss.quoteCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.section_id !== sectionId) return simproNotFound(c);
    return c.json(formatQuoteCostCenter(cc));
  });

  app.post("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const quoteId = Number(c.req.param("qid"));
    const sectionId = Number(c.req.param("sid"));
    const section = ss.quoteSections.findOneBy("external_id", sectionId);
    if (!section) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "quoteCostCenters", companyId);
    const now = nowIso();
    const cc = ss.quoteCostCenters.insert({
      company_id: companyId,
      external_id: externalId,
      quote_id: quoteId,
      section_id: sectionId,
      master_cost_center_id: (body.CostCenter as { ID?: number } | undefined)?.ID ?? null,
      tax_code_id: (body.TaxCode as { ID?: number } | undefined)?.ID ?? null,
      name: (body.Name as string) ?? `Cost Center ${externalId}`,
      description: (body.Description as string | null) ?? null,
      billing_type: (body.BillingType as "TimeAndMaterials" | "Fixed" | "FlatRate") ?? "TimeAndMaterials",
      billable: Boolean(body.Billable ?? true),
      stage: Number(body.Stage ?? 2),
      ex_tax: Number(body.ExTax ?? 0),
      tax: Number(body.Tax ?? 0),
      inc_tax: Number(body.IncTax ?? 0),
      invoiced_ex_tax: 0,
      markup: Number(body.Markup ?? 0),
      discount: Number(body.Discount ?? 0),
      is_variation: Boolean(body.IsVariation ?? false),
      date_modified: now,
    });
    return c.json(formatQuoteCostCenter(cc), 201);
  });

  app.patch("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sectionId = Number(c.req.param("sid"));
    const cc = ss.quoteCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.section_id !== sectionId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.quoteCostCenters.update(cc.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.BillingType !== undefined && {
        billing_type: body.BillingType as "TimeAndMaterials" | "Fixed" | "FlatRate",
      }),
      ...(body.Billable !== undefined && { billable: Boolean(body.Billable) }),
      ...(body.Stage !== undefined && { stage: Number(body.Stage) }),
      ...(body.Markup !== undefined && { markup: Number(body.Markup) }),
      ...(body.Discount !== undefined && { discount: Number(body.Discount) }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sectionId = Number(c.req.param("sid"));
    const cc = ss.quoteCostCenters.findOneBy("external_id", Number(c.req.param("ccid")));
    if (!cc || cc.section_id !== sectionId) return simproNotFound(c);
    ss.quoteCostCenters.delete(cc.id);
    return c.body(null, 204);
  });

  // ── Cost center sub-resources (empty lists) ───────────────────────────────

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid/catalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid/labor/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid/oneOffs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid/prebuilds/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Quote lock / timelines ────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/quotes/:qid/lock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({ Locked: false });
  });

  app.post("/api/v1.0/companies/:cid/quotes/:qid/lock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({ Locked: true });
  });

  app.get("/api/v1.0/companies/:cid/quotes/:qid/timelines/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
