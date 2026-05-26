import type { WebhookDispatcher } from "@emulators/core";
import { randomHex } from "../helpers.js";

/**
 * Emit a WorkOS-shaped webhook event to any subscriber registered with
 * `owner: "workos"`. Mirrors the real WorkOS event envelope —
 * `{ id, event, data, created_at }` — so a consumer (e.g. a Convex sync) can
 * subscribe to org/user/membership lifecycle changes and keep its own tenant
 * model in step with the emulator.
 *
 * Delivery is best-effort and fire-and-forget: a missing/listening-less
 * subscriber must never break the API call that triggered the event.
 */
export function emitWorkOSEvent(webhooks: WebhookDispatcher, event: string, data: unknown): void {
  webhooks
    .dispatch(
      event,
      undefined,
      { id: `event_${randomHex(16)}`, event, data, created_at: new Date().toISOString() },
      "workos",
    )
    .catch(() => {});
}
