import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type {
  SimproVendorBranch,
  SimproVendorContact,
  SimproVendorCredit,
  SimproVendorOrderCatalog,
  SimproVendorReceipt,
} from "../entities.js";
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

function formatVendorBranch(b: SimproVendorBranch) {
  return { ID: b.external_id, Name: b.name, Address: b.address ?? {}, Phone: b.phone, Email: b.email };
}

function formatVendorContact(vc: SimproVendorContact) {
  return {
    ID: vc.external_id,
    GivenName: vc.given_name,
    FamilyName: vc.family_name,
    Name: `${vc.given_name} ${vc.family_name}`,
    Email: vc.email,
    Phone: vc.phone,
    Position: vc.position,
  };
}

function formatVendorOrderCatalog(voc: SimproVendorOrderCatalog) {
  return {
    ID: voc.external_id,
    Catalog: voc.catalog_id ? { ID: voc.catalog_id } : null,
    Name: voc.name,
    Quantity: voc.quantity,
    UnitPrice: voc.unit_price,
    TotalExTax: voc.total_ex_tax,
  };
}

function formatVendorReceipt(vr: SimproVendorReceipt) {
  return { ID: vr.external_id, DateReceived: vr.date_received, Notes: vr.notes };
}

function formatVendorCredit(vc: SimproVendorCredit) {
  return {
    ID: vc.external_id,
    Vendor: { ID: vc.vendor_id },
    TotalExTax: vc.total_ex_tax,
    TotalIncTax: vc.total_inc_tax,
    DateIssued: vc.date_issued,
  };
}

export function vendorSubResourceRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ── Vendor Branches ──────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendors/:vid/branches/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vendor = ss.vendors.findOneBy("external_id", vendorId);
    if (!vendor) return simproNotFound(c);
    const items = ss.vendorBranches.findBy("vendor_id", vendorId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorBranch));
  });

  app.get("/api/v1.0/companies/:cid/vendors/:vid/branches/:bid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const b = ss.vendorBranches.findOneBy("external_id", Number(c.req.param("bid")));
    if (!b || b.vendor_id !== vendorId) return simproNotFound(c);
    return c.json(formatVendorBranch(b));
  });

  app.post("/api/v1.0/companies/:cid/vendors/:vid/branches/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vendor = ss.vendors.findOneBy("external_id", vendorId);
    if (!vendor) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "vendorBranches", companyId);
    const b = ss.vendorBranches.insert({
      company_id: companyId,
      external_id: externalId,
      vendor_id: vendorId,
      name: (body.Name as string) ?? `Branch ${externalId}`,
      address: (body.Address as Record<string, string> | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      email: (body.Email as string | null) ?? null,
    });
    return c.json(formatVendorBranch(b), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendors/:vid/branches/:bid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const b = ss.vendorBranches.findOneBy("external_id", Number(c.req.param("bid")));
    if (!b || b.vendor_id !== vendorId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendorBranches.update(b.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Address !== undefined && { address: body.Address as Record<string, string> | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendors/:vid/branches/:bid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const b = ss.vendorBranches.findOneBy("external_id", Number(c.req.param("bid")));
    if (!b || b.vendor_id !== vendorId) return simproNotFound(c);
    ss.vendorBranches.delete(b.id);
    return c.body(null, 204);
  });

  // ── Vendor Contacts ───────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendors/:vid/contacts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vendor = ss.vendors.findOneBy("external_id", vendorId);
    if (!vendor) return simproNotFound(c);
    const items = ss.vendorContacts.findBy("vendor_id", vendorId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorContact));
  });

  app.get("/api/v1.0/companies/:cid/vendors/:vid/contacts/:ctid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vc = ss.vendorContacts.findOneBy("external_id", Number(c.req.param("ctid")));
    if (!vc || vc.vendor_id !== vendorId) return simproNotFound(c);
    return c.json(formatVendorContact(vc));
  });

  app.post("/api/v1.0/companies/:cid/vendors/:vid/contacts/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vendor = ss.vendors.findOneBy("external_id", vendorId);
    if (!vendor) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "vendorContacts", companyId);
    const vc = ss.vendorContacts.insert({
      company_id: companyId,
      external_id: externalId,
      vendor_id: vendorId,
      given_name: (body.GivenName as string) ?? "",
      family_name: (body.FamilyName as string) ?? "",
      email: (body.Email as string | null) ?? null,
      phone: (body.Phone as string | null) ?? null,
      position: (body.Position as string | null) ?? null,
    });
    return c.json(formatVendorContact(vc), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendors/:vid/contacts/:ctid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vc = ss.vendorContacts.findOneBy("external_id", Number(c.req.param("ctid")));
    if (!vc || vc.vendor_id !== vendorId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendorContacts.update(vc.id, {
      ...(body.GivenName !== undefined && { given_name: body.GivenName as string }),
      ...(body.FamilyName !== undefined && { family_name: body.FamilyName as string }),
      ...(body.Email !== undefined && { email: body.Email as string | null }),
      ...(body.Phone !== undefined && { phone: body.Phone as string | null }),
      ...(body.Position !== undefined && { position: body.Position as string | null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendors/:vid/contacts/:ctid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vendorId = Number(c.req.param("vid"));
    const vc = ss.vendorContacts.findOneBy("external_id", Number(c.req.param("ctid")));
    if (!vc || vc.vendor_id !== vendorId) return simproNotFound(c);
    ss.vendorContacts.delete(vc.id);
    return c.body(null, 204);
  });

  // ── Vendor Order Catalogs ─────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/catalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vo = ss.vendorOrders.findOneBy("external_id", voId);
    if (!vo) return simproNotFound(c);
    const items = ss.vendorOrderCatalogs.findBy("vendor_order_id", voId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorOrderCatalog));
  });

  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/catalogs/:catid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const voc = ss.vendorOrderCatalogs.findOneBy("external_id", Number(c.req.param("catid")));
    if (!voc || voc.vendor_order_id !== voId) return simproNotFound(c);
    return c.json(formatVendorOrderCatalog(voc));
  });

  app.post("/api/v1.0/companies/:cid/vendorOrders/:void/catalogs/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vo = ss.vendorOrders.findOneBy("external_id", voId);
    if (!vo) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "vendorOrderCatalogs", companyId);
    const voc = ss.vendorOrderCatalogs.insert({
      company_id: companyId,
      external_id: externalId,
      vendor_order_id: voId,
      catalog_id: (body.Catalog as { ID?: number } | undefined)?.ID ?? null,
      name: (body.Name as string) ?? "",
      quantity: Number(body.Quantity ?? 1),
      unit_price: Number(body.UnitPrice ?? 0),
      total_ex_tax: Number(body.TotalExTax ?? 0),
    });
    return c.json(formatVendorOrderCatalog(voc), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendorOrders/:void/catalogs/:catid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const voc = ss.vendorOrderCatalogs.findOneBy("external_id", Number(c.req.param("catid")));
    if (!voc || voc.vendor_order_id !== voId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendorOrderCatalogs.update(voc.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Quantity !== undefined && { quantity: Number(body.Quantity) }),
      ...(body.UnitPrice !== undefined && { unit_price: Number(body.UnitPrice) }),
      ...(body.TotalExTax !== undefined && { total_ex_tax: Number(body.TotalExTax) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendorOrders/:void/catalogs/:catid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const voc = ss.vendorOrderCatalogs.findOneBy("external_id", Number(c.req.param("catid")));
    if (!voc || voc.vendor_order_id !== voId) return simproNotFound(c);
    ss.vendorOrderCatalogs.delete(voc.id);
    return c.body(null, 204);
  });

  // ── Vendor Order Receipts ─────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vo = ss.vendorOrders.findOneBy("external_id", voId);
    if (!vo) return simproNotFound(c);
    const items = ss.vendorReceipts.findBy("vendor_order_id", voId);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorReceipt));
  });

  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/:rid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vr = ss.vendorReceipts.findOneBy("external_id", Number(c.req.param("rid")));
    if (!vr || vr.vendor_order_id !== voId) return simproNotFound(c);
    return c.json(formatVendorReceipt(vr));
  });

  app.post("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vo = ss.vendorOrders.findOneBy("external_id", voId);
    if (!vo) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "vendorReceipts", companyId);
    const now = nowIso();
    const vr = ss.vendorReceipts.insert({
      company_id: companyId,
      external_id: externalId,
      vendor_order_id: voId,
      date_received: (body.DateReceived as string) ?? now.slice(0, 10),
      notes: (body.Notes as string | null) ?? null,
    });
    return c.json(formatVendorReceipt(vr), 201);
  });

  app.patch("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/:rid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vr = ss.vendorReceipts.findOneBy("external_id", Number(c.req.param("rid")));
    if (!vr || vr.vendor_order_id !== voId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.vendorReceipts.update(vr.id, {
      ...(body.DateReceived !== undefined && { date_received: body.DateReceived as string }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/:rid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voId = Number(c.req.param("void"));
    const vr = ss.vendorReceipts.findOneBy("external_id", Number(c.req.param("rid")));
    if (!vr || vr.vendor_order_id !== voId) return simproNotFound(c);
    ss.vendorReceipts.delete(vr.id);
    return c.body(null, 204);
  });

  // Receipt sub-resources (return empty lists)
  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/:rid/catalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  app.get("/api/v1.0/companies/:cid/vendorOrders/:void/receipts/:rid/credits/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Vendor Credits (top-level list) ───────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorCredits/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendorCredits.all().filter((vc) => vc.company_id === companyId || companyId === 0);
    const vendorId = c.req.query("Vendor.ID");
    if (vendorId) items = items.filter((vc) => vc.vendor_id === Number(vendorId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorCredit));
  });

  app.get("/api/v1.0/companies/:cid/vendorCredits/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vc = ss.vendorCredits.findOneBy("external_id", Number(c.req.param("id")));
    if (!vc) return simproNotFound(c);
    return c.json(formatVendorCredit(vc));
  });

  // ── Vendor Branches (top-level list) ──────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorBranches/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendorBranches.all().filter((b) => b.company_id === companyId || companyId === 0);
    const vendorId = c.req.query("Vendor.ID");
    if (vendorId) items = items.filter((b) => b.vendor_id === Number(vendorId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorBranch));
  });

  app.get("/api/v1.0/companies/:cid/vendorBranches/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const b = ss.vendorBranches.findOneBy("external_id", Number(c.req.param("id")));
    if (!b) return simproNotFound(c);
    return c.json(formatVendorBranch(b));
  });

  // ── Vendor Order Catalogs (top-level list) ────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorOrderCatalogs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendorOrderCatalogs.all().filter((v) => v.company_id === companyId || companyId === 0);
    const voId = c.req.query("VendorOrder.ID");
    if (voId) items = items.filter((v) => v.vendor_order_id === Number(voId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorOrderCatalog));
  });

  app.get("/api/v1.0/companies/:cid/vendorOrderCatalogs/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const voc = ss.vendorOrderCatalogs.findOneBy("external_id", Number(c.req.param("id")));
    if (!voc) return simproNotFound(c);
    return c.json(formatVendorOrderCatalog(voc));
  });

  // ── Vendor Receipts (top-level list) ─────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/vendorReceipts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.vendorReceipts.all().filter((vr) => vr.company_id === companyId || companyId === 0);
    const voId = c.req.query("VendorOrder.ID");
    if (voId) items = items.filter((vr) => vr.vendor_order_id === Number(voId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatVendorReceipt));
  });

  app.get("/api/v1.0/companies/:cid/vendorReceipts/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const vr = ss.vendorReceipts.findOneBy("external_id", Number(c.req.param("id")));
    if (!vr) return simproNotFound(c);
    return c.json(formatVendorReceipt(vr));
  });
}
