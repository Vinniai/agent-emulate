import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproCatalogItem, SimproLabourItem, SimproOneOffItem, SimproPrebuildItem } from "../entities.js";
import {
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
} from "../helpers.js";
import { nextExternalId } from "./jobs.js";

function formatCatalogItem(item: SimproCatalogItem) {
  return {
    ID: item.external_id,
    StockItem: { ID: item.stock_item_id },
    Name: item.name,
    PartNo: item.part_no,
    Quantity: item.quantity,
    UnitPrice: item.base_price,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

function formatLabourItem(item: SimproLabourItem) {
  return {
    ID: item.external_id,
    Labour: { ID: item.labour_id },
    Name: item.name,
    Hours: item.hours,
    LabourRate: item.labour_rate,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

function formatOneOffItem(item: SimproOneOffItem) {
  return {
    ID: item.external_id,
    Description: item.description,
    Quantity: item.quantity,
    EstCost: item.est_cost,
    ActCost: item.act_cost,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

function formatPrebuildItem(item: SimproPrebuildItem) {
  return {
    ID: item.external_id,
    Prebuild: { ID: item.prebuild_id },
    Name: item.name,
    Quantity: item.quantity,
    CostPrice: item.cost_price,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

function registerLineItemRoutes(
  app: RouteContext["app"],
  guard: (c: Context) => Response | null,
  ss: ReturnType<typeof getSimproStore>,
  basePath: string,
  ccIdParam: string,
) {
  // catalogs
  app.get(`${basePath}/catalogs/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const items = ss.catalogItems.findBy("cost_center_id", ccId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatCatalogItem));
  });

  app.get(`${basePath}/catalogs/:catid`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const item = ss.catalogItems.findOneBy("external_id", Number(c.req.param("catid")));
    if (!item || item.cost_center_id !== ccId) return simproNotFound(c);
    return c.json(formatCatalogItem(item));
  });

  app.post(`${basePath}/catalogs/`, async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const ccId = Number(c.req.param(ccIdParam));
    const externalId = nextExternalId(ss, "catalogItems", companyId);
    const item = ss.catalogItems.insert({
      company_id: companyId,
      external_id: externalId,
      cost_center_id: ccId,
      stock_item_id: (body.StockItem as { ID?: number } | undefined)?.ID ?? null,
      name: (body.Name as string) ?? "",
      part_no: (body.PartNo as string | null) ?? null,
      quantity: Number(body.Quantity ?? 1),
      base_price: Number(body.UnitPrice ?? 0),
      markup: Number(body.Markup ?? 0),
      sell_price: Number(body.SellPrice ?? 0),
      ex_tax: Number(body.ExTax ?? 0),
    });
    return c.json(formatCatalogItem(item), 201);
  });

  // labor
  app.get(`${basePath}/labor/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const items = ss.labourItems.findBy("cost_center_id", ccId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatLabourItem));
  });

  app.get(`${basePath}/labor/:lid`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const item = ss.labourItems.findOneBy("external_id", Number(c.req.param("lid")));
    if (!item || item.cost_center_id !== ccId) return simproNotFound(c);
    return c.json(formatLabourItem(item));
  });

  app.post(`${basePath}/labor/`, async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const ccId = Number(c.req.param(ccIdParam));
    const externalId = nextExternalId(ss, "labourItems", companyId);
    const item = ss.labourItems.insert({
      company_id: companyId,
      external_id: externalId,
      cost_center_id: ccId,
      labour_id: (body.Labour as { ID?: number } | undefined)?.ID ?? 0,
      name: (body.Name as string) ?? "",
      hours: Number(body.Hours ?? 0),
      labour_rate: Number(body.LabourRate ?? 0),
      markup: Number(body.Markup ?? 0),
      sell_price: Number(body.SellPrice ?? 0),
      ex_tax: Number(body.ExTax ?? 0),
    });
    return c.json(formatLabourItem(item), 201);
  });

  // oneOffs
  app.get(`${basePath}/oneOffs/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const items = ss.oneOffItems.findBy("cost_center_id", ccId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatOneOffItem));
  });

  app.get(`${basePath}/oneOffs/:oid`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const item = ss.oneOffItems.findOneBy("external_id", Number(c.req.param("oid")));
    if (!item || item.cost_center_id !== ccId) return simproNotFound(c);
    return c.json(formatOneOffItem(item));
  });

  app.post(`${basePath}/oneOffs/`, async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const ccId = Number(c.req.param(ccIdParam));
    const externalId = nextExternalId(ss, "oneOffItems", companyId);
    const item = ss.oneOffItems.insert({
      company_id: companyId,
      external_id: externalId,
      cost_center_id: ccId,
      description: (body.Description as string) ?? "",
      quantity: Number(body.Quantity ?? 1),
      est_cost: Number(body.EstCost ?? 0),
      act_cost: Number(body.ActCost ?? 0),
      markup: Number(body.Markup ?? 0),
      sell_price: Number(body.SellPrice ?? 0),
      ex_tax: Number(body.ExTax ?? 0),
    });
    return c.json(formatOneOffItem(item), 201);
  });

  // prebuilds
  app.get(`${basePath}/prebuilds/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const items = ss.prebuildItems.findBy("cost_center_id", ccId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPrebuildItem));
  });

  app.get(`${basePath}/prebuilds/:pbid`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ccId = Number(c.req.param(ccIdParam));
    const item = ss.prebuildItems.findOneBy("external_id", Number(c.req.param("pbid")));
    if (!item || item.cost_center_id !== ccId) return simproNotFound(c);
    return c.json(formatPrebuildItem(item));
  });

  app.post(`${basePath}/prebuilds/`, async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const ccId = Number(c.req.param(ccIdParam));
    const externalId = nextExternalId(ss, "prebuildItems", companyId);
    const item = ss.prebuildItems.insert({
      company_id: companyId,
      external_id: externalId,
      cost_center_id: ccId,
      prebuild_id: (body.Prebuild as { ID?: number } | undefined)?.ID ?? 0,
      name: (body.Name as string) ?? "",
      quantity: Number(body.Quantity ?? 1),
      cost_price: Number(body.CostPrice ?? 0),
      markup: Number(body.Markup ?? 0),
      sell_price: Number(body.SellPrice ?? 0),
      ex_tax: Number(body.ExTax ?? 0),
    });
    return c.json(formatPrebuildItem(item), 201);
  });
}

export function costCenterLineItemRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // Jobs cost center line items
  const jobCcBase = "/api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid";
  registerLineItemRoutes(app, guard, ss, jobCcBase, "ccid");

  // Quotes cost center line items
  const quoteCcBase = "/api/v1.0/companies/:cid/quotes/:qid/sections/:sid/costCenters/:ccid";
  registerLineItemRoutes(app, guard, ss, quoteCcBase, "ccid");

  // Cost center lock (no-op)
  app.post(`${jobCcBase}/lock/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({ Locked: true });
  });

  app.delete(`${jobCcBase}/lock/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.body(null, 204);
  });

  // Top-level flat jobCostCenters
  app.get("/api/v1.0/companies/:cid/jobCostCenters/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.costCenters.all().filter((cc) => cc.company_id === companyId || companyId === 0);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(
      page.map((cc) => ({ ID: cc.external_id, Name: cc.name, Job: { ID: cc.job_id }, Section: { ID: cc.section_id } })),
    );
  });

  app.get("/api/v1.0/companies/:cid/jobCostCenters/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const cc = ss.costCenters.findOneBy("external_id", Number(c.req.param("id")));
    if (!cc) return simproNotFound(c);
    return c.json({ ID: cc.external_id, Name: cc.name, Job: { ID: cc.job_id }, Section: { ID: cc.section_id } });
  });
}
