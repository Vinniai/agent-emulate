import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import type { RouteContext, Store } from "@emulators/core";
import { applyColumns, paginate, parsePagination, rateLimit, requireAuth, simproError } from "../helpers.js";
import { getSimproStore } from "../store.js";

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";
type SwaggerRecord = Record<string, unknown>;

export type SimproSwaggerRecords = Record<string, SwaggerRecord[]>;

export interface SimproSwaggerSeedOptions {
  baseDate?: Date | string;
  pastDays?: number;
  futureDays?: number;
  frequencyDays?: number;
  companyId?: number | string;
}

interface SwaggerSpec {
  paths: Record<string, Record<string, SwaggerOperation | unknown>>;
  definitions?: Record<string, SwaggerSchema>;
}

interface SwaggerOperation {
  operationId?: string;
  tags?: string[];
  responses?: Record<string, SwaggerResponse>;
}

interface SwaggerResponse {
  description?: string;
  schema?: SwaggerSchema;
}

interface SwaggerSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: SwaggerSchema;
  properties?: Record<string, SwaggerSchema>;
  additionalProperties?: boolean | SwaggerSchema;
  example?: unknown;
  default?: unknown;
}

interface SpecRoute {
  method: HttpMethod;
  specPath: string;
  honoPath: string;
  params: SpecRouteParam[];
  operation: SwaggerOperation;
}

interface SpecRouteParam {
  specName: string;
  honoName: string;
}

const METHODS = new Set<HttpMethod>(["get", "post", "patch", "put", "delete"]);
const STORE_KEY = "simpro.swagger_records";

let cachedSpec: SwaggerSpec | null = null;

export function seedSimproSwaggerRecords(store: Store, records: SimproSwaggerRecords | undefined): void {
  const clean = new Map<string, SwaggerRecord[]>();
  for (const [path, rows] of Object.entries(records ?? {})) {
    clean.set(
      path,
      rows.map((row) => ({ ...row })),
    );
  }
  store.setData(STORE_KEY, clean);
}

export function exportSimproSwaggerRecords(store: Store): SimproSwaggerRecords | undefined {
  const records = getSwaggerRecords(store);
  const entries = [...records.entries()].filter(([, rows]) => rows.length > 0);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([path, rows]) => [path, rows.map((row) => ({ ...row }))]));
}

export function fillSimproSwaggerRecordsFromSpec(store: Store, options: SimproSwaggerSeedOptions = {}): void {
  const spec = loadSimproSwaggerSpec();
  const records = getSwaggerRecords(store);
  const baseDate = dateOnly(options.baseDate ?? new Date());
  const pastDays = Math.max(0, Math.floor(options.pastDays ?? 90));
  const futureDays = Math.max(0, Math.floor(options.futureDays ?? 180));
  const frequencyDays = Math.max(1, Math.floor(options.frequencyDays ?? 7));
  const offsets: number[] = [];
  for (let day = -pastDays; day <= futureDays; day += frequencyDays) offsets.push(day);
  if (!offsets.includes(0)) offsets.push(0);
  offsets.sort((a, b) => a - b);

  let routeIndex = 0;
  for (const route of enumerateRoutes(spec)) {
    if (route.method !== "get") continue;
    const success = successResponse(route.operation.responses ?? {});
    if (!isArraySchema(spec, success?.response.schema, new Set())) continue;

    const collectionKey = concreteCollectionPath(route.specPath, route.params, options.companyId ?? 0);
    const rows = records.get(collectionKey) ?? [];
    const existingIds = new Set(rows.map((row) => String(recordId(row))).filter((id) => id !== "undefined"));
    const itemSchema = collectionItemSchema(spec, success?.response.schema);
    const collectionSlug = route.specPath.split("/").filter(Boolean).at(-1) ?? "record";

    offsets.forEach((offset, offsetIndex) => {
      const id = routeIndex * 100_000 + offsetIndex + 1;
      if (existingIds.has(String(id))) return;
      const date = addDays(baseDate, offset);
      const record = enrichSwaggerRecord(specRecordForSchema(spec, itemSchema), {
        id,
        date,
        collectionSlug,
        path: collectionKey,
      });
      if (record && typeof record === "object" && !Array.isArray(record)) {
        rows.push(ensureRecordId(record as SwaggerRecord, rows));
      }
    });

    records.set(collectionKey, rows);
    routeIndex += 1;
  }

  store.setData(STORE_KEY, records);
}

export function simproSpecFallbackRoutes({ app, store }: RouteContext): void {
  const spec = loadSimproSwaggerSpec();
  const ss = getSimproStore(store);

  for (const route of enumerateRoutes(spec)) {
    app[route.method](route.honoPath, async (c) => {
      const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
      const limited = rateLimit(c, rateEnabled);
      if (limited) return limited;

      const auth = requireAuth(c, ss);
      if (auth) return auth as unknown as Response;

      const parsedBody = await parseJsonBody(c, route.method);
      if (!parsedBody.ok) return simproError(c, 400, "Problems parsing JSON.");

      const stateful = applyStatefulFallback(c, store, spec, route, parsedBody.value);
      if (stateful) return stateful;

      if (route.method === "delete") {
        return c.body(null, 204);
      }

      const success = successResponse(route.operation.responses ?? {});
      if (!success) return c.body(null, 204);
      if (success.status === 204) return c.body(null, 204);

      const schema = success.response.schema;
      const body = buildResponseBody(c, spec, schema);
      return c.json(body, success.status);
    });
  }
}

function loadSimproSwaggerSpec(): SwaggerSpec {
  if (cachedSpec) return cachedSpec;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "simpro-swagger.json"),
    resolve(here, "../simpro-swagger.json"),
    resolve(here, "../../simpro-swagger.json"),
    resolve(here, "../../../../../documentation/simpro-swagger.json"),
    resolve(process.cwd(), "../../../documentation/simpro-swagger.json"),
    resolve(process.cwd(), "documentation/simpro-swagger.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      "Simpro Swagger spec not found. Expected documentation/simpro-swagger.json or dist/simpro-swagger.json.",
    );
  }

  cachedSpec = JSON.parse(readFileSync(path, "utf8")) as SwaggerSpec;
  return cachedSpec;
}

function enumerateRoutes(spec: SwaggerSpec): SpecRoute[] {
  const routes: SpecRoute[] = [];
  for (const [specPath, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [rawMethod, operation] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase() as HttpMethod;
      if (!METHODS.has(method)) continue;
      const path = toHonoPath(specPath);
      routes.push({
        method,
        specPath,
        honoPath: path.honoPath,
        params: path.params,
        operation: operation as SwaggerOperation,
      });
    }
  }
  return routes;
}

function toHonoPath(specPath: string): { honoPath: string; params: SpecRouteParam[] } {
  let index = 0;
  const params: SpecRouteParam[] = [];
  const honoPath = specPath.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    index += 1;
    const clean = name.replace(/[^A-Za-z0-9_]/g, "_");
    const honoName = `${clean || "param"}${index}`;
    params.push({ specName: name, honoName });
    return `:${honoName}`;
  });
  return { honoPath, params };
}

function successResponse(
  responses: Record<string, SwaggerResponse>,
): { status: 200 | 201 | 204; response: SwaggerResponse } | null {
  if (responses["200"]) return { status: 200, response: responses["200"] };
  if (responses["201"]) return { status: 201, response: responses["201"] };
  if (responses["204"]) return { status: 204, response: responses["204"] };
  return null;
}

async function parseJsonBody(
  c: Context,
  method: HttpMethod,
): Promise<{ ok: true; value: SwaggerRecord | undefined } | { ok: false }> {
  if (method !== "post" && method !== "patch" && method !== "put") return { ok: true, value: undefined };

  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return { ok: true, value: undefined };

  const text = await c.req.text();
  if (!text.trim()) return { ok: true, value: undefined };

  try {
    const value = JSON.parse(text) as unknown;
    return {
      ok: true,
      value: value && typeof value === "object" && !Array.isArray(value) ? (value as SwaggerRecord) : {},
    };
  } catch {
    return { ok: false };
  }
}

function applyStatefulFallback(
  c: Context,
  store: Store,
  spec: SwaggerSpec,
  route: SpecRoute,
  requestBody: SwaggerRecord | undefined,
): Response | undefined {
  const success = successResponse(route.operation.responses ?? {});
  const schema = success?.response.schema;
  const collectionRoute = isCollectionRoute(spec, route, schema);
  const records = getSwaggerRecords(store);
  const collectionKey = collectionPathForRequest(c, route, collectionRoute);
  const rows = records.get(collectionKey) ?? [];

  if (route.method === "get") {
    const body = sampleForSchema(spec, schema, new Set());
    if (Array.isArray(body)) {
      return c.json(
        paginate(
          c,
          rows.map((row) => applyColumns(row, c.req.query("columns"))),
          parsePagination(c),
        ),
        200,
      );
    }

    const detailId = detailIdForRequest(c, route, collectionRoute);
    const row = detailId ? findRecord(rows, detailId) : undefined;
    if (row) {
      return c.json(applyColumns(row, c.req.query("columns")), 200);
    }
    return undefined;
  }

  if (route.method === "post") {
    const base = schemaRecord(spec, schema);
    const row = ensureRecordId({ ...base, ...(requestBody ?? {}) }, rows);
    rows.push(row);
    records.set(collectionKey, rows);
    store.setData(STORE_KEY, records);
    return success?.status === 204 ? c.body(null, 204) : c.json(row, success?.status ?? 201);
  }

  if (route.method === "patch" || route.method === "put") {
    const detailId = detailIdForRequest(c, route, collectionRoute);
    if (!detailId) return undefined;

    const existing = findRecord(rows, detailId);
    if (existing) {
      Object.assign(existing, requestBody ?? {});
    } else {
      rows.push(
        ensureRecordId({ ...schemaRecord(spec, schema), ...(requestBody ?? {}), ID: parseMaybeNumber(detailId) }, rows),
      );
    }
    records.set(collectionKey, rows);
    store.setData(STORE_KEY, records);
    if (success?.status === 204 || !success) return c.body(null, 204);
    return c.json(findRecord(rows, detailId) ?? rows[rows.length - 1], success.status);
  }

  if (route.method === "delete") {
    const detailId = detailIdForRequest(c, route, collectionRoute);
    records.set(collectionKey, detailId ? rows.filter((row) => String(recordId(row)) !== detailId) : rows);
    store.setData(STORE_KEY, records);
    return c.body(null, success?.status ?? 204);
  }

  return undefined;
}

function getSwaggerRecords(store: Store): Map<string, SwaggerRecord[]> {
  const records = store.getData<Map<string, SwaggerRecord[]>>(STORE_KEY);
  if (records) return records;
  const next = new Map<string, SwaggerRecord[]>();
  store.setData(STORE_KEY, next);
  return next;
}

function collectionPathForRequest(c: Context, route: SpecRoute, collectionRoute: boolean): string {
  let path = route.specPath;
  const detailParam = collectionRoute ? undefined : route.params.at(-1);
  for (const param of route.params) {
    if (detailParam && param.honoName === detailParam.honoName) continue;
    path = path.replace(`{${param.specName}}`, c.req.param(param.honoName) ?? "");
  }
  if (detailParam) {
    path = path.replace(new RegExp(`/\\{${escapeRegex(detailParam.specName)}\\}$`), "/");
  }
  return path;
}

function detailIdForRequest(c: Context, route: SpecRoute, collectionRoute: boolean): string | undefined {
  if (collectionRoute) return undefined;
  const detailParam = route.params.at(-1);
  if (!detailParam) return undefined;
  return c.req.param(detailParam.honoName);
}

function isCollectionRoute(spec: SwaggerSpec, route: SpecRoute, schema: SwaggerSchema | undefined): boolean {
  if (route.specPath.endsWith("/")) return true;
  if (route.method === "post") return true;
  return isArraySchema(spec, schema, new Set());
}

function isArraySchema(spec: SwaggerSpec, schema: SwaggerSchema | undefined, seen: Set<string>): boolean {
  if (!schema) return false;
  const resolved = resolveRef(spec, schema, seen);
  if (resolved !== schema) return isArraySchema(spec, resolved, seen);
  return schema.type === "array";
}

function collectionItemSchema(spec: SwaggerSpec, schema: SwaggerSchema | undefined): SwaggerSchema | undefined {
  if (!schema) return undefined;
  const resolved = resolveRef(spec, schema, new Set());
  if (resolved !== schema) return collectionItemSchema(spec, resolved);
  return schema.items;
}

function schemaRecord(spec: SwaggerSpec, schema: SwaggerSchema | undefined): SwaggerRecord {
  const body = sampleForSchema(spec, schema, new Set());
  return body && typeof body === "object" && !Array.isArray(body) ? (body as SwaggerRecord) : {};
}

function specRecordForSchema(spec: SwaggerSpec, schema: SwaggerSchema | undefined): SwaggerRecord {
  const body = sampleForSchema(spec, schema, new Set());
  return body && typeof body === "object" && !Array.isArray(body) ? (body as SwaggerRecord) : {};
}

function ensureRecordId(row: SwaggerRecord, rows: SwaggerRecord[]): SwaggerRecord {
  if (recordId(row) != null && recordId(row) !== 0 && recordId(row) !== "") return row;
  row.ID = nextRecordId(rows);
  return row;
}

function recordId(row: SwaggerRecord): unknown {
  return row.ID ?? row.id ?? row.Id;
}

function findRecord(rows: SwaggerRecord[], id: string): SwaggerRecord | undefined {
  return rows.find((row) => String(recordId(row)) === id);
}

function nextRecordId(rows: SwaggerRecord[]): number {
  const max = rows.reduce((found, row) => {
    const id = Number(recordId(row));
    return Number.isFinite(id) ? Math.max(found, id) : found;
  }, 0);
  return max + 1;
}

function parseMaybeNumber(value: string): string | number {
  const num = Number(value);
  return Number.isFinite(num) && String(num) === value ? num : value;
}

function concreteCollectionPath(specPath: string, params: SpecRouteParam[], companyId: number | string): string {
  let path = specPath;
  for (const param of params) path = path.replace(`{${param.specName}}`, defaultParamValue(param.specName, companyId));
  return path.endsWith("/") ? path : `${path.replace(/\/[^/]+$/, "")}/`;
}

function defaultParamValue(name: string, companyId: number | string): string {
  const lower = name.toLowerCase();
  if (lower === "companyid" || lower === "company_id") return String(companyId);
  if (lower.includes("customer")) return "200";
  if (lower.includes("site")) return "55";
  if (lower.includes("job")) return "12345";
  if (lower.includes("section")) return "1";
  if (lower.includes("costcenter")) return "800";
  if (lower.includes("quote")) return "9001";
  if (lower.includes("invoice")) return "7001";
  if (lower.includes("vendor")) return "1";
  if (lower.includes("contractor")) return "90";
  if (lower.includes("staff") || lower.includes("employee")) return "7";
  if (lower.includes("planttype")) return "1";
  if (lower.includes("plant")) return "1";
  if (lower.includes("lead")) return "1";
  if (lower.includes("recurring")) return "1";
  return "1";
}

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function addDays(date: string, offset: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function enrichSwaggerRecord(
  value: unknown,
  ctx: { id: number; date: string; collectionSlug: string; path: string },
  key = "",
): unknown {
  if (Array.isArray(value)) return value.length ? value.map((item) => enrichSwaggerRecord(item, ctx, key)) : [];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = enrichSwaggerRecord(childValue, ctx, childKey);
    }
    if (out.ID === undefined && out.id === undefined && out.Id === undefined) out.ID = ctx.id;
    return out;
  }

  const lower = key.toLowerCase();
  if (lower === "id" || lower.endsWith("id")) return ctx.id;
  if (lower.includes("date") && lower.includes("time")) return `${ctx.date}T09:00:00+00:00`;
  if (lower.includes("date") || lower === "start" || lower === "end") return ctx.date;
  if (lower.includes("email")) return `${ctx.collectionSlug}.${ctx.id}@agent-emulate.dev`;
  if (lower.includes("phone") || lower.includes("fax") || lower.includes("mobile")) return "+61000000000";
  if (lower.includes("url") || lower.includes("website")) return `https://agent-emulate.dev${ctx.path}`;
  if (typeof value === "number") return lower.includes("total") || lower.includes("amount") ? 100 : ctx.id;
  if (typeof value === "boolean") return ctx.id % 2 === 0;
  if (typeof value === "string") return value || `${ctx.collectionSlug} ${ctx.id}`;
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildResponseBody(c: Context, spec: SwaggerSpec, schema: SwaggerSchema | undefined): unknown {
  const body = sampleForSchema(spec, schema, new Set());
  if (Array.isArray(body)) {
    return paginate(c, body, parsePagination(c));
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return applyColumns(body as Record<string, unknown>, c.req.query("columns"));
  }
  return body;
}

function sampleForSchema(spec: SwaggerSpec, schema: SwaggerSchema | undefined, seen: Set<string>): unknown {
  if (!schema) return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  const resolved = resolveRef(spec, schema, seen);
  if (resolved !== schema) return sampleForSchema(spec, resolved, seen);

  if (schema.type === "array") return [];
  if (schema.type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      out[key] = sampleForSchema(spec, value, seen);
    }
    return out;
  }
  if (schema.type === "integer") return 0;
  if (schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "string") {
    if (schema.format === "date-time") return "2026-01-01T00:00:00+00:00";
    if (schema.format === "date") return "2026-01-01";
    return "";
  }
  return null;
}

function resolveRef(spec: SwaggerSpec, schema: SwaggerSchema, seen: Set<string>): SwaggerSchema {
  if (!schema.$ref) return schema;
  if (seen.has(schema.$ref)) return {};
  seen.add(schema.$ref);

  const prefix = "#/definitions/";
  if (!schema.$ref.startsWith(prefix)) return schema;
  return spec.definitions?.[schema.$ref.slice(prefix.length)] ?? schema;
}
