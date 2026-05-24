import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import {
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
} from "../helpers.js";
import { formatLabourRate, formatStatus, formatStockItem, formatTaxCode } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

/**
 * Reference-data endpoints: tax codes, labour rates, statuses, stock items,
 * zones, custom fields. Read-only in the emulator — seeded via config or
 * the defaults helper.
 */
export function referenceRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/setup/taxCodes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.taxCodes.all().filter((t) => t.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatTaxCode));
  });

  app.get("/api/v1.0/companies/:cid/setup/taxCodes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const tc = ss.taxCodes.findOneBy("external_id", Number(c.req.param("id")));
    if (!tc) return simproNotFound(c);
    return c.json(formatTaxCode(tc));
  });

  app.get("/api/v1.0/companies/:cid/setup/labor/laborRates/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.labourRates.all().filter((r) => r.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatLabourRate));
  });

  app.get("/api/v1.0/companies/:cid/setup/statuses/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const kind = c.req.query("kind");
    let items = ss.statuses.all().filter((s) => s.company_id === companyId || companyId === 0);
    if (kind) items = items.filter((s) => s.kind === kind);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatStatus));
  });

  app.get("/api/v1.0/companies/:cid/catalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.stockItems.all().filter((s) => s.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map(formatStockItem));
  });

  app.post("/api/v1.0/companies/:cid/catalogs/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "stockItems", companyId);
    const tradeEx = (body.TradePrice as { ExTax?: number } | undefined)?.ExTax ?? 0;
    const tradeInc = (body.TradePrice as { IncTax?: number } | undefined)?.IncTax ?? tradeEx;
    const item = ss.stockItems.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      part_no: (body.PartNo as string) ?? "",
      description: (body.Description as string | null) ?? null,
      group_name: (body.Group as { Name?: string } | undefined)?.Name ?? null,
      subgroup_name: (body.SubGroup as { Name?: string } | undefined)?.Name ?? null,
      trade_price_ex_tax: tradeEx,
      trade_price_inc_tax: tradeInc,
      unit_price: (body.UnitPrice as number) ?? 0,
      unit_of_measure: (body.UnitOfMeasure as string | null) ?? null,
      tax_code_id: (body.TaxCode as { ID?: number } | undefined)?.ID ?? null,
      supplier_id: (body.Supplier as { ID?: number } | undefined)?.ID ?? null,
      supplier_name: (body.Supplier as { Name?: string } | undefined)?.Name ?? null,
      supplier_part_no: (body.SupplierPartNo as string | null) ?? null,
      taxable: (body.Taxable as boolean) ?? true,
      archived: false,
    });
    return c.json(formatStockItem(item), 201);
  });

  app.get("/api/v1.0/companies/:cid/setup/zones/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.zones.all().filter((z) => z.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((z) => ({ ID: z.external_id, Name: z.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/customFields/:entity/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const entity = c.req.param("entity");
    const items = ss.customFields
      .all()
      .filter((f) => (f.company_id === companyId || companyId === 0) && f.entity === entity);
    return c.json(items.map((f) => ({ ID: f.external_id, Name: f.name, Type: f.field_type })));
  });

  app.get("/api/v1.0/companies/:cid/setup/labor/laborRates/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lr = ss.labourRates.findOneBy("external_id", Number(c.req.param("id")));
    if (!lr) return simproNotFound(c);
    return c.json(formatLabourRate(lr));
  });

  app.get("/api/v1.0/companies/:cid/setup/statuses/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const st = ss.statuses.findOneBy("external_id", Number(c.req.param("id")));
    if (!st) return simproNotFound(c);
    return c.json(formatStatus(st));
  });

  app.get("/api/v1.0/companies/:cid/catalogs/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const item = ss.stockItems.findOneBy("external_id", Number(c.req.param("id")));
    if (!item) return simproNotFound(c);
    return c.json(formatStockItem(item));
  });

  app.patch("/api/v1.0/companies/:cid/catalogs/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const item = ss.stockItems.findOneBy("external_id", Number(c.req.param("id")));
    if (!item) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.stockItems.update(item.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.PartNo !== undefined && { part_no: body.PartNo as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.UnitPrice !== undefined && { unit_price: body.UnitPrice as number }),
      ...(body.UnitOfMeasure !== undefined && { unit_of_measure: body.UnitOfMeasure as string | null }),
      ...(body.Taxable !== undefined && { taxable: Boolean(body.Taxable) }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/catalogs/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const item = ss.stockItems.findOneBy("external_id", Number(c.req.param("id")));
    if (!item) return simproNotFound(c);
    ss.stockItems.delete(item.id);
    return c.body(null, 204);
  });

  app.get("/api/v1.0/companies/:cid/setup/zones/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const zone = ss.zones.findOneBy("external_id", Number(c.req.param("id")));
    if (!zone) return simproNotFound(c);
    return c.json({ ID: zone.external_id, Name: zone.name });
  });
}
