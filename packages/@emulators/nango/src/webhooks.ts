import { createHmac } from "node:crypto";
import { deliverWithRetry, type DeliverDeps, type Store } from "@emulators/core";

// ---------------------------------------------------------------------------
// Nango webhooks — faithful to the real https://api.nango.dev behaviour.
//
// Real Nango POSTs your configured webhook URL with two payload types relevant
// to sync/comms integrations:
//
//   auth     — fired after a connection is created or re-authorized.
//   sync     — fired after a sync run; carries responseResults counts. This is
//              how a consumer learns "new calendar events / Teams messages /
//              emails landed" without polling.
//   forward  — a provider's own webhook (WhatsApp inbound message, Microsoft
//              Graph change notification, Google push, …) wrapped and relayed
//              verbatim so the consumer's existing provider-webhook handler
//              works unchanged.
//
// Every delivery is signed: header `X-Nango-Hmac-Sha256` = HMAC-SHA256 hex of
// the exact request body using the environment secret key. `X-Nango-Signature`
// is also sent for compatibility with older consumers.
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "nango.webhook_settings";
const DELIVERIES_KEY = "nango.webhook_deliveries";
const MAX_DELIVERIES = 1000;

export interface WebhookSettings {
  url: string | null;
  secret?: string;
}

export interface NangoWebhookDelivery {
  id: number;
  event: "sync" | "forward" | "auth" | "provider";
  url: string;
  status_code: number | null;
  success: boolean;
  signature: string | null;
  payload: unknown;
  delivered_at: string;
  /** How many delivery attempts were made (>=1; >1 means a retry happened). */
  attempts: number;
}

/** Hex HMAC-SHA256 of `body` keyed by `secret` — Nango's signature scheme. */
export function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Base64 HMAC-SHA256 of `body` keyed by `secret` — the scheme both Xero
 * (`x-xero-signature`) and QuickBooks (`intuit-signature`) use to sign the
 * webhooks they POST to your destination.
 */
export function signBodyBase64(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

export function getWebhookSettings(store: Store): WebhookSettings {
  return store.getData<WebhookSettings>(SETTINGS_KEY) ?? { url: null };
}

/** Merge a partial update — an omitted field keeps its previous value. */
export function setWebhookSettings(store: Store, patch: { url?: string | null; secret?: string }): WebhookSettings {
  const cur = getWebhookSettings(store);
  const next: WebhookSettings = {
    url: patch.url !== undefined ? patch.url : cur.url,
    secret: patch.secret !== undefined ? patch.secret : cur.secret,
  };
  store.setData(SETTINGS_KEY, next);
  return next;
}

export function getDeliveries(store: Store): NangoWebhookDelivery[] {
  return store.getData<NangoWebhookDelivery[]>(DELIVERIES_KEY) ?? [];
}

function recordDelivery(store: Store, d: NangoWebhookDelivery): void {
  const all = getDeliveries(store);
  all.push(d);
  if (all.length > MAX_DELIVERIES) all.splice(0, all.length - MAX_DELIVERIES);
  store.setData(DELIVERIES_KEY, all);
}

interface SyncArgs {
  connectionId: string;
  providerConfigKey: string;
  syncName: string;
  model: string;
  added: number;
  updated?: number;
  deleted?: number;
  syncType?: "INITIAL" | "INCREMENTAL" | "WEBHOOK";
}

/** The real Nango `type: "sync"` envelope. */
export function buildSyncWebhook(a: SyncArgs): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    type: "sync",
    connectionId: a.connectionId,
    providerConfigKey: a.providerConfigKey,
    syncName: a.syncName,
    model: a.model,
    responseResults: { added: a.added, updated: a.updated ?? 0, deleted: a.deleted ?? 0 },
    syncType: a.syncType ?? "INCREMENTAL",
    modifiedAfter: now,
    queryTimeStamp: now,
    success: true,
  };
}

interface ForwardArgs {
  provider: string;
  connectionId?: string;
  providerConfigKey: string;
  payload: unknown;
}

interface AuthArgs {
  operation: "creation" | "override" | "refresh";
  connectionId: string;
  authMode: string;
  providerConfigKey: string;
  provider: string;
  success: boolean;
  endUser?: { endUserId?: string; tags?: Record<string, unknown> };
  error?: { type: string; description: string };
}

/** The real Nango `type: "auth"` connection lifecycle webhook envelope. */
export function buildAuthWebhook(a: AuthArgs): Record<string, unknown> {
  return {
    type: "auth",
    operation: a.operation,
    connectionId: a.connectionId,
    authMode: a.authMode,
    providerConfigKey: a.providerConfigKey,
    provider: a.provider,
    environment: "DEV",
    success: a.success,
    endUser: a.endUser ?? { endUserId: undefined, tags: {} },
    ...(a.error ? { error: a.error } : {}),
  };
}

/** The real Nango `type: "forward"` envelope wrapping a provider's webhook. */
export function buildForwardWebhook(a: ForwardArgs): Record<string, unknown> {
  const wh: Record<string, unknown> = { from: a.provider, type: "forward" };
  if (a.connectionId !== undefined) wh.connectionId = a.connectionId;
  wh.providerConfigKey = a.providerConfigKey;
  wh.payload = a.payload;
  return wh;
}

/**
 * Deliver a webhook to the configured URL. Awaited (deterministic for the
 * consumer/tests) — real Nango fires async, but the payload + signature on the
 * wire are identical. No-ops with no recorded delivery when no URL is set,
 * matching Nango (the trigger still succeeds, nothing is sent).
 */
export async function dispatchNangoWebhook(
  store: Store,
  event: "sync" | "forward" | "auth",
  payload: unknown,
  deps?: DeliverDeps,
): Promise<void> {
  const settings = getWebhookSettings(store);
  if (!settings.url) return;

  const body = JSON.stringify(payload);
  const signature = settings.secret ? signBody(settings.secret, body) : null;

  const delivery: NangoWebhookDelivery = {
    id: getDeliveries(store).length + 1,
    event,
    url: settings.url,
    status_code: null,
    success: false,
    signature,
    payload,
    delivered_at: new Date().toISOString(),
    attempts: 0,
  };

  const outcome = await deliverWithRetry(
    settings.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nango-Webhook-Type": event,
        ...(signature ? { "X-Nango-Hmac-Sha256": signature, "X-Nango-Signature": signature } : {}),
      },
      body,
    },
    deps,
  );
  delivery.status_code = outcome.status_code;
  delivery.success = outcome.success;
  delivery.attempts = outcome.attempts;

  recordDelivery(store, delivery);
}

/**
 * Deliver a *provider-native* webhook to the configured destination — the
 * exact payload + signature scheme the real provider (Xero, QuickBooks) puts
 * on the wire, not the Nango envelope. This is what makes the
 * "create invoice → provider → webhook to our destination" chain testable
 * end-to-end against the same `/webhook-settings` URL and delivery log.
 *
 * Signature is base64 HMAC-SHA256 of the exact body keyed by the registered
 * webhook secret, sent under the provider's own header name. Awaited
 * (deterministic for tests); no-op + no recorded delivery when no URL is set.
 */
export async function dispatchProviderWebhook(
  store: Store,
  opts: { signatureHeader: string; payload: unknown },
  deps?: DeliverDeps,
): Promise<void> {
  const settings = getWebhookSettings(store);
  if (!settings.url) return;

  const body = JSON.stringify(opts.payload);
  const signature = settings.secret ? signBodyBase64(settings.secret, body) : null;

  const delivery: NangoWebhookDelivery = {
    id: getDeliveries(store).length + 1,
    event: "provider",
    url: settings.url,
    status_code: null,
    success: false,
    signature,
    payload: opts.payload,
    delivered_at: new Date().toISOString(),
    attempts: 0,
  };

  const outcome = await deliverWithRetry(
    settings.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { [opts.signatureHeader]: signature } : {}),
      },
      body,
    },
    deps,
  );
  delivery.status_code = outcome.status_code;
  delivery.success = outcome.success;
  delivery.attempts = outcome.attempts;

  recordDelivery(store, delivery);
}
