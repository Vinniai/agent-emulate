import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproTask } from "../entities.js";
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

function formatTask(t: SimproTask) {
  return {
    ID: t.external_id,
    Name: t.name,
    Description: t.description,
    DueDate: t.due_date,
    AssignedTo: t.assigned_to_id ? { ID: t.assigned_to_id } : null,
    Completed: t.completed,
    DateCreated: t.date_created,
    DateModified: t.date_modified,
  };
}

export function taskRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // GET /tasks/ — all tasks
  app.get("/api/v1.0/companies/:cid/tasks/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.tasks.all().filter((t) => t.company_id === companyId || companyId === 0);
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatTask));
  });

  // GET /tasks/:tid
  app.get("/api/v1.0/companies/:cid/tasks/:tid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.tasks.findOneBy("external_id", Number(c.req.param("tid")));
    if (!t) return simproNotFound(c);
    return c.json(formatTask(t));
  });

  // POST /tasks/
  app.post("/api/v1.0/companies/:cid/tasks/", async (c) => {
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
    const externalId = nextExternalId(ss, "tasks", companyId);
    const now = nowIso();
    const t = ss.tasks.insert({
      company_id: companyId,
      external_id: externalId,
      parent_type: "global",
      parent_id: 0,
      name: body.Name as string,
      description: (body.Description as string | null) ?? null,
      due_date: (body.DueDate as string | null) ?? null,
      assigned_to_id:
        body.AssignedTo && typeof body.AssignedTo === "object"
          ? Number((body.AssignedTo as Record<string, unknown>).ID ?? 0) || null
          : null,
      completed: body.Completed !== undefined ? Boolean(body.Completed) : false,
      date_created: now,
      date_modified: now,
    });
    return c.json(formatTask(t), 201);
  });

  // PATCH /tasks/:tid
  app.patch("/api/v1.0/companies/:cid/tasks/:tid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.tasks.findOneBy("external_id", Number(c.req.param("tid")));
    if (!t) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.tasks.update(t.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.DueDate !== undefined && { due_date: body.DueDate as string | null }),
      ...(body.Completed !== undefined && { completed: Boolean(body.Completed) }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  // DELETE /tasks/:tid
  app.delete("/api/v1.0/companies/:cid/tasks/:tid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const t = ss.tasks.findOneBy("external_id", Number(c.req.param("tid")));
    if (!t) return simproNotFound(c);
    ss.tasks.delete(t.id);
    return c.body(null, 204);
  });

  // GET /jobs/:jid/tasks/ — filter by parent job
  app.get("/api/v1.0/companies/:cid/jobs/:jid/tasks/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const jid = Number(c.req.param("jid"));
    const items = ss.tasks
      .all()
      .filter((t) => t.parent_type === "job" && t.parent_id === jid && (t.company_id === companyId || companyId === 0));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatTask));
  });

  // GET /jobs/:jid/tasks/:tid
  app.get("/api/v1.0/companies/:cid/jobs/:jid/tasks/:tid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const jid = Number(c.req.param("jid"));
    const tid = Number(c.req.param("tid"));
    const t = ss.tasks.findOneBy("external_id", tid);
    if (!t || t.parent_type !== "job" || t.parent_id !== jid) return simproNotFound(c);
    return c.json(formatTask(t));
  });
}
