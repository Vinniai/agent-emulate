import type { AppEnv } from "@emulators/core";
import type { Store } from "@emulators/core";
import type { Hono } from "hono";
import type { NangoStoreFacade } from "../store.js";
import {
  getWebhookSettings,
  setWebhookSettings,
  getDeliveries,
  buildSyncWebhook,
  buildForwardWebhook,
  dispatchNangoWebhook,
} from "../webhooks.js";

/**
 * Nango webhook surface:
 *   GET/POST /webhook-settings              — register the consumer's callback
 *   POST     /sync/trigger                  — run a sync → "sync" webhook
 *   POST     /webhook/:envUuid/:configKey   — provider inbound → "forward"
 *   GET      /webhook-deliveries            — delivery log (inspection/tests)
 */
export function webhookRoutes(app: Hono<AppEnv>, ns: NangoStoreFacade, store: Store): void {
  const view = () => {
    const s = getWebhookSettings(store);
    return { url: s.url, hasSecret: !!s.secret };
  };

  app.get("/webhook-settings", (c) => c.json(view()));

  app.post("/webhook-settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string | null; secret?: string };
    setWebhookSettings(store, { url: body.url, secret: body.secret });
    return c.json(view());
  });

  // Real Nango: POST /sync/trigger { syncs?, provider_config_key, connection_id }
  // → 200 immediately; a "sync" webhook fires per synced model.
  app.post("/sync/trigger", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      syncs?: string[];
      provider_config_key?: string;
      connection_id?: string;
      model?: string;
      added?: number;
      updated?: number;
      deleted?: number;
      syncType?: "INITIAL" | "INCREMENTAL" | "WEBHOOK";
    };
    const connectionId = body.connection_id ?? "";
    const conn = ns.getConnection(connectionId);
    const providerConfigKey = body.provider_config_key ?? conn?.provider_config_key ?? "";
    const syncName = body.syncs?.[0] ?? `${providerConfigKey || "nango"}-sync`;

    const records = connectionId ? ns.allRecordsForConnection(connectionId) : {};
    const models = body.model ? { [body.model]: records[body.model] ?? [] } : records;

    for (const [model, rows] of Object.entries(models)) {
      // A streamed tick that just appended one row overrides `added` so the
      // sync webhook reports added:1, not the whole model length.
      await dispatchNangoWebhook(
        store,
        "sync",
        buildSyncWebhook({
          connectionId,
          providerConfigKey,
          syncName,
          model,
          added: body.added ?? rows?.length ?? 0,
          updated: body.updated,
          deleted: body.deleted,
          syncType: body.syncType,
        }),
      );
    }
    return c.json({ success: true });
  });

  // Real Nango inbound URL the provider POSTs to. Nango resolves the
  // connection, wraps the raw body as a "forward" webhook, relays it to the
  // consumer, and always 200s the provider regardless.
  app.post("/webhook/:environmentUuid/:providerConfigKey", async (c) => {
    const providerConfigKey = c.req.param("providerConfigKey");
    const raw = await c.req.json().catch(() => ({}));

    const hinted = c.req.header("Connection-Id") ?? c.req.header("connection-id");
    const conn = hinted ? ns.getConnection(hinted) : ns.listConnections(providerConfigKey)[0];

    await dispatchNangoWebhook(
      store,
      "forward",
      conn
        ? buildForwardWebhook({ provider: conn.provider, connectionId: conn.id, providerConfigKey, payload: raw })
        : raw,
    );
    return c.json({ status: "ok" }, 200);
  });

  app.get("/webhook-deliveries", (c) => c.json({ deliveries: getDeliveries(store) }));
}
