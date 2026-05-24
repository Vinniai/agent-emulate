import { requireAuthWhen } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import { stripeId } from "./helpers.js";
import { chargeRoutes } from "./routes/charges.js";
import { checkoutSessionRoutes } from "./routes/checkout-sessions.js";
import { customerSessionRoutes } from "./routes/customer-sessions.js";
import { customerRoutes } from "./routes/customers.js";
import { paymentIntentRoutes } from "./routes/payment-intents.js";
import { paymentMethodRoutes } from "./routes/payment-methods.js";
import { priceRoutes } from "./routes/prices.js";
import { productRoutes } from "./routes/products.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { getStripeStore } from "./store.js";

export * from "./entities.js";
export { getStripeStore, type StripeStore } from "./store.js";

export interface StripeSeedConfig {
  port?: number;
  customers?: Array<{
    id?: string;
    email?: string;
    name?: string;
    description?: string;
  }>;
  products?: Array<{
    id?: string;
    name: string;
    description?: string;
  }>;
  prices?: Array<{
    id?: string;
    product_name: string;
    currency: string;
    unit_amount: number;
    lookup_key?: string;
    recurring?: { interval: "month" | "year"; interval_count?: number };
  }>;
  subscriptions?: Array<{
    customer_email: string;
    price_lookup_key: string;
    status?: "active" | "trialing" | "past_due";
    metadata?: Record<string, string>;
  }>;
  webhooks?: Array<{
    url: string;
    events: string[];
    secret?: string;
  }>;
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const ss = getStripeStore(store);
  const existing = ss.customers.findOneBy("email", "test@agent-emulate.dev");
  if (!existing) {
    ss.customers.insert({
      stripe_id: stripeId("cus"),
      email: "test@agent-emulate.dev",
      name: "Test Customer",
      description: null,
      metadata: {},
    });
  }
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: StripeSeedConfig,
  webhooks?: WebhookDispatcher,
): void {
  const ss = getStripeStore(store);

  if (config.customers) {
    for (const c of config.customers) {
      if (c.email) {
        const existing = ss.customers.findOneBy("email", c.email);
        if (existing) continue;
      }
      ss.customers.insert({
        stripe_id: c.id ?? stripeId("cus"),
        email: c.email ?? null,
        name: c.name ?? null,
        description: c.description ?? null,
        metadata: {},
      });
    }
  }

  if (config.products) {
    for (const p of config.products) {
      // Avoid duplicate products by name
      const existingProd = ss.products.all().find((pr) => pr.name === p.name);
      const product =
        existingProd ??
        ss.products.insert({
          stripe_id: p.id ?? stripeId("prod"),
          name: p.name,
          description: p.description ?? null,
          active: true,
          metadata: {},
        });

      const matchingPrices = config.prices?.filter((pr) => pr.product_name === p.name) ?? [];
      for (const pr of matchingPrices) {
        // Avoid duplicate prices by lookup_key
        if (pr.lookup_key) {
          const existingPrice = ss.prices.findOneBy("lookup_key", pr.lookup_key);
          if (existingPrice) continue;
        }
        ss.prices.insert({
          stripe_id: pr.id ?? stripeId("price"),
          product_id: product.stripe_id,
          currency: pr.currency.toLowerCase(),
          unit_amount: pr.unit_amount,
          type: pr.recurring ? "recurring" : "one_time",
          lookup_key: pr.lookup_key ?? null,
          recurring: pr.recurring
            ? {
                interval: pr.recurring.interval,
                interval_count: pr.recurring.interval_count ?? 1,
              }
            : null,
          active: true,
          metadata: {},
        });
      }
    }
  }

  // Seed subscriptions after customers and prices are seeded
  if (config.subscriptions) {
    const now = Math.floor(Date.now() / 1000);
    for (const sub of config.subscriptions) {
      const customer = ss.customers.findOneBy("email", sub.customer_email);
      if (!customer) continue;

      const price = ss.prices.findOneBy("lookup_key", sub.price_lookup_key);
      if (!price) continue;

      // Avoid duplicate subscriptions for same customer+price
      const existingSub = ss.subscriptions
        .findBy("customer_id", customer.stripe_id)
        .find((s) => s.status !== "canceled");
      if (existingSub) continue;

      const subscription = ss.subscriptions.insert({
        stripe_id: stripeId("sub"),
        customer_id: customer.stripe_id,
        status: sub.status ?? "active",
        current_period_start: now,
        current_period_end: now + 30 * 24 * 3600,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: sub.metadata ?? {},
      });

      ss.subscriptionItems.insert({
        stripe_id: stripeId("si"),
        subscription_id: subscription.stripe_id,
        price_id: price.stripe_id,
        price_lookup_key: price.lookup_key,
        quantity: 1,
        metadata: {},
      });
    }
  }

  // Register seed-configured webhook endpoints (upstream)
  if (config.webhooks && webhooks) {
    for (const wh of config.webhooks) {
      webhooks.register({
        url: wh.url,
        events: wh.events,
        active: true,
        secret: wh.secret,
        owner: "stripe",
      });
    }
  }
}

export const stripePlugin: ServicePlugin = {
  name: "stripe",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    // Health check — used by dev-emulate.sh wait loop
    app.get("/health", (c) => c.json({ status: "ok", service: "stripe" }));
    inspectorRoutes(ctx);
    // Opt-in: make the live API surface reject unauthenticated calls like
    // the real Stripe API (off by default so smoke tests/demos are green).
    // `/health` + `/inspector/*` stay open (not under `/v1`).
    app.use("/v1/*", requireAuthWhen("EMULATE_STRIPE_REQUIRE_AUTH", "EMULATE_REQUIRE_AUTH"));
    customerRoutes(ctx);
    paymentMethodRoutes(ctx);
    paymentIntentRoutes(ctx);
    chargeRoutes(ctx);
    productRoutes(ctx);
    priceRoutes(ctx);
    checkoutSessionRoutes(ctx);
    customerSessionRoutes(ctx);
    subscriptionRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default stripePlugin;
