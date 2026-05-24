import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproTimesheet } from "../entities.js";
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
import { nextExternalId } from "./jobs.js";

function formatTimesheet(t: SimproTimesheet) {
  return {
    ID: t.external_id,
    Employee: t.employee_id ? { ID: t.employee_id } : null,
    Contractor: t.contractor_id ? { ID: t.contractor_id } : null,
    Job: t.job_id ? { ID: t.job_id } : null,
    CostCenter: t.cost_center_id ? { ID: t.cost_center_id } : null,
    Date: t.date,
    StartTime: t.start_time,
    EndTime: t.end_time,
    DurationMinutes: t.duration_minutes,
    Notes: t.notes,
  };
}

export function timesheetRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ── Top-level timesheets list ─────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/timesheets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.timesheets.all().filter((t) => t.company_id === companyId || companyId === 0);

    const employeeId = c.req.query("Employee.ID");
    if (employeeId) items = items.filter((t) => t.employee_id === Number(employeeId));

    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((t) => t.job_id === Number(jobId));

    const dateFrom = c.req.query("DateFrom");
    if (dateFrom) items = items.filter((t) => t.date >= dateFrom);

    const dateTo = c.req.query("DateTo");
    if (dateTo) items = items.filter((t) => t.date <= dateTo);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatTimesheet));
  });

  // ── Employee timesheets ───────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/employees/:eid/timesheets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const employeeId = Number(c.req.param("eid"));
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.timesheets
      .all()
      .filter((t) => t.employee_id === employeeId && (t.company_id === companyId || companyId === 0));

    const dateFrom = c.req.query("DateFrom");
    if (dateFrom) items = items.filter((t) => t.date >= dateFrom);

    const dateTo = c.req.query("DateTo");
    if (dateTo) items = items.filter((t) => t.date <= dateTo);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatTimesheet));
  });

  // ── Contractor timesheets ─────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/contractors/:crid/timesheets/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const contractorId = Number(c.req.param("crid"));
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.timesheets
      .all()
      .filter((t) => t.contractor_id === contractorId && (t.company_id === companyId || companyId === 0));

    const dateFrom = c.req.query("DateFrom");
    if (dateFrom) items = items.filter((t) => t.date >= dateFrom);

    const dateTo = c.req.query("DateTo");
    if (dateTo) items = items.filter((t) => t.date <= dateTo);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatTimesheet));
  });

  // ── Single timesheet ──────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/timesheets/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.timesheets.findOneBy("external_id", Number(c.req.param("id")));
    if (!t) return simproNotFound(c);
    return c.json(formatTimesheet(t));
  });

  // ── Create timesheet ──────────────────────────────────────────────────────

  app.post("/api/v1.0/companies/:cid/timesheets/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Date) return simproValidation(c, "Date", "Date is required.");
    if (!body.StartTime) return simproValidation(c, "StartTime", "StartTime is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "timesheets", companyId);
    const t = ss.timesheets.insert({
      company_id: companyId,
      external_id: externalId,
      employee_id: (body.Employee as { ID?: number } | undefined)?.ID ?? null,
      contractor_id: (body.Contractor as { ID?: number } | undefined)?.ID ?? null,
      job_id: (body.Job as { ID?: number } | undefined)?.ID ?? null,
      cost_center_id: (body.CostCenter as { ID?: number } | undefined)?.ID ?? null,
      date: body.Date as string,
      start_time: body.StartTime as string,
      end_time: (body.EndTime as string | null) ?? null,
      duration_minutes: (body.DurationMinutes as number) ?? 0,
      notes: (body.Notes as string | null) ?? null,
    });
    return c.json(formatTimesheet(t), 201);
  });

  // ── Update timesheet ──────────────────────────────────────────────────────

  app.patch("/api/v1.0/companies/:cid/timesheets/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.timesheets.findOneBy("external_id", Number(c.req.param("id")));
    if (!t) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.timesheets.update(t.id, {
      ...(body.Employee !== undefined && { employee_id: (body.Employee as { ID?: number }).ID ?? null }),
      ...(body.Contractor !== undefined && { contractor_id: (body.Contractor as { ID?: number }).ID ?? null }),
      ...(body.Job !== undefined && { job_id: (body.Job as { ID?: number }).ID ?? null }),
      ...(body.CostCenter !== undefined && { cost_center_id: (body.CostCenter as { ID?: number }).ID ?? null }),
      ...(body.Date !== undefined && { date: body.Date as string }),
      ...(body.StartTime !== undefined && { start_time: body.StartTime as string }),
      ...(body.EndTime !== undefined && { end_time: body.EndTime as string | null }),
      ...(body.DurationMinutes !== undefined && { duration_minutes: body.DurationMinutes as number }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
    });
    return c.body(null, 204);
  });

  // ── Delete timesheet ──────────────────────────────────────────────────────

  app.delete("/api/v1.0/companies/:cid/timesheets/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.timesheets.findOneBy("external_id", Number(c.req.param("id")));
    if (!t) return simproNotFound(c);
    ss.timesheets.delete(t.id);
    return c.body(null, 204);
  });
}
