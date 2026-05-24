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
  simproValidation,
} from "../helpers.js";
import { formatSchedule } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function scheduleRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/schedules/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.schedules.all().filter((s) => s.company_id === companyId || companyId === 0);

    const jobId = c.req.query("Job.ID");
    if (jobId) items = items.filter((s) => s.job_id === Number(jobId));

    const technicianId = c.req.query("Technician.ID");
    if (technicianId) items = items.filter((s) => s.technician_id === Number(technicianId));

    const dateFrom = c.req.query("DateFrom");
    if (dateFrom) items = items.filter((s) => s.date >= dateFrom);
    const dateTo = c.req.query("DateTo");
    if (dateTo) items = items.filter((s) => s.date <= dateTo);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((s) => formatSchedule(s)));
  });

  app.get("/api/v1.0/companies/:cid/schedules/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.schedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!s) return simproNotFound(c);
    return c.json(formatSchedule(s));
  });

  app.post("/api/v1.0/companies/:cid/schedules/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const jobRef = body.Job as { ID?: number } | undefined;
    if (!jobRef?.ID) return simproValidation(c, "Job.ID", "Job is required.");
    const techRef = body.Technician as { ID?: number } | undefined;
    if (!techRef?.ID) return simproValidation(c, "Technician.ID", "Technician is required.");
    if (!body.Date) return simproValidation(c, "Date", "Date is required.");
    if (!body.StartTime) return simproValidation(c, "StartTime", "StartTime is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "schedules", companyId);
    const s = ss.schedules.insert({
      company_id: companyId,
      external_id: externalId,
      job_id: jobRef.ID,
      section_id: (body.Section as { ID?: number } | undefined)?.ID ?? null,
      cost_center_id: (body.CostCenter as { ID?: number } | undefined)?.ID ?? null,
      technician_id: techRef.ID,
      date: body.Date as string,
      start_time: body.StartTime as string,
      duration_minutes: (body.DurationMinutes as number) ?? 60,
    });
    return c.json(formatSchedule(s), 201);
  });

  app.patch("/api/v1.0/companies/:cid/schedules/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.schedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!s) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.schedules.update(s.id, {
      ...(body.Job !== undefined && { job_id: (body.Job as { ID?: number }).ID ?? s.job_id }),
      ...(body.Technician !== undefined && {
        technician_id: (body.Technician as { ID?: number }).ID ?? s.technician_id,
      }),
      ...(body.Section !== undefined && { section_id: (body.Section as { ID?: number }).ID ?? null }),
      ...(body.CostCenter !== undefined && { cost_center_id: (body.CostCenter as { ID?: number }).ID ?? null }),
      ...(body.Date !== undefined && { date: body.Date as string }),
      ...(body.StartTime !== undefined && { start_time: body.StartTime as string }),
      ...(body.DurationMinutes !== undefined && { duration_minutes: body.DurationMinutes as number }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/schedules/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const s = ss.schedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!s) return simproNotFound(c);
    ss.schedules.delete(s.id);
    return c.body(null, 204);
  });
}
