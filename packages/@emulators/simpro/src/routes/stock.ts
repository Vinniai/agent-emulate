import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproStockAllocation, SimproStockTake, SimproStockTransfer, SimproStorageDevice } from "../entities.js";
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

function formatStorageDevice(sd: SimproStorageDevice) {
  return { ID: sd.external_id, Name: sd.name, Location: sd.location, Archived: sd.archived };
}

function formatStockAllocation(sa: SimproStockAllocation) {
  return {
    ID: sa.external_id,
    Catalog: { ID: sa.catalog_id },
    Job: sa.job_id ? { ID: sa.job_id } : null,
    Quantity: sa.quantity,
    DateAllocated: sa.date_allocated,
  };
}

function formatStockTake(st: SimproStockTake) {
  return {
    ID: st.external_id,
    StorageDevice: st.storage_device_id ? { ID: st.storage_device_id } : null,
    DateTaken: st.date_taken,
    Notes: st.notes,
  };
}

function formatStockTransfer(st: SimproStockTransfer) {
  return {
    ID: st.external_id,
    FromDevice: st.from_device_id ? { ID: st.from_device_id } : null,
    ToDevice: st.to_device_id ? { ID: st.to_device_id } : null,
    Catalog: { ID: st.catalog_id },
    Quantity: st.quantity,
    DateTransferred: st.date_transferred,
  };
}

export function stockRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ── Storage Devices ───────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/storageDevices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.storageDevices.all().filter((sd) => sd.company_id === companyId || companyId === 0);
    const archived = c.req.query("Archived");
    if (archived === "true") items = items.filter((sd) => sd.archived);
    else if (archived !== "all") items = items.filter((sd) => !sd.archived);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStorageDevice));
  });

  app.get("/api/v1.0/companies/:cid/storageDevices/:sdid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sd = ss.storageDevices.findOneBy("external_id", Number(c.req.param("sdid")));
    if (!sd) return simproNotFound(c);
    return c.json(formatStorageDevice(sd));
  });

  app.post("/api/v1.0/companies/:cid/storageDevices/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "storageDevices", companyId);
    const sd = ss.storageDevices.insert({
      company_id: companyId,
      external_id: externalId,
      name: (body.Name as string) ?? `Storage Device ${externalId}`,
      location: (body.Location as string | null) ?? null,
      archived: Boolean(body.Archived ?? false),
    });
    return c.json(formatStorageDevice(sd), 201);
  });

  app.patch("/api/v1.0/companies/:cid/storageDevices/:sdid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sd = ss.storageDevices.findOneBy("external_id", Number(c.req.param("sdid")));
    if (!sd) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.storageDevices.update(sd.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Location !== undefined && { location: body.Location as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/storageDevices/:sdid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sd = ss.storageDevices.findOneBy("external_id", Number(c.req.param("sdid")));
    if (!sd) return simproNotFound(c);
    ss.storageDevices.delete(sd.id);
    return c.body(null, 204);
  });

  // Storage device stock (returns empty list)
  app.get("/api/v1.0/companies/:cid/storageDevices/:sdid/stock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // Storage device stock (top-level returns empty list)
  app.get("/api/v1.0/companies/:cid/storageDeviceStock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Stock Allocations ─────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/stockAllocations/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.stockAllocations.all().filter((sa) => sa.company_id === companyId || companyId === 0);
    const catalogId = c.req.query("Catalog.ID");
    if (catalogId) items = items.filter((sa) => sa.catalog_id === Number(catalogId));
    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((sa) => sa.job_id === Number(jobId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStockAllocation));
  });

  app.get("/api/v1.0/companies/:cid/stockAllocations/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const sa = ss.stockAllocations.findOneBy("external_id", Number(c.req.param("id")));
    if (!sa) return simproNotFound(c);
    return c.json(formatStockAllocation(sa));
  });

  app.post("/api/v1.0/companies/:cid/stockAllocations/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "stockAllocations", companyId);
    const now = nowIso();
    const sa = ss.stockAllocations.insert({
      company_id: companyId,
      external_id: externalId,
      catalog_id: (body.Catalog as { ID?: number } | undefined)?.ID ?? 0,
      job_id: (body.Job as { ID?: number } | undefined)?.ID ?? null,
      cost_center_id: (body.CostCenter as { ID?: number } | undefined)?.ID ?? null,
      quantity: Number(body.Quantity ?? 1),
      date_allocated: (body.DateAllocated as string) ?? now.slice(0, 10),
    });
    return c.json(formatStockAllocation(sa), 201);
  });

  // ── Stock Takes ───────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/stockTakes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.stockTakes.all().filter((st) => st.company_id === companyId || companyId === 0);
    const sdId = c.req.query("StorageDevice.ID");
    if (sdId) items = items.filter((st) => st.storage_device_id === Number(sdId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStockTake));
  });

  app.get("/api/v1.0/companies/:cid/stockTakes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const st = ss.stockTakes.findOneBy("external_id", Number(c.req.param("id")));
    if (!st) return simproNotFound(c);
    return c.json(formatStockTake(st));
  });

  app.post("/api/v1.0/companies/:cid/stockTakes/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "stockTakes", companyId);
    const now = nowIso();
    const st = ss.stockTakes.insert({
      company_id: companyId,
      external_id: externalId,
      storage_device_id: (body.StorageDevice as { ID?: number } | undefined)?.ID ?? null,
      date_taken: (body.DateTaken as string) ?? now.slice(0, 10),
      notes: (body.Notes as string | null) ?? null,
    });
    return c.json(formatStockTake(st), 201);
  });

  // ── Stock Transfers ───────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/stockTransfer/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.stockTransfers.all().filter((st) => st.company_id === companyId || companyId === 0);
    const catalogId = c.req.query("Catalog.ID");
    if (catalogId) items = items.filter((st) => st.catalog_id === Number(catalogId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStockTransfer));
  });

  app.get("/api/v1.0/companies/:cid/stockTransfer/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const st = ss.stockTransfers.findOneBy("external_id", Number(c.req.param("id")));
    if (!st) return simproNotFound(c);
    return c.json(formatStockTransfer(st));
  });

  app.post("/api/v1.0/companies/:cid/stockTransfer/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "stockTransfers", companyId);
    const now = nowIso();
    const st = ss.stockTransfers.insert({
      company_id: companyId,
      external_id: externalId,
      from_device_id: (body.FromDevice as { ID?: number } | undefined)?.ID ?? null,
      to_device_id: (body.ToDevice as { ID?: number } | undefined)?.ID ?? null,
      catalog_id: (body.Catalog as { ID?: number } | undefined)?.ID ?? 0,
      quantity: Number(body.Quantity ?? 1),
      date_transferred: (body.DateTransferred as string) ?? now.slice(0, 10),
    });
    return c.json(formatStockTransfer(st), 201);
  });

  // ── Catalog Inventories (returns empty list) ──────────────────────────────

  app.get("/api/v1.0/companies/:cid/catalogInventories/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
