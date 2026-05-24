import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { NangoStoreFacade } from "../store.js";

/**
 * Parse QuickBooks SQL-style query to extract entity name.
 * e.g. "SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100" → "Invoice"
 */
function parseQBEntity(query: string): string | null {
  const match = /FROM\s+(\w+)/i.exec(query);
  return match?.[1] ?? null;
}

/**
 * Build a QuickBooks QueryResponse envelope.
 * QB returns: { QueryResponse: { Invoice: [...], totalCount, startPosition, maxResults }, time }
 */
function buildQBResponse(entity: string, rows: Record<string, unknown>[], startPosition = 1) {
  return {
    QueryResponse: {
      [entity]: rows,
      totalCount: rows.length,
      startPosition,
      maxResults: rows.length,
    },
    time: new Date().toISOString(),
  };
}

/**
 * Infer entity name from Xero-style URL path.
 * e.g. "api.xro/2.0/Invoices" → "Invoice"
 *      "api.xro/2.0/Contacts" → "Contact"
 */
function inferXeroModel(path: string): string | null {
  // Take the last path segment, remove query string
  const segment = path.split("?")[0]?.split("/").pop();
  if (!segment) return null;
  // Xero pluralizes: Invoices → Invoice, Contacts → Contact
  if (segment.endsWith("s")) return segment.slice(0, -1);
  return segment;
}

/**
 * Build a Xero response envelope.
 * Xero returns: { [EntityPlural]: [...], Status: "OK", DateTimeUTC: "..." }
 */
function buildXeroResponse(entityPlural: string, rows: Record<string, unknown>[]) {
  return {
    [entityPlural]: rows,
    Status: "OK",
    DateTimeUTC: `/Date(${Date.now()})/`,
  };
}

// ---------------------------------------------------------------------------
// Google / Microsoft proxy fidelity
//
// Real Nango's /proxy forwards verbatim to the provider's own API, so callers
// see the provider's native JSON. We mirror that: infer the resource from the
// real-API path, look the seeded records up under a tolerant set of model
// aliases, and wrap them in the provider's native envelope. A trailing id
// segment (e.g. /messages/{id}) returns the single entity, matching the real
// API. Records themselves stay exactly as seeded — only routing + envelope are
// synthesised, which is precisely what the live proxy does.
// ---------------------------------------------------------------------------

/** Drop query string, split on "/", discard empties. */
function pathParts(path: string): string[] {
  return (path.split("?")[0] ?? "").split("/").filter(Boolean);
}

/**
 * First non-empty record set across a list of candidate model aliases, so a
 * connection seeded under `files`, `DriveFile`, or `GoogleDriveFile` all
 * resolve for a Drive `files` request.
 */
function resolveRecords(
  ns: NangoStoreFacade,
  connectionId: string,
  candidates: string[],
  providerHint: string,
): Record<string, unknown>[] {
  for (const model of candidates) {
    const rows = ns.getRecords(connectionId, model, providerHint);
    if (rows.length > 0) return rows;
  }
  return [];
}

/** Match a row by its `id`/`Id` field; fall back to the first row. */
function findById(rows: Record<string, unknown>[], id: string): Record<string, unknown> | undefined {
  return rows.find((r) => String(r.id ?? r.Id ?? r.ID ?? "") === id) ?? rows[0];
}

const DRIVE_FILE_MODELS = ["files", "file", "DriveFile", "GoogleDriveFile", "GoogleDriveFileMetadata", "Document"];
const GMAIL_MODELS = ["messages", "message", "GmailEmail", "Email"];
const GCAL_EVENT_MODELS = ["events", "event", "CalendarEvent", "GoogleCalendarEvent"];
const GRAPH_DRIVE_MODELS = ["driveItems", "driveItem", "DriveItem", "files", "items"];
const GRAPH_MAIL_MODELS = ["messages", "message", "Message", "Email", "mailMessages"];
const GRAPH_EVENT_MODELS = ["events", "event", "Event", "calendarEvents"];
const GRAPH_TEAM_MODELS = ["teams", "team", "Team", "joinedTeams"];
const GRAPH_CONTACT_MODELS = ["contacts", "contact", "Contact"];

// ---------------------------------------------------------------------------
// Pagination — faithful to the real provider mechanics.
//
// Google (Gmail/Drive/Calendar): opaque `nextPageToken`; the caller (or SDK)
// resubmits it as the `pageToken` query param. Microsoft Graph: an absolute
// `@odata.nextLink` URL the SDK follows verbatim, with the cursor in
// `$skiptoken`. The real tokens are opaque blobs, so a base64url-encoded
// offset is a legitimate stand-in — it only has to round-trip.
// ---------------------------------------------------------------------------

function encodeOffsetToken(offset: number): string {
  return Buffer.from(`o:${offset}`).toString("base64url");
}

/** Decode our token, a bare `$skip` integer, or nothing → start offset. */
function decodeOffsetToken(token: string | undefined | null): number {
  if (!token) return 0;
  try {
    const m = /^o:(\d+)$/.exec(Buffer.from(token, "base64url").toString("utf8"));
    if (m) return Number(m[1]);
  } catch {
    /* not our token — fall through to bare-integer handling */
  }
  const n = Number(token);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Resolve a provider page-size param against its real default/ceiling. */
function clampPageSize(raw: string | undefined, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

interface Page {
  rows: Record<string, unknown>[];
  /** Token for the *next* page, or null when this is the last page. */
  next: string | null;
  total: number;
}

function pageOf(all: Record<string, unknown>[], size: number, token: string | undefined | null): Page {
  const start = decodeOffsetToken(token);
  const rows = all.slice(start, start + size);
  const end = start + rows.length;
  return { rows, next: end < all.length ? encodeOffsetToken(end) : null, total: all.length };
}

/**
 * Microsoft Graph OData collection envelope with real pagination semantics:
 * `@odata.count` only when `$count=true`, and `@odata.nextLink` as an absolute
 * URL (the inbound request URL with the cursor swapped into `$skiptoken`) so a
 * Graph SDK following it routes straight back to this proxy.
 */
function graphCollection(resource: string, page: Page, reqUrl: string, wantCount: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    "@odata.context": `https://graph.microsoft.com/v1.0/$metadata#${resource}`,
  };
  if (wantCount) body["@odata.count"] = page.total;
  if (page.next) {
    const u = new URL(reqUrl);
    u.searchParams.delete("$skip");
    u.searchParams.set("$skiptoken", page.next);
    body["@odata.nextLink"] = u.toString();
  }
  body.value = page.rows;
  return body;
}

export function proxyRoutes(app: Hono<AppEnv>, ns: NangoStoreFacade, baseUrl: string): void {
  // QuickBooks proxy: GET /proxy/v3/company/:realmId/query
  // Convex sends: Authorization, Provider-Config-Key, Connection-Id headers
  app.get("/proxy/v3/company/:realmId/query", (c) => {
    const query = c.req.query("query") ?? "";
    const connectionId = c.req.header("Connection-Id") ?? c.req.header("connection-id") ?? "";
    const entity = parseQBEntity(query);

    if (!entity) {
      return c.json({ error: "Could not parse entity from query", query }, 400);
    }

    const rows = ns.getRecords(connectionId, entity, "quickbooks");
    return c.json(buildQBResponse(entity, rows));
  });

  // Generic Nango proxy: GET/POST/PUT /proxy/:path*
  // Handles Xero, MYOB, Google, Microsoft Graph, and other providers.
  // Route pattern must come after the QB-specific route.
  app.all("/proxy/*", (c) => {
    // Strip the /proxy/ prefix to get the provider-specific path
    const fullPath = c.req.path.replace(/^\/proxy\//, "");
    const connectionId = c.req.header("Connection-Id") ?? c.req.header("connection-id") ?? "";
    const providerConfigKey = c.req.header("Provider-Config-Key") ?? c.req.header("provider-config-key") ?? "";
    const key = providerConfigKey.toLowerCase();

    // Determine provider from path or config key
    const isXero = fullPath.startsWith("api.xro/") || key.includes("xero");
    const isMyob = fullPath.startsWith("api.myob.com/") || key.includes("myob");

    if (isXero) {
      const model = inferXeroModel(fullPath);
      if (!model) return c.json({ Status: "OK", [fullPath]: [] });
      const rows = ns.getRecords(connectionId, model, "xero");
      // Xero uses plural for the response key
      const plural = model.endsWith("s") ? model : `${model}s`;
      return c.json(buildXeroResponse(plural, rows));
    }

    if (isMyob) {
      // MYOB uses a REST-style response
      const segment = fullPath.split("?")[0]?.split("/").pop() ?? "Items";
      const rows = ns.getRecords(connectionId, segment, "myob");
      return c.json({ Items: rows, Count: rows.length, TotalCount: rows.length });
    }

    const parts = pathParts(fullPath);
    const has = (seg: string) => parts.includes(seg);
    // Id segment immediately following `seg`, or undefined if `seg` is absent
    // or is the last segment. Guards against indexOf(-1) + 1 → parts[0].
    const segAfter = (seg: string): string | undefined => {
      const i = parts.indexOf(seg);
      return i >= 0 ? parts[i + 1] : undefined;
    };

    // ---- Gmail API: gmail/v1/users/{userId}/messages[/{id}] ----
    // Real: maxResults default 100 / max 500, opaque pageToken.
    if (fullPath.includes("gmail/v1") || key.includes("google-mail") || key.includes("gmail")) {
      const all = resolveRecords(ns, connectionId, GMAIL_MODELS, "google-mail");
      const msgId = segAfter("messages");
      if (msgId) return c.json(findById(all, msgId) ?? {});
      const page = pageOf(all, clampPageSize(c.req.query("maxResults"), 100, 500), c.req.query("pageToken"));
      // The Gmail list endpoint returns id/threadId stubs only;
      // resultSizeEstimate is the total estimate, not the page size.
      const body: Record<string, unknown> = {
        messages: page.rows.map((r) => ({
          id: String(r.id ?? r.Id ?? ""),
          threadId: String(r.threadId ?? r.thread_id ?? r.id ?? ""),
        })),
        resultSizeEstimate: page.total,
      };
      if (page.next) body.nextPageToken = page.next;
      return c.json(body);
    }

    // ---- Google Drive v3: drive/v3/files[/{id}] ----
    // Real: pageSize default 100 / max 1000, opaque pageToken.
    if (fullPath.includes("drive/v3") || key.includes("google-drive")) {
      const all = resolveRecords(ns, connectionId, DRIVE_FILE_MODELS, "google-drive");
      const fileId = segAfter("files");
      if (fileId) return c.json(findById(all, fileId) ?? {});
      const page = pageOf(all, clampPageSize(c.req.query("pageSize"), 100, 1000), c.req.query("pageToken"));
      const body: Record<string, unknown> = {
        kind: "drive#fileList",
        incompleteSearch: false,
        files: page.rows,
      };
      if (page.next) body.nextPageToken = page.next;
      return c.json(body);
    }

    // ---- Google Calendar v3: calendar/v3/calendars/{calId}/events[/{id}] ----
    // Real: maxResults default 250 / max 2500; pages carry nextPageToken,
    // the final page carries nextSyncToken. No incompleteSearch (Drive-only).
    if (fullPath.includes("calendar/v3") || key.includes("google-calendar")) {
      const all = resolveRecords(ns, connectionId, GCAL_EVENT_MODELS, "google-calendar");
      const evId = segAfter("events");
      if (evId) return c.json(findById(all, evId) ?? {});
      const calId = decodeURIComponent(segAfter("calendars") ?? "primary");
      const page = pageOf(all, clampPageSize(c.req.query("maxResults"), 250, 2500), c.req.query("pageToken"));
      const body: Record<string, unknown> = {
        kind: "calendar#events",
        etag: `"${Date.now()}"`,
        summary: calId,
        updated: new Date().toISOString(),
        timeZone: "UTC",
        accessRole: "owner",
        defaultReminders: [],
        items: page.rows,
      };
      if (page.next) body.nextPageToken = page.next;
      else body.nextSyncToken = encodeOffsetToken(page.total);
      return c.json(body);
    }

    // ---- Microsoft Graph: v1.0|beta/... ----
    const isGraph =
      fullPath.startsWith("v1.0/") ||
      fullPath.startsWith("beta/") ||
      key.includes("microsoft") ||
      key.includes("onedrive") ||
      key.includes("outlook") ||
      key.includes("sharepoint") ||
      key.includes("teams");
    if (isGraph) {
      // Real Graph: $top page size, $skiptoken/$skip cursor, @odata.count
      // only when $count=true, @odata.nextLink as an absolute follow URL.
      const size = clampPageSize(c.req.query("$top"), 100, 999);
      const cursor = c.req.query("$skiptoken") ?? c.req.query("$skip");
      const wantCount = c.req.query("$count") === "true";
      // @odata.nextLink must be an absolute URL the SDK can follow verbatim.
      // c.req.url is the prefix-stripped internal URL (no service mount), so
      // rebuild against baseUrl (= http://host/nango) + the real proxy path.
      const externalUrl = `${baseUrl}/proxy/${fullPath}${new URL(c.req.url).search}`;
      const collection = (resource: string, all: Record<string, unknown>[]) =>
        graphCollection(resource, pageOf(all, size, cursor), externalUrl, wantCount);

      // mail
      if (has("messages") || has("mailFolders")) {
        const rows = resolveRecords(ns, connectionId, GRAPH_MAIL_MODELS, "outlook");
        const id = segAfter("messages");
        if (id) return c.json(findById(rows, id) ?? {});
        return c.json(collection("messages", rows));
      }
      // calendar events
      if (has("events") || has("calendarView") || has("calendar")) {
        const rows = resolveRecords(ns, connectionId, GRAPH_EVENT_MODELS, "outlook");
        const id = segAfter("events");
        if (id) return c.json(findById(rows, id) ?? {});
        return c.json(collection("events", rows));
      }
      // teams
      if (has("joinedTeams") || has("teams")) {
        const rows = resolveRecords(ns, connectionId, GRAPH_TEAM_MODELS, "microsoft-teams");
        const id = segAfter("teams") ?? segAfter("joinedTeams");
        if (id) return c.json(findById(rows, id) ?? {});
        return c.json(collection("teams", rows));
      }
      // contacts
      if (has("contacts")) {
        const rows = resolveRecords(ns, connectionId, GRAPH_CONTACT_MODELS, "outlook");
        const id = segAfter("contacts");
        if (id) return c.json(findById(rows, id) ?? {});
        return c.json(collection("contacts", rows));
      }
      // drive (default Graph resource: /me/drive/root/children, /drives/{id}/items, ...)
      if (has("drive") || has("drives") || has("children") || has("items")) {
        const rows = resolveRecords(ns, connectionId, GRAPH_DRIVE_MODELS, "onedrive");
        const id = segAfter("items");
        if (id) return c.json(findById(rows, id) ?? {});
        return c.json(collection("driveItems", rows));
      }
    }

    // Generic fallback — return empty array-style response
    const allRecords = ns.allRecordsForConnection(connectionId);
    return c.json({ records: Object.values(allRecords).flat(), path: fullPath });
  });
}
