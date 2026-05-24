import type { Context } from "hono";

export function uptickError(c: Context, status: number, title: string): Response {
  return c.json({ errors: [{ status: String(status), title }] }, status as 400 | 401 | 404 | 422 | 500);
}

export function parseId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

export async function parseJsonApiBody(c: Context): Promise<{
  attributes: Record<string, unknown>;
  relationships: Record<string, unknown>;
}> {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const data = (body.data ?? body) as Record<string, unknown>;
    return {
      attributes: (data.attributes ?? {}) as Record<string, unknown>,
      relationships: (data.relationships ?? {}) as Record<string, unknown>,
    };
  } catch {
    return { attributes: {}, relationships: {} };
  }
}

// Extract the related resource ID from a JSON:API relationship object
// e.g. { data: { type: "Client", id: "1" } } → 1
export function relId(rel: unknown): number | null {
  if (!rel || typeof rel !== "object") return null;
  const data = (rel as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const id = (data as Record<string, unknown>).id;
  if (id === undefined || id === null) return null;
  const n = parseInt(String(id), 10);
  return isNaN(n) ? null : n;
}

interface PaginationResult<T> {
  items: T[];
  nextUrl: string | null;
  prevUrl: string | null;
}

function filterByUpdatedSince<T extends { updated_at: string }>(items: T[], since: string | null): T[] {
  if (!since) return items;
  try {
    const sinceMs = new Date(since).getTime();
    return items.filter((item) => new Date(item.updated_at).getTime() >= sinceMs);
  } catch {
    return items;
  }
}

export function paginateItems<T extends { updated_at: string }>(
  c: Context,
  allItems: T[],
  resourcePath: string,
): PaginationResult<T> {
  const url = new URL(c.req.url);
  const updatedSince = url.searchParams.get("updatedsince");

  // Apply incremental filter first
  const filtered = filterByUpdatedSince(allItems, updatedSince);

  // Cursor-based pagination: page[cursor] present (value may be empty string or a cursor token)
  const hasCursor = url.searchParams.has("page[cursor]");
  const pageSize = parseInt(url.searchParams.get("page[size]") ?? "50", 10);

  // Limit/offset pagination
  const pageLimit = parseInt(url.searchParams.get("page[limit]") ?? "50", 10);
  const pageOffset = parseInt(url.searchParams.get("page[offset]") ?? "0", 10);

  let offset: number;
  let limit: number;

  if (hasCursor) {
    const cursorVal = url.searchParams.get("page[cursor]") ?? "";
    if (cursorVal) {
      try {
        offset = parseInt(Buffer.from(cursorVal, "base64").toString("utf-8"), 10);
      } catch {
        offset = 0;
      }
    } else {
      offset = 0;
    }
    limit = isNaN(pageSize) ? 50 : Math.min(pageSize, 250);
  } else {
    offset = isNaN(pageOffset) ? 0 : pageOffset;
    limit = isNaN(pageLimit) ? 50 : Math.min(pageLimit, 250);
  }

  const slice = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasNext = nextOffset < filtered.length;
  const hasPrev = offset > 0;

  const baseUrl = `${url.origin}${resourcePath}`;

  let nextUrl: string | null = null;
  let prevUrl: string | null = null;

  if (hasNext) {
    if (hasCursor) {
      const nextCursor = Buffer.from(String(nextOffset)).toString("base64");
      nextUrl = `${baseUrl}?page[cursor]=${nextCursor}&page[size]=${limit}`;
    } else {
      nextUrl = `${baseUrl}?page[limit]=${limit}&page[offset]=${nextOffset}`;
    }
    if (updatedSince) nextUrl += `&updatedsince=${encodeURIComponent(updatedSince)}`;
  }

  if (hasPrev) {
    const prevOff = Math.max(0, offset - limit);
    if (hasCursor) {
      const prevCursor = Buffer.from(String(prevOff)).toString("base64");
      prevUrl = `${baseUrl}?page[cursor]=${prevCursor}&page[size]=${limit}`;
    } else {
      prevUrl = `${baseUrl}?page[limit]=${limit}&page[offset]=${prevOff}`;
    }
    if (updatedSince) prevUrl += `&updatedsince=${encodeURIComponent(updatedSince)}`;
  }

  return { items: slice, nextUrl, prevUrl };
}

export function uptickPaginate<T extends { updated_at: string }>(
  c: Context,
  allItems: T[],
  formatFn: (item: T) => unknown,
  resourcePath: string,
): Response {
  const { items, nextUrl, prevUrl } = paginateItems(c, allItems, resourcePath);
  return c.json({
    data: items.map(formatFn),
    links: {
      next: nextUrl,
      prev: prevUrl,
    },
  });
}
