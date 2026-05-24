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
} from "../helpers.js";
import { formatVendorOrder } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function vendorOrderRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/vendorOrders/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendorOrders.all().filter((vo) => vo.company_id === companyId || companyId === 0);
    const vendorId = c.req.query("Vendor.ID");
    if (vendorId) items = items.filter((vo) => vo.vendor_id === Number(vendorId));
    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((vo) => vo.job_id === Number(jobId));
    const stage = c.req.query("Stage");
    if (stage) items = items.filter((vo) => vo.stage === stage);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((vo) => formatVendorOrder(vo)));
  });

  app.get("/api/v1.0/companies/:cid/vendorOrders/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vo = ss.vendorOrders.findOneBy("external_id", Number(c.req.param("id")));
    if (!vo) return simproNotFound(c);
    return c.json(formatVendorOrder(vo));
  });

  app.post("/api/v1.0/companies/:cid/vendorOrders/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "vendorOrders", companyId);
    const now = nowIso();
    const vo = ss.vendorOrders.insert({
      company_id: companyId,
      external_id: externalId,
      vendor_id: (body.Vendor as { ID?: number } | undefined)?.ID ?? null,
      job_id: (body.Job as { ID?: number } | undefined)?.ID ?? null,
      stage: "Draft",
      description: (body.Description as string | null) ?? null,
      total_ex_tax: Number(body.TotalExTax ?? 0),
      total_inc_tax: Number(body.TotalIncTax ?? 0),
      date_issued: (body.DateIssued as string | null) ?? now.slice(0, 10),
    });
    return c.json(formatVendorOrder(vo), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendorOrders/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vo = ss.vendorOrders.findOneBy("external_id", Number(c.req.param("id")));
    if (!vo) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendorOrders.update(vo.id, {
      ...(body.Stage !== undefined && { stage: body.Stage as "Draft" | "Sent" | "PartReceived" | "Received" }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.TotalExTax !== undefined && { total_ex_tax: Number(body.TotalExTax) }),
      ...(body.TotalIncTax !== undefined && { total_inc_tax: Number(body.TotalIncTax) }),
      ...(body.DateIssued !== undefined && { date_issued: body.DateIssued as string | null }),
      ...(body.Vendor !== undefined && { vendor_id: (body.Vendor as { ID?: number }).ID ?? null }),
      ...(body.Job !== undefined && { job_id: (body.Job as { ID?: number }).ID ?? null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendorOrders/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vo = ss.vendorOrders.findOneBy("external_id", Number(c.req.param("id")));
    if (!vo) return simproNotFound(c);
    ss.vendorOrders.delete(vo.id);
    return c.body(null, 204);
  });
}
