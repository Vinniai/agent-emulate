import type { RouteContext } from "@emulators/core";
import { getStripeStore } from "../store.js";
import { stripeId, toUnixTimestamp, parseStripeBody, stripeError, stripeList } from "../helpers.js";
import type { StripeSubscription, StripeSubscriptionItem } from "../entities.js";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "paused";

function formatSubscriptionItem(si: StripeSubscriptionItem) {
  return {
    id: si.stripe_id,
    object: "subscription_item",
    subscription: si.subscription_id,
    price: {
      id: si.price_id,
      object: "price",
      lookup_key: si.price_lookup_key ?? null,
    },
    quantity: si.quantity,
    metadata: si.metadata,
    created: toUnixTimestamp(si.created_at),
  };
}

function formatSubscription(sub: StripeSubscription, items: StripeSubscriptionItem[]) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: sub.stripe_id,
    object: "subscription",
    customer: sub.customer_id,
    status: sub.status,
    current_period_start: sub.current_period_start,
    current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at ?? null,
    trial_start: sub.trial_start ?? null,
    trial_end: sub.trial_end ?? null,
    items: {
      object: "list",
      data: items.map(formatSubscriptionItem),
      has_more: false,
      total_count: items.length,
      url: `/v1/subscription_items?subscription=${sub.stripe_id}`,
    },
    metadata: sub.metadata,
    livemode: false,
    created: toUnixTimestamp(sub.created_at),
    // Synthetic invoice fields
    latest_invoice: null,
    default_payment_method: null,
  };
}

export function subscriptionRoutes({ app, store, webhooks }: RouteContext): void {
  const ss = getStripeStore(store);

  // POST /v1/subscriptions — create
  app.post("/v1/subscriptions", async (c) => {
    const body = await parseStripeBody(c);

    if (!body.customer) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: customer.", undefined, "customer");
    }
    const customer = ss.customers.findOneBy("stripe_id", body.customer as string);
    if (!customer) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `No such customer: '${body.customer}'`,
        "resource_missing",
        "customer",
      );
    }

    const itemsInput = body.items as Array<{ price: string; quantity?: number }> | undefined;
    if (!itemsInput || itemsInput.length === 0) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: items.", undefined, "items");
    }

    // Validate all prices
    for (let i = 0; i < itemsInput.length; i++) {
      const item = itemsInput[i];
      if (!item.price) {
        return stripeError(
          c,
          400,
          "invalid_request_error",
          `Missing required param: items[${i}][price].`,
          undefined,
          `items[${i}][price]`,
        );
      }
      const price = ss.prices.findOneBy("stripe_id", item.price) ?? ss.prices.findOneBy("lookup_key", item.price);
      if (!price) {
        return stripeError(
          c,
          400,
          "invalid_request_error",
          `No such price: '${item.price}'`,
          "resource_missing",
          `items[${i}][price]`,
        );
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const periodEnd = now + 30 * 24 * 3600; // +30 days

    const trialEnd = body.trial_end ? parseInt(body.trial_end as string, 10) : undefined;
    const status: SubscriptionStatus = trialEnd && trialEnd > now ? "trialing" : "active";

    const sub = ss.subscriptions.insert({
      stripe_id: stripeId("sub"),
      customer_id: customer.stripe_id,
      status,
      current_period_start: now,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: status === "trialing" ? now : null,
      trial_end: trialEnd ?? null,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    // Create subscription items
    const createdItems: StripeSubscriptionItem[] = [];
    for (const itemInput of itemsInput) {
      const price = ss.prices.findOneBy("stripe_id", itemInput.price);
      const si = ss.subscriptionItems.insert({
        stripe_id: stripeId("si"),
        subscription_id: sub.stripe_id,
        price_id: itemInput.price,
        price_lookup_key: price?.lookup_key ?? null,
        quantity: itemInput.quantity ?? 1,
        metadata: {},
      });
      createdItems.push(si);
    }

    const formatted = formatSubscription(sub, createdItems);

    await webhooks.dispatch(
      "customer.subscription.created",
      undefined,
      { type: "customer.subscription.created", data: { object: formatted } },
      "stripe",
    );

    // Synthetic invoice.payment_succeeded for active subs
    if (status === "active") {
      await webhooks.dispatch(
        "invoice.payment_succeeded",
        undefined,
        {
          type: "invoice.payment_succeeded",
          data: {
            object: {
              id: stripeId("in"),
              object: "invoice",
              customer: customer.stripe_id,
              subscription: sub.stripe_id,
              status: "paid",
              amount_paid: createdItems.reduce((sum, si) => {
                const price = ss.prices.findOneBy("stripe_id", si.price_id);
                return sum + (price?.unit_amount ?? 0) * si.quantity;
              }, 0),
              currency: createdItems[0]
                ? (ss.prices.findOneBy("stripe_id", createdItems[0].price_id)?.currency ?? "usd")
                : "usd",
              metadata: {},
            },
          },
        },
        "stripe",
      );
    }

    return c.json(formatted, 200);
  });

  // GET /v1/subscriptions/:id
  app.get("/v1/subscriptions/:id", (c) => {
    const sub = ss.subscriptions.findOneBy("stripe_id", c.req.param("id"));
    if (!sub) {
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such subscription: '${c.req.param("id")}'`,
        "resource_missing",
      );
    }
    const items = ss.subscriptionItems.findBy("subscription_id", sub.stripe_id);
    return c.json(formatSubscription(sub, items));
  });

  // POST /v1/subscriptions/:id — update
  app.post("/v1/subscriptions/:id", async (c) => {
    const sub = ss.subscriptions.findOneBy("stripe_id", c.req.param("id"));
    if (!sub) {
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such subscription: '${c.req.param("id")}'`,
        "resource_missing",
      );
    }
    if (sub.status === "canceled") {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        "Cannot update a canceled subscription.",
        "subscription_canceled",
      );
    }

    const body = await parseStripeBody(c);
    const patch: Partial<StripeSubscription> = {};

    if (body.cancel_at_period_end !== undefined) {
      patch.cancel_at_period_end = body.cancel_at_period_end === "true" || body.cancel_at_period_end === true;
    }
    if (body.metadata !== undefined) {
      patch.metadata = body.metadata as Record<string, string>;
    }

    const updated = ss.subscriptions.update(sub.id, patch)!;
    const items = ss.subscriptionItems.findBy("subscription_id", updated.stripe_id);
    const formatted = formatSubscription(updated, items);

    await webhooks.dispatch(
      "customer.subscription.updated",
      undefined,
      { type: "customer.subscription.updated", data: { object: formatted } },
      "stripe",
    );

    return c.json(formatted);
  });

  // DELETE /v1/subscriptions/:id — cancel immediately
  app.delete("/v1/subscriptions/:id", async (c) => {
    const sub = ss.subscriptions.findOneBy("stripe_id", c.req.param("id"));
    if (!sub) {
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such subscription: '${c.req.param("id")}'`,
        "resource_missing",
      );
    }
    if (sub.status === "canceled") {
      return stripeError(c, 400, "invalid_request_error", "Subscription is already canceled.", "subscription_canceled");
    }

    const now = Math.floor(Date.now() / 1000);
    const updated = ss.subscriptions.update(sub.id, { status: "canceled", canceled_at: now })!;
    const items = ss.subscriptionItems.findBy("subscription_id", updated.stripe_id);
    const formatted = formatSubscription(updated, items);

    await webhooks.dispatch(
      "customer.subscription.deleted",
      undefined,
      { type: "customer.subscription.deleted", data: { object: formatted } },
      "stripe",
    );

    return c.json(formatted);
  });

  // GET /v1/subscriptions — list
  app.get("/v1/subscriptions", (c) => {
    let subs = ss.subscriptions.all();
    const customerId = c.req.query("customer");
    const status = c.req.query("status");
    if (customerId) subs = subs.filter((s) => s.customer_id === customerId);
    if (status && status !== "all") subs = subs.filter((s) => s.status === status);
    return stripeList(c, subs, "/v1/subscriptions", (sub) => {
      const items = ss.subscriptionItems.findBy("subscription_id", sub.stripe_id);
      return formatSubscription(sub, items);
    });
  });

  // Billing portal stub — redirect back to return_url
  app.post("/v1/billing_portal/sessions", async (c) => {
    const body = await parseStripeBody(c);
    const returnUrl = (body.return_url as string) ?? "/";
    return c.json({
      id: stripeId("bps"),
      object: "billing_portal.session",
      created: Math.floor(Date.now() / 1000),
      customer: body.customer ?? null,
      livemode: false,
      locale: "auto",
      on_behalf_of: null,
      return_url: returnUrl,
      url: returnUrl, // emulator: just redirect back immediately
    });
  });
}
