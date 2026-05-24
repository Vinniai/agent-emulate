import { createHmac } from "node:crypto";
import type { AppEnv, Store } from "@emulators/core";
import type { Hono } from "hono";

const SETTINGS_KEY = "webhook.settings";
const DELIVERIES_KEY = "webhook.deliveries";
const MAX_DELIVERIES = 1000;

export interface WebhookSettings {
  url: string | null;
  secret?: string;
}
export interface ProviderWebhookDelivery {
  id: number;
  event: "provider";
  url: string;
  status_code: number | null;
  success: boolean;
  signature: string | null;
  payload: unknown;
  delivered_at: string;
}

export function signBodyBase64(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

export function getWebhookSettings(store: Store): WebhookSettings {
  return store.getData<WebhookSettings>(SETTINGS_KEY) ?? { url: null };
}
export function setWebhookSettings(store: Store, patch: { url?: string | null; secret?: string }): WebhookSettings {
  const cur = getWebhookSettings(store);
  const next: WebhookSettings = {
    url: patch.url !== undefined ? patch.url : cur.url,
    secret: patch.secret !== undefined ? patch.secret : cur.secret,
  };
  store.setData(SETTINGS_KEY, next);
  return next;
}
export function getDeliveries(store: Store): ProviderWebhookDelivery[] {
  return store.getData<ProviderWebhookDelivery[]>(DELIVERIES_KEY) ?? [];
}
function recordDelivery(store: Store, d: ProviderWebhookDelivery): void {
  const all = getDeliveries(store);
  all.push(d);
  if (all.length > MAX_DELIVERIES) all.splice(0, all.length - MAX_DELIVERIES);
  store.setData(DELIVERIES_KEY, all);
}

/** Deliver a provider-native webhook (own payload + signature header). */
export async function dispatchProviderWebhook(
  store: Store,
  opts: { signatureHeader: string; payload: unknown },
): Promise<void> {
  const settings = getWebhookSettings(store);
  if (!settings.url) return;
  const body = JSON.stringify(opts.payload);
  const signature = settings.secret ? signBodyBase64(settings.secret, body) : null;
  const delivery: ProviderWebhookDelivery = {
    id: getDeliveries(store).length + 1,
    event: "provider",
    url: settings.url,
    status_code: null,
    success: false,
    signature,
    payload: opts.payload,
    delivered_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(settings.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature ? { [opts.signatureHeader]: signature } : {}) },
      body,
      signal: AbortSignal.timeout(10000),
    });
    delivery.status_code = res.status;
    delivery.success = res.ok;
  } catch {
    delivery.success = false;
  }
  recordDelivery(store, delivery);
}

/** /webhook-settings + /webhook-deliveries — register a destination + inspect. */
export function webhookRoutes(app: Hono<AppEnv>, store: Store): void {
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
  app.get("/webhook-deliveries", (c) => c.json({ deliveries: getDeliveries(store) }));
}
