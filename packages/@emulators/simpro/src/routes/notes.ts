import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproNote } from "../entities.js";
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

function formatNote(n: SimproNote) {
  return {
    ID: n.external_id,
    Text: n.text,
    Author: n.author_id ? { ID: n.author_id } : null,
    DateCreated: n.date_created,
    DateModified: n.date_modified,
  };
}

type NoteParentType = "job" | "quote" | "customer" | "invoice" | "creditNote" | "recurringJob";

const parentPluralMap: Record<NoteParentType, string> = {
  job: "jobs",
  quote: "quotes",
  customer: "customers",
  invoice: "invoices",
  creditNote: "creditNotes",
  recurringJob: "recurringJobs",
};

function registerParentNoteRoutes(
  app: RouteContext["app"],
  store: RouteContext["store"],
  parentType: NoteParentType,
  parentPlural: string,
): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  const base = `/api/v1.0/companies/:cid/${parentPlural}/:parentId/notes`;

  // GET /{parentPlural}/:parentId/notes/
  app.get(`${base}/`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const parentId = Number(c.req.param("parentId"));
    const notes = ss.notes
      .all()
      .filter(
        (n) =>
          n.parent_type === parentType && n.parent_id === parentId && (n.company_id === companyId || companyId === 0),
      );
    const pagination = parsePagination(c);
    const page = paginate(c, notes, pagination);
    return c.json(page.map(formatNote));
  });

  // GET /{parentPlural}/:parentId/notes/:nid
  app.get(`${base}/:nid`, (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const parentId = Number(c.req.param("parentId"));
    const nid = Number(c.req.param("nid"));
    const note = ss.notes.findOneBy("external_id", nid);
    if (!note || note.parent_type !== parentType || note.parent_id !== parentId) {
      return simproNotFound(c);
    }
    return c.json(formatNote(note));
  });

  // POST /{parentPlural}/:parentId/notes/
  app.post(`${base}/`, async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const parentId = Number(c.req.param("parentId"));
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    if (!body.Text) return simproValidation(c, "Text", "Text is required.");
    const now = nowIso();
    const externalId = nextExternalId(ss, "notes", companyId);
    const note = ss.notes.insert({
      company_id: companyId,
      external_id: externalId,
      parent_type: parentType,
      parent_id: parentId,
      text: body.Text as string,
      date_created: now,
      date_modified: now,
      author_id: null,
    });
    return c.json(formatNote(note), 201);
  });
}

export function noteRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  // Register routes for each parent type
  for (const [type, plural] of Object.entries(parentPluralMap) as [NoteParentType, string][]) {
    registerParentNoteRoutes(app, store, type, plural);
  }

  // GET /notes/jobs/ — all job notes
  app.get("/api/v1.0/companies/:cid/notes/jobs/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const notes = ss.notes
      .all()
      .filter((n) => n.parent_type === "job" && (n.company_id === companyId || companyId === 0));
    const pagination = parsePagination(c);
    const page = paginate(c, notes, pagination);
    return c.json(page.map(formatNote));
  });

  // GET /notes/customers/ — all customer notes
  app.get("/api/v1.0/companies/:cid/notes/customers/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const notes = ss.notes
      .all()
      .filter((n) => n.parent_type === "customer" && (n.company_id === companyId || companyId === 0));
    const pagination = parsePagination(c);
    const page = paginate(c, notes, pagination);
    return c.json(page.map(formatNote));
  });
}
