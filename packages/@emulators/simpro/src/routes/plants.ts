import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproPlant, SimproPlantType } from "../entities.js";
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

function formatPlantType(pt: SimproPlantType) {
  return { ID: pt.external_id, Name: pt.name, Description: pt.description, Archived: pt.archived };
}

function formatPlant(p: SimproPlant) {
  return {
    ID: p.external_id,
    PlantType: { ID: p.plant_type_id },
    Name: p.name,
    SerialNo: p.serial_number,
    Description: p.description,
    Archived: p.archived,
    DateModified: p.date_modified,
  };
}

export function plantRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // ──────────────────────────────────────────────────────────────
  // Plant Types
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/plantTypes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.plantTypes.all().filter((pt) => pt.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPlantType));
  });

  app.get("/api/v1.0/companies/:cid/plantTypes/:ptid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const pt = ss.plantTypes.findOneBy("external_id", Number(c.req.param("ptid")));
    if (!pt) return simproNotFound(c);
    return c.json(formatPlantType(pt));
  });

  app.post("/api/v1.0/companies/:cid/plantTypes/", async (c) => {
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
    const externalId = nextExternalId(ss, "plantTypes", companyId);
    const pt = ss.plantTypes.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      description: (body.Description as string | null) ?? null,
      archived: false,
    });
    return c.json(formatPlantType(pt), 201);
  });

  app.patch("/api/v1.0/companies/:cid/plantTypes/:ptid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const pt = ss.plantTypes.findOneBy("external_id", Number(c.req.param("ptid")));
    if (!pt) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.plantTypes.update(pt.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/plantTypes/:ptid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const pt = ss.plantTypes.findOneBy("external_id", Number(c.req.param("ptid")));
    if (!pt) return simproNotFound(c);
    ss.plantTypes.delete(pt.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Plants nested under plant types
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/plantTypes/:ptid/plants/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ptId = Number(c.req.param("ptid"));
    const items = ss.plants.findBy("plant_type_id", ptId);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPlant));
  });

  app.get("/api/v1.0/companies/:cid/plantTypes/:ptid/plants/:pid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ptId = Number(c.req.param("ptid"));
    const p = ss.plants.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p || p.plant_type_id !== ptId) return simproNotFound(c);
    return c.json(formatPlant(p));
  });

  app.post("/api/v1.0/companies/:cid/plantTypes/:ptid/plants/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ptId = Number(c.req.param("ptid"));
    const pt = ss.plantTypes.findOneBy("external_id", ptId);
    if (!pt) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Name) return simproValidation(c, "Name", "Name is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "plants", companyId);
    const p = ss.plants.insert({
      company_id: companyId,
      external_id: externalId,
      plant_type_id: ptId,
      name: body.Name as string,
      serial_number: (body.SerialNo as string | null) ?? null,
      description: (body.Description as string | null) ?? null,
      archived: false,
      date_modified: nowIso(),
    });
    return c.json(formatPlant(p), 201);
  });

  app.patch("/api/v1.0/companies/:cid/plantTypes/:ptid/plants/:pid", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ptId = Number(c.req.param("ptid"));
    const p = ss.plants.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p || p.plant_type_id !== ptId) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.plants.update(p.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.SerialNo !== undefined && { serial_number: body.SerialNo as string | null }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Archived !== undefined && { archived: Boolean(body.Archived) }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/plantTypes/:ptid/plants/:pid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const ptId = Number(c.req.param("ptid"));
    const p = ss.plants.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p || p.plant_type_id !== ptId) return simproNotFound(c);
    ss.plants.delete(p.id);
    return c.body(null, 204);
  });

  // ──────────────────────────────────────────────────────────────
  // Flat plants list
  // ──────────────────────────────────────────────────────────────

  app.get("/api/v1.0/companies/:cid/plants/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.plants.all().filter((p) => p.company_id === companyId || companyId === 0);
    return c.json(paginate(c, items, parsePagination(c)).map(formatPlant));
  });

  app.get("/api/v1.0/companies/:cid/plants/:pid", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.plants.findOneBy("external_id", Number(c.req.param("pid")));
    if (!p) return simproNotFound(c);
    return c.json(formatPlant(p));
  });
}
