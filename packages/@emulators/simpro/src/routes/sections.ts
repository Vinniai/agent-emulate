import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import {
  isDisplayAll,
  nowIso,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
} from "../helpers.js";
import { formatSection } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function sectionRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Parameters<typeof rateLimit>[0]): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/jobs/:jid/sections/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const job = ss.jobs.findOneBy("external_id", jobId);
    if (!job) return simproNotFound(c);

    const items = ss.sections.findBy("job_id", jobId).sort((a, b) => a.display_order - b.display_order);

    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);

    const displayAll = isDisplayAll(c);
    return c.json(page.map((s) => formatSection(s, { displayAll, ss })));
  });

  app.get("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const sectionId = Number(c.req.param("sid"));
    const section = ss.sections.findOneBy("external_id", sectionId);
    if (!section || section.job_id !== Number(c.req.param("jid"))) return simproNotFound(c);

    const displayAll = isDisplayAll(c);
    return c.json(formatSection(section, { displayAll, ss }));
  });

  app.post("/api/v1.0/companies/:cid/jobs/:jid/sections/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const jobId = Number(c.req.param("jid"));
    const job = ss.jobs.findOneBy("external_id", jobId);
    if (!job) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "sections", companyId);
    const siblings = ss.sections.findBy("job_id", jobId);
    const displayOrder = siblings.length === 0 ? 1 : Math.max(...siblings.map((s) => s.display_order)) + 1;

    const section = ss.sections.insert({
      company_id: companyId,
      external_id: externalId,
      job_id: jobId,
      name: (body.Name as string) ?? `Section ${externalId}`,
      description: (body.Description as string) ?? null,
      display_order: (body.DisplayOrder as number) ?? displayOrder,
      date_modified: nowIso(),
    });

    return c.json(formatSection(section, { ss }), 201);
  });

  app.patch("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const section = ss.sections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!section) return simproNotFound(c);

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    ss.sections.update(section.id, {
      ...(body.Name !== undefined && { name: String(body.Name) }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.DisplayOrder !== undefined && { display_order: Number(body.DisplayOrder) }),
      date_modified: nowIso(),
    });

    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/jobs/:jid/sections/:sid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    const section = ss.sections.findOneBy("external_id", Number(c.req.param("sid")));
    if (!section) return simproNotFound(c);

    // Cascade delete cost centers in the section.
    for (const cc of ss.costCenters.findBy("section_id", section.external_id)) {
      ss.costCenters.delete(cc.id);
    }
    ss.sections.delete(section.id);
    return c.body(null, 204);
  });
}
