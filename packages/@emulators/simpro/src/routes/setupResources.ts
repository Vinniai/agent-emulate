import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type {
  SimproEmployee,
  SimproSetupActivity,
  SimproSetupArchiveReason,
  SimproSetupChartOfAccounts,
  SimproSetupCustomerGroup,
  SimproSetupCustomField,
  SimproSetupMembership,
  SimproSetupPaymentMethod,
  SimproSetupPaymentTerms,
  SimproSetupResponseTime,
  SimproSetupSecurityGroup,
  SimproSetupStatusCode,
  SimproSetupTag,
  SimproSetupTeam,
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
  simproValidation,
} from "../helpers.js";
import { nextExternalId } from "./jobs.js";

export function setupResourceRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ─── /currentUser/ (no company prefix) ───────────────────────────────────
  app.get("/api/v1.0/currentUser/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({ ID: 1, GivenName: "System", FamilyName: "User", Email: "system@agent-emulate.dev" });
  });

  // ─── /info/ (no company prefix) ─────────────────────────────────────────
  app.get("/api/v1.0/info/", (c) => {
    return c.json({ Version: "23.1.0" });
  });

  // ─── /setup/defaults/ ────────────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/defaults/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({});
  });

  // ─── /setup/customerGroups/ ──────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/customerGroups/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupCustomerGroups.all().filter((g) => g.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((g) => ({ ID: g.external_id, Name: g.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/customerGroups/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.setupCustomerGroups.findOneBy("external_id", Number(c.req.param("id")));
    if (!g) return simproNotFound(c);
    return c.json({ ID: g.external_id, Name: g.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/customerGroups/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupCustomerGroups", companyId);
    const g = ss.setupCustomerGroups.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
    });
    return c.json({ ID: g.external_id, Name: g.name }, 201);
  });

  app.patch("/api/v1.0/companies/:cid/setup/customerGroups/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.setupCustomerGroups.findOneBy("external_id", Number(c.req.param("id")));
    if (!g) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.setupCustomerGroups.update(g.id, { ...(body.Name !== undefined && { name: body.Name as string }) });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/setup/customerGroups/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.setupCustomerGroups.findOneBy("external_id", Number(c.req.param("id")));
    if (!g) return simproNotFound(c);
    ss.setupCustomerGroups.delete(g.id);
    return c.body(null, 204);
  });

  // ─── /setup/activities/ ──────────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/activities/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupActivities.all().filter((a) => a.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((a) => ({ ID: a.external_id, Name: a.name, Color: a.color, Archived: a.archived })));
  });

  app.get("/api/v1.0/companies/:cid/setup/activities/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.setupActivities.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    return c.json({ ID: a.external_id, Name: a.name, Color: a.color, Archived: a.archived });
  });

  app.post("/api/v1.0/companies/:cid/setup/activities/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupActivities", companyId);
    const a = ss.setupActivities.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      color: (body.Color as string | null) ?? null,
      archived: false,
    });
    return c.json({ ID: a.external_id, Name: a.name, Color: a.color, Archived: a.archived }, 201);
  });

  app.patch("/api/v1.0/companies/:cid/setup/activities/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.setupActivities.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.setupActivities.update(a.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Color !== undefined && { color: body.Color as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/setup/activities/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.setupActivities.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    ss.setupActivities.delete(a.id);
    return c.body(null, 204);
  });

  // ─── /setup/teams/ ───────────────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/teams/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupTeams.all().filter((t) => t.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(
      page.map((t) => ({ ID: t.external_id, Name: t.name, Members: t.member_ids.map((id) => ({ ID: id })) })),
    );
  });

  app.get("/api/v1.0/companies/:cid/setup/teams/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.setupTeams.findOneBy("external_id", Number(c.req.param("id")));
    if (!t) return simproNotFound(c);
    return c.json({ ID: t.external_id, Name: t.name, Members: t.member_ids.map((id) => ({ ID: id })) });
  });

  app.post("/api/v1.0/companies/:cid/setup/teams/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupTeams", companyId);
    const memberIds = Array.isArray(body.Members)
      ? (body.Members as Record<string, unknown>[]).map((m) => Number(m.ID ?? 0)).filter(Boolean)
      : [];
    const t = ss.setupTeams.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      member_ids: memberIds,
    });
    return c.json({ ID: t.external_id, Name: t.name, Members: t.member_ids.map((id) => ({ ID: id })) }, 201);
  });

  // ─── /setup/securityGroups/ ──────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/securityGroups/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupSecurityGroups.all().filter((g) => g.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((g) => ({ ID: g.external_id, Name: g.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/securityGroups/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const g = ss.setupSecurityGroups.findOneBy("external_id", Number(c.req.param("id")));
    if (!g) return simproNotFound(c);
    return c.json({ ID: g.external_id, Name: g.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/securityGroups/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupSecurityGroups", companyId);
    const g = ss.setupSecurityGroups.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
    });
    return c.json({ ID: g.external_id, Name: g.name }, 201);
  });

  // ─── /setup/statusCodes/projects/ ────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/statusCodes/projects/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupStatusCodes
      .all()
      .filter((s) => (s.company_id === companyId || companyId === 0) && s.entity_type === "projects");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((s) => ({ ID: s.external_id, Name: s.name, Color: s.color })));
  });

  app.get("/api/v1.0/companies/:cid/setup/statusCodes/projects/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.setupStatusCodes.findOneBy("external_id", Number(c.req.param("id")));
    if (!s || s.entity_type !== "projects") return simproNotFound(c);
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color });
  });

  app.post("/api/v1.0/companies/:cid/setup/statusCodes/projects/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupStatusCodes", companyId);
    const s = ss.setupStatusCodes.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "projects",
      name: body.Name as string,
      color: (body.Color as string | null) ?? null,
    });
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color }, 201);
  });

  // ─── /setup/statusCodes/customerInvoices/ ────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/statusCodes/customerInvoices/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupStatusCodes
      .all()
      .filter((s) => (s.company_id === companyId || companyId === 0) && s.entity_type === "customerInvoices");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((s) => ({ ID: s.external_id, Name: s.name, Color: s.color })));
  });

  app.get("/api/v1.0/companies/:cid/setup/statusCodes/customerInvoices/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.setupStatusCodes.findOneBy("external_id", Number(c.req.param("id")));
    if (!s || s.entity_type !== "customerInvoices") return simproNotFound(c);
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color });
  });

  app.post("/api/v1.0/companies/:cid/setup/statusCodes/customerInvoices/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupStatusCodes", companyId);
    const s = ss.setupStatusCodes.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "customerInvoices",
      name: body.Name as string,
      color: (body.Color as string | null) ?? null,
    });
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color }, 201);
  });

  // ─── /setup/statusCodes/vendorOrders/ ────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/statusCodes/vendorOrders/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupStatusCodes
      .all()
      .filter((s) => (s.company_id === companyId || companyId === 0) && s.entity_type === "vendorOrders");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((s) => ({ ID: s.external_id, Name: s.name, Color: s.color })));
  });

  app.get("/api/v1.0/companies/:cid/setup/statusCodes/vendorOrders/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.setupStatusCodes.findOneBy("external_id", Number(c.req.param("id")));
    if (!s || s.entity_type !== "vendorOrders") return simproNotFound(c);
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color });
  });

  app.post("/api/v1.0/companies/:cid/setup/statusCodes/vendorOrders/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupStatusCodes", companyId);
    const s = ss.setupStatusCodes.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "vendorOrders",
      name: body.Name as string,
      color: (body.Color as string | null) ?? null,
    });
    return c.json({ ID: s.external_id, Name: s.name, Color: s.color }, 201);
  });

  // ─── /setup/tags/customers/ ──────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/tags/customers/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupTags
      .all()
      .filter((t) => (t.company_id === companyId || companyId === 0) && t.entity_type === "customers");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((t) => ({ ID: t.external_id, Name: t.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/tags/customers/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.setupTags.findOneBy("external_id", Number(c.req.param("id")));
    if (!t || t.entity_type !== "customers") return simproNotFound(c);
    return c.json({ ID: t.external_id, Name: t.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/tags/customers/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupTags", companyId);
    const t = ss.setupTags.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "customers",
      name: body.Name as string,
    });
    return c.json({ ID: t.external_id, Name: t.name }, 201);
  });

  // ─── /setup/tags/projects/ ───────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/tags/projects/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupTags
      .all()
      .filter((t) => (t.company_id === companyId || companyId === 0) && t.entity_type === "projects");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((t) => ({ ID: t.external_id, Name: t.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/tags/projects/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.setupTags.findOneBy("external_id", Number(c.req.param("id")));
    if (!t || t.entity_type !== "projects") return simproNotFound(c);
    return c.json({ ID: t.external_id, Name: t.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/tags/projects/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupTags", companyId);
    const t = ss.setupTags.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "projects",
      name: body.Name as string,
    });
    return c.json({ ID: t.external_id, Name: t.name }, 201);
  });

  // ─── /setup/archiveReasons/jobs/ ─────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/jobs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupArchiveReasons
      .all()
      .filter((r) => (r.company_id === companyId || companyId === 0) && r.entity_type === "jobs");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((r) => ({ ID: r.external_id, Name: r.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/jobs/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const r = ss.setupArchiveReasons.findOneBy("external_id", Number(c.req.param("id")));
    if (!r || r.entity_type !== "jobs") return simproNotFound(c);
    return c.json({ ID: r.external_id, Name: r.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/archiveReasons/jobs/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupArchiveReasons", companyId);
    const r = ss.setupArchiveReasons.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "jobs",
      name: body.Name as string,
    });
    return c.json({ ID: r.external_id, Name: r.name }, 201);
  });

  // ─── /setup/archiveReasons/quotes/ ───────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/quotes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupArchiveReasons
      .all()
      .filter((r) => (r.company_id === companyId || companyId === 0) && r.entity_type === "quotes");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((r) => ({ ID: r.external_id, Name: r.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/quotes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const r = ss.setupArchiveReasons.findOneBy("external_id", Number(c.req.param("id")));
    if (!r || r.entity_type !== "quotes") return simproNotFound(c);
    return c.json({ ID: r.external_id, Name: r.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/archiveReasons/quotes/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupArchiveReasons", companyId);
    const r = ss.setupArchiveReasons.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "quotes",
      name: body.Name as string,
    });
    return c.json({ ID: r.external_id, Name: r.name }, 201);
  });

  // ─── /setup/archiveReasons/leads/ ────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/leads/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupArchiveReasons
      .all()
      .filter((r) => (r.company_id === companyId || companyId === 0) && r.entity_type === "leads");
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((r) => ({ ID: r.external_id, Name: r.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/archiveReasons/leads/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const r = ss.setupArchiveReasons.findOneBy("external_id", Number(c.req.param("id")));
    if (!r || r.entity_type !== "leads") return simproNotFound(c);
    return c.json({ ID: r.external_id, Name: r.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/archiveReasons/leads/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupArchiveReasons", companyId);
    const r = ss.setupArchiveReasons.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: "leads",
      name: body.Name as string,
    });
    return c.json({ ID: r.external_id, Name: r.name }, 201);
  });

  // ─── /setup/memberships/ ─────────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/memberships/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupMemberships.all().filter((m) => m.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(
      page.map((m) => ({ ID: m.external_id, Name: m.name, DurationMonths: m.duration_months, Price: m.price })),
    );
  });

  app.get("/api/v1.0/companies/:cid/setup/memberships/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const m = ss.setupMemberships.findOneBy("external_id", Number(c.req.param("id")));
    if (!m) return simproNotFound(c);
    return c.json({ ID: m.external_id, Name: m.name, DurationMonths: m.duration_months, Price: m.price });
  });

  app.post("/api/v1.0/companies/:cid/setup/memberships/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupMemberships", companyId);
    const m = ss.setupMemberships.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      duration_months: Number(body.DurationMonths ?? 12),
      price: Number(body.Price ?? 0),
    });
    return c.json({ ID: m.external_id, Name: m.name, DurationMonths: m.duration_months, Price: m.price }, 201);
  });

  // ─── /setup/responseTimes/ ───────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/responseTimes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupResponseTimes.all().filter((r) => r.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((r) => ({ ID: r.external_id, Name: r.name, Hours: r.hours })));
  });

  app.get("/api/v1.0/companies/:cid/setup/responseTimes/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const r = ss.setupResponseTimes.findOneBy("external_id", Number(c.req.param("id")));
    if (!r) return simproNotFound(c);
    return c.json({ ID: r.external_id, Name: r.name, Hours: r.hours });
  });

  app.post("/api/v1.0/companies/:cid/setup/responseTimes/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupResponseTimes", companyId);
    const r = ss.setupResponseTimes.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      hours: Number(body.Hours ?? 0),
    });
    return c.json({ ID: r.external_id, Name: r.name, Hours: r.hours }, 201);
  });

  // ─── /setup/accounts/chartOfAccounts/ ────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/accounts/chartOfAccounts/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupChartOfAccounts.all().filter((a) => a.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((a) => ({ ID: a.external_id, Code: a.code, Name: a.name, AccountType: a.account_type })));
  });

  app.get("/api/v1.0/companies/:cid/setup/accounts/chartOfAccounts/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.setupChartOfAccounts.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    return c.json({ ID: a.external_id, Code: a.code, Name: a.name, AccountType: a.account_type });
  });

  app.post("/api/v1.0/companies/:cid/setup/accounts/chartOfAccounts/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupChartOfAccounts", companyId);
    const a = ss.setupChartOfAccounts.insert({
      company_id: companyId,
      external_id: externalId,
      code: (body.Code as string) ?? "",
      name: body.Name as string,
      account_type: (body.AccountType as string) ?? "Asset",
    });
    return c.json({ ID: a.external_id, Code: a.code, Name: a.name, AccountType: a.account_type }, 201);
  });

  // ─── /setup/accounts/paymentMethods/ ─────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/accounts/paymentMethods/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupPaymentMethods.all().filter((m) => m.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((m) => ({ ID: m.external_id, Name: m.name })));
  });

  app.get("/api/v1.0/companies/:cid/setup/accounts/paymentMethods/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const m = ss.setupPaymentMethods.findOneBy("external_id", Number(c.req.param("id")));
    if (!m) return simproNotFound(c);
    return c.json({ ID: m.external_id, Name: m.name });
  });

  app.post("/api/v1.0/companies/:cid/setup/accounts/paymentMethods/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupPaymentMethods", companyId);
    const m = ss.setupPaymentMethods.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
    });
    return c.json({ ID: m.external_id, Name: m.name }, 201);
  });

  // ─── /setup/accounts/paymentTerms/ ───────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/setup/accounts/paymentTerms/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.setupPaymentTerms.all().filter((t) => t.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((t) => ({ ID: t.external_id, Name: t.name, Days: t.days })));
  });

  app.get("/api/v1.0/companies/:cid/setup/accounts/paymentTerms/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.setupPaymentTerms.findOneBy("external_id", Number(c.req.param("id")));
    if (!t) return simproNotFound(c);
    return c.json({ ID: t.external_id, Name: t.name, Days: t.days });
  });

  app.post("/api/v1.0/companies/:cid/setup/accounts/paymentTerms/", async (c) => {
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
    const externalId = nextExternalId(ss, "setupPaymentTerms", companyId);
    const t = ss.setupPaymentTerms.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      days: Number(body.Days ?? 30),
    });
    return c.json({ ID: t.external_id, Name: t.name, Days: t.days }, 201);
  });

  // ─── /setup/customFields/:entityType/ ────────────────────────────────────
  // Note: reference.ts already handles setup/customFields/:entity/ GET routes.
  // Here we add POST and PATCH/DELETE for custom field definitions.
  app.post("/api/v1.0/companies/:cid/setup/customFieldDefs/:entityType/", async (c) => {
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
    const entityType = c.req.param("entityType");
    const externalId = nextExternalId(ss, "setupCustomFieldDefs", companyId);
    const f = ss.setupCustomFieldDefs.insert({
      company_id: companyId,
      external_id: externalId,
      entity_type: entityType,
      name: body.Name as string,
      field_type: (body.FieldType as SimproSetupCustomField["field_type"]) ?? "text",
      options: Array.isArray(body.Options) ? (body.Options as string[]) : [],
    });
    return c.json({ ID: f.external_id, Name: f.name, FieldType: f.field_type, Options: f.options }, 201);
  });

  app.get("/api/v1.0/companies/:cid/setup/customFieldDefs/:entityType/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const entityType = c.req.param("entityType");
    const items = ss.setupCustomFieldDefs
      .all()
      .filter((f) => (f.company_id === companyId || companyId === 0) && f.entity_type === entityType);
    const page = paginate(c, items, parsePagination(c));
    return c.json(page.map((f) => ({ ID: f.external_id, Name: f.name, FieldType: f.field_type, Options: f.options })));
  });

  app.get("/api/v1.0/companies/:cid/setup/customFieldDefs/:entityType/:cfid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const f = ss.setupCustomFieldDefs.findOneBy("external_id", Number(c.req.param("cfid")));
    if (!f) return simproNotFound(c);
    return c.json({ ID: f.external_id, Name: f.name, FieldType: f.field_type, Options: f.options });
  });

  app.patch("/api/v1.0/companies/:cid/setup/customFieldDefs/:entityType/:cfid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const f = ss.setupCustomFieldDefs.findOneBy("external_id", Number(c.req.param("cfid")));
    if (!f) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.setupCustomFieldDefs.update(f.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.FieldType !== undefined && { field_type: body.FieldType as SimproSetupCustomField["field_type"] }),
      ...(body.Options !== undefined && { options: body.Options as string[] }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/setup/customFieldDefs/:entityType/:cfid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const f = ss.setupCustomFieldDefs.findOneBy("external_id", Number(c.req.param("cfid")));
    if (!f) return simproNotFound(c);
    ss.setupCustomFieldDefs.delete(f.id);
    return c.body(null, 204);
  });

  // ─── /available/technicians/ ─────────────────────────────────────────────
  app.get("/api/v1.0/companies/:cid/available/technicians/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.employees
      .all()
      .filter((e) => (e.company_id === companyId || companyId === 0) && e.active && !e.archived);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(
      page.map((e) => ({
        ID: e.external_id,
        Name: `${e.given_name} ${e.family_name}`,
        GivenName: e.given_name,
        FamilyName: e.family_name,
      })),
    );
  });
}
