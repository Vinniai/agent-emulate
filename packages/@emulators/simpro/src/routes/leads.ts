import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproLead, SimproNote } from "../entities.js";
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

function formatLead(lead: SimproLead) {
  return {
    ID: lead.external_id,
    Name: lead.name,
    Description: lead.description,
    Customer: lead.customer_id ? { ID: lead.customer_id } : null,
    Site: lead.site_id ? { ID: lead.site_id } : null,
    Stage: lead.stage,
    Salesperson: lead.salesperson_id ? { ID: lead.salesperson_id } : null,
    DateIssued: lead.date_issued,
    Tags: lead.tags.map((t) => ({ ID: 0, Name: t })),
    DateModified: lead.date_modified,
  };
}

function formatNote(n: SimproNote) {
  return {
    ID: n.external_id,
    Text: n.text,
    Author: n.author_id ? { ID: n.author_id } : null,
    DateCreated: n.date_created,
    DateModified: n.date_modified,
  };
}

export function leadRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // GET /leads/
  app.get("/api/v1.0/companies/:cid/leads/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.leads.all().filter((l) => l.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((l) => l.customer_id === Number(customerId));
    const stage = c.req.query("Stage");
    if (stage) items = items.filter((l) => l.stage === stage);
    const search = c.req.query("Search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((l) => l.name.toLowerCase().includes(q));
    }
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map(formatLead));
  });

  // GET /leads/:id
  app.get("/api/v1.0/companies/:cid/leads/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    return c.json(formatLead(lead));
  });

  // POST /leads/
  app.post("/api/v1.0/companies/:cid/leads/", async (c) => {
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
    const externalId = nextExternalId(ss, "leads", companyId);
    const now = nowIso();
    const lead = ss.leads.insert({
      company_id: companyId,
      external_id: externalId,
      name: body.Name as string,
      description: (body.Description as string | null) ?? null,
      customer_id: body["Customer.ID"]
        ? Number(body["Customer.ID"])
        : body.Customer && typeof body.Customer === "object"
          ? Number((body.Customer as Record<string, unknown>).ID ?? 0) || null
          : null,
      site_id: body["Site.ID"]
        ? Number(body["Site.ID"])
        : body.Site && typeof body.Site === "object"
          ? Number((body.Site as Record<string, unknown>).ID ?? 0) || null
          : null,
      status_id: null,
      stage: (body.Stage as SimproLead["stage"]) ?? "New",
      salesperson_id:
        body.Salesperson && typeof body.Salesperson === "object"
          ? Number((body.Salesperson as Record<string, unknown>).ID ?? 0) || null
          : null,
      date_issued: (body.DateIssued as string | null) ?? now.substring(0, 10),
      date_modified: now,
      tags: Array.isArray(body.Tags) ? (body.Tags as string[]) : [],
    });
    return c.json(formatLead(lead), 201);
  });

  // PATCH /leads/:id
  app.patch("/api/v1.0/companies/:cid/leads/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.leads.update(lead.id, {
      ...(body.Name !== undefined && { name: body.Name as string }),
      ...(body.Description !== undefined && { description: body.Description as string | null }),
      ...(body.Stage !== undefined && { stage: body.Stage as SimproLead["stage"] }),
      ...(body.DateIssued !== undefined && { date_issued: body.DateIssued as string | null }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  // DELETE /leads/:id
  app.delete("/api/v1.0/companies/:cid/leads/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    ss.leads.delete(lead.id);
    return c.body(null, 204);
  });

  // GET /leads/:id/notes/
  app.get("/api/v1.0/companies/:cid/leads/:id/notes/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    const notes = ss.notes
      .all()
      .filter((n) => n.parent_type === "lead" && n.parent_id === lead.external_id && n.company_id === lead.company_id);
    const pagination = parsePagination(c);
    const page = paginate(c, notes, pagination);
    return c.json(page.map(formatNote));
  });

  // POST /leads/:id/notes/
  app.post("/api/v1.0/companies/:cid/leads/:id/notes/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Text) return simproValidation(c, "Text", "Text is required.");
    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "notes", companyId);
    const now = nowIso();
    const note = ss.notes.insert({
      company_id: companyId,
      external_id: externalId,
      parent_type: "lead",
      parent_id: lead.external_id,
      text: body.Text as string,
      date_created: now,
      date_modified: now,
      author_id: null,
    });
    return c.json(formatNote(note), 201);
  });

  // GET /leads/:id/customFields/
  app.get("/api/v1.0/companies/:cid/leads/:id/customFields/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const lead = ss.leads.findOneBy("external_id", Number(c.req.param("id")));
    if (!lead) return simproNotFound(c);
    return c.json([]);
  });
}
