import type { AppEnv, Store } from "@emulators/core";
import type { Context, Hono } from "hono";
import type { NangoStoreFacade } from "../store.js";
import type { NangoConnection } from "../types.js";
import { buildAuthWebhook, dispatchNangoWebhook } from "../webhooks.js";

type ConnectionBody = {
  connection_id?: string;
  provider_config_key: string;
  credentials?: {
    type?: string;
    access_token?: string;
    refresh_token?: string;
    oauth_token?: string;
    oauth_token_secret?: string;
    raw?: Record<string, unknown>;
  };
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  connection_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: Record<string, string>;
};

function normalizeTags(tags?: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function publicConnection(conn: NangoConnection): Omit<NangoConnection, "credentials"> {
  const { credentials: _credentials, ...rest } = conn;
  return { ...rest, tags: rest.tags ?? {}, errors: rest.errors ?? [] };
}

function providerMatches(
  conn: NangoConnection | undefined,
  providerConfigKey?: string | null,
): conn is NangoConnection {
  return !!conn && (!providerConfigKey || conn.provider_config_key === providerConfigKey);
}

function makeConnection(body: ConnectionBody, existing?: NangoConnection): NangoConnection {
  const now = new Date().toISOString();
  const connectionId = body.connection_id ?? existing?.id ?? `conn_emu_${Date.now().toString(36)}`;
  const accessToken =
    body.credentials?.access_token ??
    body.credentials?.oauth_token ??
    body.access_token ??
    existing?.credentials.access_token ??
    `emulator-token-${connectionId}`;
  const refreshToken = body.credentials?.refresh_token ?? body.refresh_token ?? existing?.credentials.refresh_token;
  const expiresAt =
    body.expires_at ?? existing?.credentials.expires_at ?? new Date(Date.now() + 3600 * 1000).toISOString();
  return {
    id: connectionId,
    connection_id: connectionId,
    provider: body.provider_config_key,
    provider_config_key: body.provider_config_key,
    credentials: {
      type: body.credentials?.type ?? existing?.credentials.type ?? "OAuth2",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      raw: {
        ...(existing?.credentials.raw ?? {}),
        ...(body.credentials?.raw ?? {}),
        access_token: accessToken,
        refresh_token: refreshToken,
        oauth_token: body.credentials?.oauth_token,
        oauth_token_secret: body.credentials?.oauth_token_secret,
        token_type: "Bearer",
      },
    },
    connection_config: body.connection_config ?? existing?.connection_config ?? {},
    metadata: body.metadata ?? existing?.metadata ?? {},
    tags: normalizeTags(body.tags ?? existing?.tags),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    last_fetched_at: now,
    errors: existing?.errors ?? [],
  };
}

export function connectionRoutes(app: Hono<AppEnv>, ns: NangoStoreFacade, store: Store): void {
  const listHandler = (c: Context<AppEnv>) => {
    const providerConfigKey = c.req.query("provider_config_key");
    const connectionId = c.req.query("connectionId");
    const search = c.req.query("search")?.toLowerCase();
    const limit = Number(c.req.query("limit") ?? "0") || undefined;
    const page = Math.max(Number(c.req.query("page") ?? "1") || 1, 1);
    const tagFilters = Object.fromEntries(
      Object.entries(Object.fromEntries(new URL(c.req.url).searchParams.entries()))
        .filter(([key]) => key.startsWith("tags[") && key.endsWith("]"))
        .map(([key, value]) => [key.slice(5, -1).toLowerCase(), value]),
    );

    let conns = ns.listConnections(providerConfigKey).map(publicConnection);
    if (connectionId) conns = conns.filter((conn) => conn.connection_id === connectionId);
    if (search) {
      conns = conns.filter(
        (conn) =>
          conn.connection_id.toLowerCase().includes(search) ||
          Object.values(conn.tags ?? {}).some((value) => value.toLowerCase().includes(search)),
      );
    }
    if (Object.keys(tagFilters).length > 0) {
      conns = conns.filter((conn) => Object.entries(tagFilters).every(([key, value]) => conn.tags?.[key] === value));
    }
    if (limit) conns = conns.slice((page - 1) * limit, page * limit);
    return c.json({ connections: conns });
  };

  app.get("/connections", listHandler);
  app.get("/connection", listHandler);

  const upsertHandler = async (c: Context<AppEnv>) => {
    const body = await c.req.json<ConnectionBody>();
    if (!body.provider_config_key) return c.json({ message: "provider_config_key is required" }, 400);
    const existing = body.connection_id ? ns.getConnection(body.connection_id) : undefined;
    const conn = makeConnection(body, existing);
    ns.upsertConnection(conn);
    await dispatchNangoWebhook(
      store,
      "auth",
      buildAuthWebhook({
        operation: existing ? "override" : "creation",
        connectionId: conn.id,
        authMode: conn.credentials.type,
        providerConfigKey: conn.provider_config_key,
        provider: conn.provider,
        success: true,
        endUser: {
          endUserId: typeof conn.metadata.endUserId === "string" ? conn.metadata.endUserId : undefined,
          tags: conn.tags ?? {},
        },
      }),
    );
    return c.json(conn, new URL(c.req.url).pathname.endsWith("/connection") ? 201 : 200);
  };

  app.post("/connections", upsertHandler);
  app.post("/connection", upsertHandler);

  const setMetadataHandler = async (c: Context<AppEnv>) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      connection_id?: string | string[];
      provider_config_key?: string;
      metadata?: Record<string, unknown>;
    };
    const ids = Array.isArray(body.connection_id) ? body.connection_id : body.connection_id ? [body.connection_id] : [];
    if (!body.provider_config_key || ids.length === 0 || !body.metadata)
      return c.json({ message: "connection_id, provider_config_key and metadata are required" }, 400);
    for (const id of ids) {
      const conn = ns.getConnection(id);
      if (!providerMatches(conn, body.provider_config_key))
        return c.json({ error: "Connection not found", connection_id: id }, 404);
      ns.replaceMetadata(id, body.metadata);
    }
    return c.json(
      { connection_id: body.connection_id, provider_config_key: body.provider_config_key, metadata: body.metadata },
      201,
    );
  };

  const patchMetadataHandler = async (c: Context<AppEnv>) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      connection_id?: string | string[];
      provider_config_key?: string;
      metadata?: Record<string, unknown>;
    };
    const ids = Array.isArray(body.connection_id) ? body.connection_id : body.connection_id ? [body.connection_id] : [];
    if (!body.provider_config_key || ids.length === 0 || !body.metadata)
      return c.json({ message: "connection_id, provider_config_key and metadata are required" }, 400);
    for (const id of ids) {
      const conn = ns.getConnection(id);
      if (!providerMatches(conn, body.provider_config_key))
        return c.json({ error: "Connection not found", connection_id: id }, 404);
      ns.updateMetadata(id, body.metadata);
    }
    return c.json({
      connection_id: body.connection_id,
      provider_config_key: body.provider_config_key,
      metadata: body.metadata,
    });
  };

  app.post("/connections/metadata", setMetadataHandler);
  app.post("/connection/metadata", setMetadataHandler);
  app.patch("/connections/metadata", patchMetadataHandler);
  app.patch("/connection/metadata", patchMetadataHandler);

  const getHandler = (c: Context<AppEnv>) => {
    const id = c.req.param("connectionId")!;
    const providerConfigKey = c.req.query("provider_config_key");
    let conn = ns.getConnection(id);
    if (!providerMatches(conn, providerConfigKey))
      return c.json({ error: "Connection not found", connection_id: id }, 404);

    const forceRefresh = c.req.query("force_refresh") === "true";
    const isExpired = conn.credentials.expires_at
      ? new Date(conn.credentials.expires_at).getTime() <= Date.now()
      : false;
    if (forceRefresh || isExpired) conn = ns.refreshCredentials(id) ?? conn;
    conn.last_fetched_at = new Date().toISOString();
    return c.json({ ...conn, tags: conn.tags ?? {}, errors: conn.errors ?? [] });
  };

  app.get("/connections/:connectionId", getHandler);
  app.get("/connection/:connectionId", getHandler);

  const patchConnectionHandler = async (c: Context<AppEnv>) => {
    const id = c.req.param("connectionId")!;
    const providerConfigKey = c.req.query("provider_config_key");
    const conn = ns.getConnection(id);
    if (!providerMatches(conn, providerConfigKey))
      return c.json({ error: "Connection not found", connection_id: id }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { tags?: Record<string, string> };
    if (body.tags) ns.updateTags(id, body.tags);
    return c.json({ success: true });
  };

  app.patch("/connections/:connectionId", patchConnectionHandler);

  const deleteHandler = (c: Context<AppEnv>) => {
    const id = c.req.param("connectionId")!;
    const providerConfigKey = c.req.query("provider_config_key");
    if (!ns.deleteConnection(id, providerConfigKey ?? undefined))
      return c.json({ error: "Connection not found", connection_id: id }, 404);
    return c.json({ success: true });
  };

  app.delete("/connections/:connectionId", deleteHandler);
  app.delete("/connection/:connectionId", deleteHandler);

  app.post("/connection/:connectionId/metadata", async (c) => {
    const id = c.req.param("connectionId")!;
    const body = await c.req.json<Record<string, unknown>>();
    if (!ns.replaceMetadata(id, body)) return c.json({ error: "Connection not found", connection_id: id }, 404);
    return c.json(body, 201);
  });

  app.put("/connection/:connectionId/metadata", async (c) => {
    const id = c.req.param("connectionId")!;
    const body = await c.req.json<Record<string, unknown>>();
    if (!ns.updateMetadata(id, body)) return c.json({ error: "Connection not found", connection_id: id }, 404);
    return c.json(ns.getConnection(id));
  });

  app.patch("/connection/:connectionId/metadata", async (c) => {
    const id = c.req.param("connectionId")!;
    const body = await c.req.json<Record<string, unknown>>();
    if (!ns.updateMetadata(id, body)) return c.json({ error: "Connection not found", connection_id: id }, 404);
    return c.json(ns.getConnection(id));
  });

  const recordsHandler = (c: Context<AppEnv>) => {
    const connectionId = c.req.header("Connection-Id") ?? c.req.header("connection-id");
    const providerConfigKey = c.req.header("Provider-Config-Key") ?? c.req.header("provider-config-key");
    const model = c.req.query("model");
    if (!connectionId || !model) return c.json({ message: "Missing Connection-Id header or model query param" }, 400);
    const url = new URL(c.req.url);
    const ids = [
      ...url.searchParams.getAll("ids"),
      ...url.searchParams.getAll("ids[]"),
      ...(url.searchParams.get("ids")?.split(",") ?? []),
    ].filter(Boolean);
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 100;
    const cursor = url.searchParams.get("cursor");
    const filter = url.searchParams.get("filter");
    const modifiedAfter = url.searchParams.get("modified_after") ?? url.searchParams.get("delta");

    const raw = ns.getRecords(connectionId, model, providerConfigKey ?? undefined);
    const now = new Date().toISOString();
    let records = raw.map((row, idx) => {
      const existingMetadata = (row._nango_metadata as Record<string, unknown> | undefined) ?? {};
      return {
        ...row,
        _nango_metadata: {
          first_seen_at: existingMetadata.first_seen_at ?? now,
          last_modified_at: existingMetadata.last_modified_at ?? now,
          last_action: existingMetadata.last_action ?? ("ADDED" as const),
          cursor: `emu_cursor_${idx}`,
          deleted_at: existingMetadata.deleted_at ?? null,
          ...(existingMetadata.pruned_at ? { pruned_at: existingMetadata.pruned_at } : {}),
        },
      };
    });

    if (ids.length > 0) {
      const wanted = new Set(ids);
      records = records.filter((row) => {
        const r = row as Record<string, unknown>;
        return wanted.has(String(r.id ?? r.Id ?? r.ID));
      });
    }
    if (filter) records = records.filter((row) => row._nango_metadata.last_action === filter.toUpperCase());
    if (modifiedAfter) {
      const cutoff = Date.parse(modifiedAfter);
      if (Number.isFinite(cutoff))
        records = records.filter((row) => Date.parse(String(row._nango_metadata.last_modified_at)) > cutoff);
    }

    const cursorIndex = cursor?.startsWith("emu_cursor_") ? Number(cursor.slice("emu_cursor_".length)) : -1;
    const start = Number.isFinite(cursorIndex) && cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = records.slice(start, start + limit);
    const nextIndex = start + page.length;
    const nextCursor = nextIndex < records.length ? (page[page.length - 1]?._nango_metadata.cursor ?? null) : null;
    return c.json({ records: page, next_cursor: nextCursor });
  };
  app.get("/records", recordsHandler);
  app.get("/records/", recordsHandler);

  app.patch("/records/prune", async (c) => {
    const connectionId = c.req.header("Connection-Id") ?? c.req.header("connection-id");
    const providerConfigKey = c.req.header("Provider-Config-Key") ?? c.req.header("provider-config-key");
    const body = (await c.req.json().catch(() => ({}))) as { model?: string; until_cursor?: string; limit?: number };
    if (!connectionId || !providerConfigKey || !body.model || !body.until_cursor) {
      return c.json({ message: "Connection-Id, Provider-Config-Key, model and until_cursor are required" }, 400);
    }
    const conn = ns.getConnection(connectionId);
    if (!providerMatches(conn, providerConfigKey))
      return c.json({ error: "Connection not found", connection_id: connectionId }, 404);
    return c.json(
      ns.pruneRecords(connectionId, body.model, body.until_cursor, Math.min(Math.max(body.limit ?? 1000, 1), 10000)),
    );
  });

  app.post("/connections/:connectionId/records/:model", async (c) => {
    const connectionId = c.req.param("connectionId");
    const model = c.req.param("model");
    if (!ns.getConnection(connectionId))
      return c.json({ error: "Connection not found", connection_id: connectionId }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { records?: unknown };
    const rows = (Array.isArray(body.records) ? body.records : body.records != null ? [body.records] : []) as Record<
      string,
      unknown
    >[];
    const total = ns.appendRecords(connectionId, model, rows);
    return c.json({ model, appended: rows.length, total });
  });
}
