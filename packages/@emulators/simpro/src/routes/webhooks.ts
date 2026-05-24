import { createHmac } from "node:crypto";
import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore, type SimproStore } from "../store.js";
import {
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
  token,
} from "../helpers.js";
import { nextExternalId } from "./jobs.js";

/**
 * Webhook registration and delivery. Outbound payload:
 *   { "type": "job.created", "data": { "id": 12345 } }
 * Signed with HMAC-SHA256 over the raw body (X-simPRO-Signature: sha256={hex}).
 * The HMAC convention is not officially documented — treat as best-effort
 * until a customer-shared signed payload confirms the exact header.
 */
export function webhookRoutes({ app, store, baseUrl }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/setup/webhooks/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.webhookSubscriptions.all().filter((w) => w.company_id === companyId || companyId === 0);
    const page = paginate(c, items, parsePagination(c));
    return c.json(
      page.map((w) => ({
        ID: w.external_id,
        URL: w.url,
        Events: w.events,
        Active: w.active,
      })),
    );
  });

  // Debug endpoint for tests: list recent events fired. Registered before the
  // `/:id` route so the static `_events` segment isn't swallowed as an id.
  app.get("/api/v1.0/companies/:cid/setup/webhooks/_events", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    const items = ss.webhookEvents.all().filter((e) => e.company_id === companyId || companyId === 0);
    return c.json(items);
  });

  app.get("/api/v1.0/companies/:cid/setup/webhooks/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const w = ss.webhookSubscriptions.findOneBy("external_id", Number(c.req.param("id")));
    if (!w) return simproNotFound(c);
    return c.json({ ID: w.external_id, URL: w.url, Events: w.events, Active: w.active });
  });

  app.post("/api/v1.0/companies/:cid/setup/webhooks/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;

    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    const url = body.URL as string | undefined;
    if (!url) return simproValidation(c, "URL", "URL is required.");
    const events = (body.Events as string[] | undefined) ?? [];

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "webhookSubscriptions", companyId);
    const subscription = ss.webhookSubscriptions.insert({
      company_id: companyId,
      external_id: externalId,
      url,
      events,
      secret: token("whsec", 24),
      active: true,
    });
    return c.json(
      {
        ID: subscription.external_id,
        URL: subscription.url,
        Events: subscription.events,
        Secret: subscription.secret,
        Active: subscription.active,
      },
      201,
    );
  });

  app.patch("/api/v1.0/companies/:cid/setup/webhooks/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const w = ss.webhookSubscriptions.findOneBy("external_id", Number(c.req.param("id")));
    if (!w) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    ss.webhookSubscriptions.update(w.id, {
      ...(body.URL !== undefined && { url: body.URL as string }),
      ...(body.Events !== undefined && { events: body.Events as string[] }),
      ...(body.Active !== undefined && { active: Boolean(body.Active) }),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/setup/webhooks/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const w = ss.webhookSubscriptions.findOneBy("external_id", Number(c.req.param("id")));
    if (!w) return simproNotFound(c);
    ss.webhookSubscriptions.delete(w.id);
    return c.body(null, 204);
  });

  void baseUrl; // unused but part of RouteContext
}

export async function fireWebhook(ss: SimproStore, companyId: number, event: string, entityId: number): Promise<void> {
  const subscriptions = ss.webhookSubscriptions
    .all()
    .filter((w) => w.active && w.company_id === companyId && w.events.includes(event));

  const payload = { type: event, data: { id: entityId } };
  const body = JSON.stringify(payload);

  for (const sub of subscriptions) {
    const event_row = ss.webhookEvents.insert({
      company_id: companyId,
      subscription_id: sub.external_id,
      event,
      entity_id: entityId,
      status: "pending",
    });

    const signature = createHmac("sha256", sub.secret).update(body).digest("hex");
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-simPRO-Signature": `sha256=${signature}`,
        },
        body,
      });
      ss.webhookEvents.update(event_row.id, {
        status: res.ok ? "delivered" : "failed",
      });
    } catch {
      ss.webhookEvents.update(event_row.id, { status: "failed" });
    }
  }
}
