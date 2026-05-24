import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SimproStore } from "./store.js";

export interface SimproError {
  path: string | null;
  message: string;
  value: unknown;
}

/**
 * All Simpro 4xx/5xx responses share a single envelope:
 *   { "errors": [{ "path": null, "message": "...", "value": null }] }
 */
export function simproError(
  c: Context,
  status: number,
  message: string,
  path: string | null = null,
  value: unknown = null,
) {
  return c.json({ errors: [{ path, message, value } satisfies SimproError] }, status as ContentfulStatusCode);
}

export function simproNotFound(c: Context) {
  return simproError(c, 404, "Invalid route.");
}

export function simproValidation(c: Context, path: string, message: string, value: unknown = null) {
  return simproError(c, 422, message, path, value);
}

export function token(prefix: string, bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requireAuth(c: Context, ss: SimproStore) {
  const token = bearerToken(c);
  if (!token) return simproError(c, 401, "Authentication required.");
  const row = ss.oauthTokens.findOneBy("access_token", token);
  if (!row || row.revoked) return simproError(c, 401, "Invalid or expired access token.");
  if (row.expires_at < Date.now()) return simproError(c, 401, "Access token has expired.");
  return null;
}

/**
 * Simpro pagination: ?page=1 (default), ?pageSize=30 (max 250).
 * Writes Result-Total, Result-Pages, Result-Count response headers.
 */
export interface SimproPagination {
  page: number;
  pageSize: number;
}

export function parsePagination(c: Context): SimproPagination {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = Math.min(250, Math.max(1, parseInt(c.req.query("pageSize") ?? "30", 10) || 30));
  return { page, pageSize };
}

export function paginate<T>(c: Context, items: T[], pagination: SimproPagination): T[] {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const start = (pagination.page - 1) * pagination.pageSize;
  const pageItems = items.slice(start, start + pagination.pageSize);
  c.header("Result-Total", String(total));
  c.header("Result-Pages", String(pages));
  c.header("Result-Count", String(pageItems.length));
  return pageItems;
}

/**
 * Apply Simpro's ?columns=ID,Name,Customer projection. When omitted Simpro
 * returns a minimal shape; when present only the listed top-level keys are
 * returned. Nested paths (e.g. Customer.ID) are not honoured — this matches
 * the observed behaviour: the whole "Customer" object is included verbatim.
 */
export function applyColumns<T extends Record<string, unknown>>(
  obj: T,
  columnsParam: string | undefined,
): Record<string, unknown> {
  if (!columnsParam) return obj;
  const requested = columnsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const col of requested) {
    if (col in obj) out[col] = obj[col];
  }
  return out;
}

export function isDisplayAll(c: Context): boolean {
  return (c.req.query("display") ?? "").toLowerCase() === "all";
}

export async function parseJson(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Problems parsing JSON");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function jobStageToString(stage: number): string {
  const map: Record<number, string> = {
    2: "Pending",
    3: "Progress",
    4: "Complete",
    5: "Invoiced",
    6: "Archived",
  };
  return map[stage] ?? "Pending";
}

export function jobStageFromString(stage: string): number {
  const map: Record<string, number> = {
    Pending: 2,
    Progress: 3,
    Complete: 4,
    Invoiced: 5,
    Archived: 6,
  };
  return map[stage] ?? 2;
}

export function ccStageToString(stage: number): string {
  const map: Record<number, string> = {
    1: "Declined",
    2: "Pending",
    3: "InProgress",
    4: "Complete",
    5: "Invoiced",
    6: "AwaitingApproval",
  };
  return map[stage] ?? "Pending";
}

export function ccStageFromString(stage: string): number {
  const map: Record<string, number> = {
    Declined: 1,
    Pending: 2,
    InProgress: 3,
    Complete: 4,
    Invoiced: 5,
    AwaitingApproval: 6,
  };
  return map[stage] ?? 2;
}

/**
 * Simple per-token fixed-window rate limiter: 10 requests / second.
 * Guarded behind store.setData("simpro.rate_limit_enabled", true).
 */
interface RateWindow {
  start: number;
  count: number;
}

const RATE_WINDOWS = new Map<string, RateWindow>();
const RATE_LIMIT_PER_SEC = 10;

export function rateLimit(c: Context, enabled: boolean): Response | null {
  if (!enabled) return null;
  const token = bearerToken(c) ?? c.req.header("X-Forwarded-For") ?? "anon";
  const now = Date.now();
  const win = RATE_WINDOWS.get(token);
  if (!win || now - win.start >= 1000) {
    RATE_WINDOWS.set(token, { start: now, count: 1 });
    return null;
  }
  win.count++;
  if (win.count > RATE_LIMIT_PER_SEC) {
    c.header("Retry-After", "1");
    return simproError(c, 429, "Rate limit exceeded. Please retry after 1 second.") as unknown as Response;
  }
  return null;
}

export function resetRateLimit(): void {
  RATE_WINDOWS.clear();
}
