import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproActivitySchedule } from "../entities.js";
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

function formatActivitySchedule(a: SimproActivitySchedule) {
  return {
    ID: a.external_id,
    Technician: { ID: a.technician_id },
    Date: a.date,
    StartTime: a.start_time,
    DurationMinutes: a.duration_minutes,
    ActivityType: a.activity_type,
    Notes: a.notes,
  };
}

export function activityScheduleRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/activitySchedules/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.activitySchedules.all().filter((a) => a.company_id === companyId || companyId === 0);

    const technicianId = c.req.query("Technician.ID");
    if (technicianId) items = items.filter((a) => a.technician_id === Number(technicianId));

    const dateFrom = c.req.query("DateFrom");
    if (dateFrom) items = items.filter((a) => a.date >= dateFrom);

    const dateTo = c.req.query("DateTo");
    if (dateTo) items = items.filter((a) => a.date <= dateTo);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatActivitySchedule));
  });

  app.get("/api/v1.0/companies/:cid/activitySchedules/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.activitySchedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    return c.json(formatActivitySchedule(a));
  });

  app.post("/api/v1.0/companies/:cid/activitySchedules/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const techRef = body.Technician as { ID?: number } | undefined;
    if (!techRef?.ID) return simproValidation(c, "Technician.ID", "Technician.ID is required.");
    if (!body.Date) return simproValidation(c, "Date", "Date is required.");
    if (!body.StartTime) return simproValidation(c, "StartTime", "StartTime is required.");
    if (!body.ActivityType) return simproValidation(c, "ActivityType", "ActivityType is required.");

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "activitySchedules", companyId);
    const a = ss.activitySchedules.insert({
      company_id: companyId,
      external_id: externalId,
      technician_id: techRef.ID,
      date: body.Date as string,
      start_time: body.StartTime as string,
      duration_minutes: Number(body.DurationMinutes ?? 60),
      activity_type: body.ActivityType as string,
      notes: (body.Notes as string | null) ?? null,
    });
    return c.json(formatActivitySchedule(a), 201);
  });

  app.patch("/api/v1.0/companies/:cid/activitySchedules/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.activitySchedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.activitySchedules.update(a.id, {
      ...((body.Technician as { ID?: number } | undefined)?.ID !== undefined && {
        technician_id: (body.Technician as { ID: number }).ID,
      }),
      ...(body.Date !== undefined && { date: body.Date as string }),
      ...(body.StartTime !== undefined && { start_time: body.StartTime as string }),
      ...(body.DurationMinutes !== undefined && { duration_minutes: Number(body.DurationMinutes) }),
      ...(body.ActivityType !== undefined && { activity_type: body.ActivityType as string }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/activitySchedules/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const a = ss.activitySchedules.findOneBy("external_id", Number(c.req.param("id")));
    if (!a) return simproNotFound(c);
    ss.activitySchedules.delete(a.id);
    return c.body(null, 204);
  });
}
