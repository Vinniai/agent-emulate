import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import { formatStaff } from "../formatters.js";
import { paginate, parsePagination, rateLimit, requireAuth, simproNotFound } from "../helpers.js";

const LOG_RESOURCES = [
  "jobs",
  "quotes",
  "customers",
  "contacts",
  "contractorJobs",
  "customerInvoices",
  "mobileStatus",
  "schedules",
  "vendorOrders",
  "recurringInvoices",
] as const;

export function logsAndMiscRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ── Audit log endpoints ───────────────────────────────────────────────────

  for (const resource of LOG_RESOURCES) {
    app.get(`/api/v1.0/companies/:cid/logs/${resource}/`, (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      return c.json([]);
    });

    app.get(`/api/v1.0/companies/:cid/logs/${resource}/:id`, (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      return simproNotFound(c);
    });
  }

  // ── Available technicians ─────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/available/technicians/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.staff.all().filter((s) => (s.company_id === companyId || companyId === 0) && s.active);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatStaff));
  });

  // ── Job timelines ─────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/jobs/:jid/timelines/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Job form templates ────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/jobs/:jid/formTemplates/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Job lock ──────────────────────────────────────────────────────────────

  app.post("/api/v1.0/companies/:cid/jobs/:jid/lock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({ Locked: true });
  });

  app.delete("/api/v1.0/companies/:cid/jobs/:jid/lock/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.body(null, 204);
  });

  // ── Job attach form ───────────────────────────────────────────────────────

  app.post("/api/v1.0/companies/:cid/jobs/:jid/attachForm/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json({});
  });

  // ── Quote notes ───────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/quotes/:qid/notes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Catalog pricing tiers ─────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/catalogs/:catid/pricingTiers/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });

  // ── Catalog vendors ───────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/catalogs/:catid/vendors/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    return c.json([]);
  });
}
