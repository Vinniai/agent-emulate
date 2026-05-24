import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { NangoStoreFacade } from "../store.js";

function parseSyncs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function targetConnections(ns: NangoStoreFacade, providerConfigKey: string, connectionId?: string) {
  if (connectionId) {
    const conn = ns.getConnection(connectionId);
    return conn && conn.provider_config_key === providerConfigKey ? [conn] : [];
  }
  return ns.listConnections(providerConfigKey);
}

export function syncRoutes(app: Hono<AppEnv>, ns: NangoStoreFacade): void {
  app.post("/sync/start", async (c) => {
    await c.req.json().catch(() => ({}));
    return c.json({ success: true });
  });

  app.post("/sync/pause", async (c) => {
    await c.req.json().catch(() => ({}));
    return c.json({ success: true });
  });

  app.get("/sync/status", (c) => {
    const providerConfigKey = c.req.query("provider_config_key") ?? "";
    const syncs = parseSyncs(c.req.query("syncs") ?? "*");
    const connectionId = c.req.query("connection_id");
    const wantedSyncs = syncs.length === 0 || syncs.includes("*") ? ["sync"] : syncs;
    const rows = targetConnections(ns, providerConfigKey, connectionId).flatMap((conn) => {
      const records = ns.allRecordsForConnection(conn.id);
      const recordCount = Object.fromEntries(
        Object.entries(records).map(([model, modelRows]) => [model, modelRows.length]),
      );
      return wantedSyncs.map((syncName) => {
        const [name, variant = "base"] = syncName.split("::");
        return {
          id: `${conn.id}:${name}:${variant}`,
          connection_id: conn.id,
          name,
          variant,
          status: "SUCCESS",
          type: "INCREMENTAL",
          finishedAt: conn.updated_at,
          nextScheduledSyncAt: null,
          frequency: null,
          latestResult: { success: true },
          recordCount,
          checkpoint: {},
        };
      });
    });
    return c.json({ syncs: rows });
  });

  app.post("/sync/:name/variant/:variant", async (c) => {
    const name = c.req.param("name");
    const variant = c.req.param("variant");
    if (variant === "base") return c.json({ message: "base is a protected variant name" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { connection_id?: string; provider_config_key?: string };
    if (!body.connection_id || !body.provider_config_key)
      return c.json({ message: "connection_id and provider_config_key are required" }, 400);
    return c.json({ id: `${body.connection_id}:${name}:${variant}`, name, variant });
  });

  app.delete("/sync/:name/variant/:variant", async (c) => {
    const variant = c.req.param("variant");
    if (variant === "base") return c.json({ message: "base is a protected variant name" }, 400);
    await c.req.json().catch(() => ({}));
    return c.json({ success: true });
  });
}
