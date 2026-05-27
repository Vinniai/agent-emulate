import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  Store,
  WebhookDispatcher,
  authMiddleware,
  createApiErrorHandler,
  createErrorHandler,
  type TokenMap,
} from "@emulators/core";
import { stripePlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:14000";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set("sk_test_abc123", {
    login: "test-account",
    id: 1,
    scopes: [],
  });

  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  stripePlugin.register(app as any, store, webhooks, base, tokenMap);
  stripePlugin.seed?.(store, base);

  return { app, store, webhooks, tokenMap };
}

function auth(): Record<string, string> {
  return {
    Authorization: "Bearer sk_test_abc123",
    "Content-Type": "application/json",
  };
}

describe("Stripe plugin", () => {
  let app: Hono;
  let webhooks: WebhookDispatcher;

  beforeEach(() => {
    const ctx = createTestApp();
    app = ctx.app;
    webhooks = ctx.webhooks;
  });

  describe("customers", () => {
    it("creates and retrieves a customer", async () => {
      const createRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "user@agent-emulate.dev", name: "Jane Doe" }),
      });
      expect(createRes.status).toBe(200);
      const customer = (await createRes.json()) as { id: string; object: string; email: string; name: string };
      expect(customer.id).toMatch(/^cus_/);
      expect(customer.object).toBe("customer");
      expect(customer.email).toBe("user@agent-emulate.dev");

      const getRes = await app.request(`${base}/v1/customers/${customer.id}`, { headers: auth() });
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as { id: string; email: string };
      expect(fetched.id).toBe(customer.id);
    });

    it("creates a customer from form-urlencoded body", async () => {
      const createRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: {
          Authorization: "Bearer sk_test_abc123",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=form%40agent-emulate.dev&name=Form+User",
      });
      expect(createRes.status).toBe(200);
      const customer = (await createRes.json()) as { id: string; email: string; name: string };
      expect(customer.email).toBe("form@agent-emulate.dev");
      expect(customer.name).toBe("Form User");
    });

    it("returns Stripe-format error for missing customer", async () => {
      const res = await app.request(`${base}/v1/customers/cus_nonexistent`, { headers: auth() });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { type: string; message: string; code: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("resource_missing");
      expect(body.error.message).toContain("cus_nonexistent");
    });

    it("lists with cursor pagination", async () => {
      // Create 3 customers
      const ids: string[] = [];
      for (const name of ["Alice", "Bob", "Carol"]) {
        const res = await app.request(`${base}/v1/customers`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify({ name }),
        });
        const c = (await res.json()) as { id: string };
        ids.push(c.id);
      }

      // List with limit=2
      const page1 = await app.request(`${base}/v1/customers?limit=2`, { headers: auth() });
      const p1 = (await page1.json()) as { data: Array<{ id: string }>; has_more: boolean };
      expect(p1.data.length).toBe(2);
      expect(p1.has_more).toBe(true);

      // Next page using starting_after
      const lastId = p1.data[p1.data.length - 1].id;
      const page2 = await app.request(`${base}/v1/customers?limit=2&starting_after=${lastId}`, { headers: auth() });
      const p2 = (await page2.json()) as { data: Array<{ id: string }>; has_more: boolean };
      expect(p2.data.length).toBeGreaterThanOrEqual(1);
      // Ensure no overlap
      const p2Ids = p2.data.map((c) => c.id);
      expect(p2Ids).not.toContain(p1.data[0].id);
      expect(p2Ids).not.toContain(p1.data[1].id);
    });

    it("filters by email", async () => {
      await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "unique@agent-emulate.dev" }),
      });
      const res = await app.request(`${base}/v1/customers?email=unique@agent-emulate.dev`, { headers: auth() });
      const body = (await res.json()) as { data: Array<{ email: string }> };
      expect(body.data.every((c) => c.email === "unique@agent-emulate.dev")).toBe(true);
    });

    it("cascades delete to related entities", async () => {
      const custRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "cascade@agent-emulate.dev" }),
      });
      const cust = (await custRes.json()) as { id: string };

      // Create a payment intent linked to this customer
      const piRes = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "usd", customer: cust.id }),
      });
      const pi = (await piRes.json()) as { id: string; customer: string };
      expect(pi.customer).toBe(cust.id);

      // Delete customer
      await app.request(`${base}/v1/customers/${cust.id}`, { method: "DELETE", headers: auth() });

      // Payment intent should have null customer
      const piCheck = await app.request(`${base}/v1/payment_intents/${pi.id}`, { headers: auth() });
      const piAfter = (await piCheck.json()) as { customer: string | null };
      expect(piAfter.customer).toBeNull();
    });
  });

  describe("payment intents", () => {
    it("creates a payment intent", async () => {
      const res = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 2000, currency: "usd" }),
      });
      expect(res.status).toBe(200);
      const pi = (await res.json()) as { id: string; object: string; amount: number; status: string };
      expect(pi.id).toMatch(/^pi_/);
      expect(pi.status).toBe("requires_payment_method");
    });

    it("confirms a payment intent and creates a charge", async () => {
      const createRes = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 5000, currency: "usd", payment_method: "pm_card_visa" }),
      });
      const pi = (await createRes.json()) as { id: string; status: string };
      expect(pi.status).toBe("requires_confirmation");

      const confirmRes = await app.request(`${base}/v1/payment_intents/${pi.id}/confirm`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(confirmRes.status).toBe(200);
      const confirmed = (await confirmRes.json()) as { status: string };
      expect(confirmed.status).toBe("succeeded");

      const chargesRes = await app.request(`${base}/v1/charges?payment_intent=${pi.id}`, { headers: auth() });
      const charges = (await chargesRes.json()) as { data: Array<{ amount: number; status: string }> };
      expect(charges.data).toHaveLength(1);
      expect(charges.data[0].amount).toBe(5000);
    });

    it("cancels a payment intent", async () => {
      const createRes = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "eur" }),
      });
      const pi = (await createRes.json()) as { id: string };

      const cancelRes = await app.request(`${base}/v1/payment_intents/${pi.id}/cancel`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(cancelRes.status).toBe(200);
      const canceled = (await cancelRes.json()) as { status: string };
      expect(canceled.status).toBe("canceled");
    });

    it("returns Stripe error for confirming succeeded intent", async () => {
      const createRes = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "usd", payment_method: "pm_card_visa" }),
      });
      const pi = (await createRes.json()) as { id: string };

      await app.request(`${base}/v1/payment_intents/${pi.id}/confirm`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });

      const res = await app.request(`${base}/v1/payment_intents/${pi.id}/confirm`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { type: string; code: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("payment_intent_unexpected_state");
    });

    it("filters by status", async () => {
      await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 100, currency: "usd" }),
      });

      const res = await app.request(`${base}/v1/payment_intents?status=requires_payment_method`, { headers: auth() });
      const body = (await res.json()) as { data: Array<{ status: string }> };
      expect(body.data.every((pi) => pi.status === "requires_payment_method")).toBe(true);
    });

    it("supports expand[]=customer", async () => {
      const custRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "expand@agent-emulate.dev", name: "Expand Test" }),
      });
      const cust = (await custRes.json()) as { id: string };

      const piRes = await app.request(`${base}/v1/payment_intents`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 3000, currency: "usd", customer: cust.id }),
      });
      const pi = (await piRes.json()) as { id: string; customer: string };

      // Without expand - customer is a string ID
      expect(typeof pi.customer).toBe("string");

      // With expand - customer is an object
      const expanded = await app.request(`${base}/v1/payment_intents/${pi.id}?expand[]=customer`, { headers: auth() });
      const body = (await expanded.json()) as { customer: { id: string; object: string; email: string } };
      expect(typeof body.customer).toBe("object");
      expect(body.customer.object).toBe("customer");
      expect(body.customer.email).toBe("expand@agent-emulate.dev");
    });
  });

  describe("products and prices", () => {
    it("creates a product and price", async () => {
      const prodRes = await app.request(`${base}/v1/products`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ name: "T-Shirt" }),
      });
      expect(prodRes.status).toBe(200);
      const product = (await prodRes.json()) as { id: string; name: string };
      expect(product.id).toMatch(/^prod_/);

      const priceRes = await app.request(`${base}/v1/prices`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ product: product.id, currency: "usd", unit_amount: 2000 }),
      });
      expect(priceRes.status).toBe(200);
      const price = (await priceRes.json()) as { id: string; product: string; unit_amount: number };
      expect(price.id).toMatch(/^price_/);
      expect(price.product).toBe(product.id);
    });

    it("supports expand[]=product on prices", async () => {
      const prodRes = await app.request(`${base}/v1/products`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ name: "Expandable Widget" }),
      });
      const product = (await prodRes.json()) as { id: string };

      const priceRes = await app.request(`${base}/v1/prices`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ product: product.id, currency: "usd", unit_amount: 500 }),
      });
      const price = (await priceRes.json()) as { id: string };

      const expanded = await app.request(`${base}/v1/prices/${price.id}?expand[]=product`, { headers: auth() });
      const body = (await expanded.json()) as { product: { id: string; object: string; name: string } };
      expect(typeof body.product).toBe("object");
      expect(body.product.object).toBe("product");
      expect(body.product.name).toBe("Expandable Widget");
    });
  });

  describe("checkout sessions", () => {
    it("creates and expires a checkout session", async () => {
      const createRes = await app.request(`${base}/v1/checkout/sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ mode: "payment", success_url: "https://agent-emulate.dev/success" }),
      });
      expect(createRes.status).toBe(200);
      const session = (await createRes.json()) as { id: string; object: string; status: string; url: string };
      expect(session.id).toMatch(/^cs_/);
      expect(session.status).toBe("open");
      expect(session.url).toBeTruthy();

      const expireRes = await app.request(`${base}/v1/checkout/sessions/${session.id}/expire`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(expireRes.status).toBe(200);
      const expired = (await expireRes.json()) as { status: string; url: string | null };
      expect(expired.status).toBe("expired");
      expect(expired.url).toBeNull();
    });

    it("lists with status filter", async () => {
      await app.request(`${base}/v1/checkout/sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ mode: "payment" }),
      });

      const res = await app.request(`${base}/v1/checkout/sessions?status=open`, { headers: auth() });
      const body = (await res.json()) as { data: Array<{ status: string }> };
      expect(body.data.every((s) => s.status === "open")).toBe(true);
    });
  });

  describe("customer sessions", () => {
    it("creates a customer session", async () => {
      const custRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "session@agent-emulate.dev" }),
      });
      const cust = (await custRes.json()) as { id: string };

      const res = await app.request(`${base}/v1/customer_sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          customer: cust.id,
          components: { payment_element: { enabled: true } },
        }),
      });
      expect(res.status).toBe(200);
      const session = (await res.json()) as {
        object: string;
        client_secret: string;
        customer: string;
        components: Record<string, unknown>;
        created: number;
        expires_at: number;
      };
      expect(session.object).toBe("customer_session");
      expect(session.client_secret).toBeTruthy();
      expect(session.customer).toBe(cust.id);
      expect(session.components).toEqual({ payment_element: { enabled: true } });
      expect(session.created).toBeTypeOf("number");
      expect(session.expires_at).toBeGreaterThan(session.created);
    });

    it("returns error for missing customer param", async () => {
      const res = await app.request(`${base}/v1/customer_sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { type: string; param: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.param).toBe("customer");
    });

    it("returns error for nonexistent customer", async () => {
      const res = await app.request(`${base}/v1/customer_sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ customer: "cus_nonexistent" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { type: string; code: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("payment methods", () => {
    it("lists payment methods for a customer", async () => {
      const custRes = await app.request(`${base}/v1/customers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ email: "methods@agent-emulate.dev" }),
      });
      const cust = (await custRes.json()) as { id: string };

      const res = await app.request(`${base}/v1/payment_methods?customer=${cust.id}&type=card`, {
        headers: auth(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: unknown[];
        has_more: boolean;
        object: string;
        url: string;
      };
      expect(body.object).toBe("list");
      expect(body.url).toBe("/v1/payment_methods");
      expect(body.has_more).toBe(false);
      expect(body.data).toEqual([]);
    });

    it("returns error for nonexistent customer", async () => {
      const res = await app.request(`${base}/v1/payment_methods?customer=cus_nonexistent&type=card`, {
        headers: auth(),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; param: string; type: string } };
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("resource_missing");
      expect(body.error.param).toBe("customer");
    });
  });

  describe("connect — accounts", () => {
    it("creates and retrieves a connected account with requested capabilities", async () => {
      const res = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          type: "express",
          country: "US",
          email: "merchant@agent-emulate.dev",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        }),
      });
      expect(res.status).toBe(200);
      const account = (await res.json()) as {
        id: string;
        object: string;
        type: string;
        charges_enabled: boolean;
        payouts_enabled: boolean;
        capabilities: Record<string, string>;
        requirements: { currently_due: string[] };
      };
      expect(account.id).toMatch(/^acct_/);
      expect(account.object).toBe("account");
      expect(account.type).toBe("express");
      expect(account.charges_enabled).toBe(true);
      expect(account.payouts_enabled).toBe(true);
      expect(account.capabilities.card_payments).toBe("active");
      expect(account.requirements.currently_due).toEqual([]);

      const getRes = await app.request(`${base}/v1/accounts/${account.id}`, { headers: auth() });
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as { id: string };
      expect(fetched.id).toBe(account.id);
    });

    it("defaults to a standard account with no capabilities", async () => {
      const res = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      const account = (await res.json()) as { type: string; charges_enabled: boolean; capabilities: object };
      expect(account.type).toBe("standard");
      expect(account.charges_enabled).toBe(false);
      expect(account.capabilities).toEqual({});
    });

    it("rejects an invalid business_type", async () => {
      const res = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ business_type: "alien" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string } };
      expect(body.error.param).toBe("business_type");
    });

    it("updates an account and grants capabilities", async () => {
      const createRes = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "custom" }),
      });
      const account = (await createRes.json()) as { id: string };

      const updateRes = await app.request(`${base}/v1/accounts/${account.id}`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ capabilities: { card_payments: { requested: true } }, email: "new@agent-emulate.dev" }),
      });
      const updated = (await updateRes.json()) as {
        email: string;
        charges_enabled: boolean;
        capabilities: Record<string, string>;
      };
      expect(updated.email).toBe("new@agent-emulate.dev");
      expect(updated.charges_enabled).toBe(true);
      expect(updated.capabilities.card_payments).toBe("active");
    });

    it("deletes an account", async () => {
      const createRes = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "express" }),
      });
      const account = (await createRes.json()) as { id: string };

      const delRes = await app.request(`${base}/v1/accounts/${account.id}`, { method: "DELETE", headers: auth() });
      const deleted = (await delRes.json()) as { deleted: boolean; object: string };
      expect(deleted.deleted).toBe(true);
      expect(deleted.object).toBe("account");

      const getRes = await app.request(`${base}/v1/accounts/${account.id}`, { headers: auth() });
      expect(getRes.status).toBe(404);
    });
  });

  describe("connect — account links", () => {
    it("creates an account link for an onboarding flow", async () => {
      const acctRes = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "express" }),
      });
      const account = (await acctRes.json()) as { id: string };

      const res = await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          account: account.id,
          refresh_url: "https://agent-emulate.dev/reauth",
          return_url: "https://agent-emulate.dev/return",
          type: "account_onboarding",
        }),
      });
      expect(res.status).toBe(200);
      const link = (await res.json()) as { object: string; url: string; created: number; expires_at: number };
      expect(link.object).toBe("account_link");
      expect(link.url).toContain(account.id);
      expect(link.expires_at).toBeGreaterThan(link.created);
    });

    it("rejects an invalid account link type", async () => {
      const acctRes = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "express" }),
      });
      const account = (await acctRes.json()) as { id: string };

      const res = await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ account: account.id, type: "bogus" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string } };
      expect(body.error.param).toBe("type");
    });

    it("rejects an account link for a nonexistent account", async () => {
      const res = await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ account: "acct_nonexistent", type: "account_onboarding" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("connect — transfers", () => {
    async function makeAccount(): Promise<string> {
      const res = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "express", capabilities: { transfers: { requested: true } } }),
      });
      return ((await res.json()) as { id: string }).id;
    }

    it("creates a transfer to a connected account", async () => {
      const destination = await makeAccount();
      const res = await app.request(`${base}/v1/transfers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "usd", destination, transfer_group: "ORDER_1" }),
      });
      expect(res.status).toBe(200);
      const transfer = (await res.json()) as {
        id: string;
        object: string;
        amount: number;
        destination: string;
        reversed: boolean;
        reversals: { object: string; total_count: number };
      };
      expect(transfer.id).toMatch(/^tr_/);
      expect(transfer.object).toBe("transfer");
      expect(transfer.amount).toBe(1000);
      expect(transfer.destination).toBe(destination);
      expect(transfer.reversed).toBe(false);
      expect(transfer.reversals.object).toBe("list");
      expect(transfer.reversals.total_count).toBe(0);
    });

    it("rejects a transfer to a nonexistent destination", async () => {
      const res = await app.request(`${base}/v1/transfers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 500, currency: "usd", destination: "acct_nope" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string; code: string } };
      expect(body.error.param).toBe("destination");
      expect(body.error.code).toBe("resource_missing");
    });

    it("reverses a transfer fully and partially", async () => {
      const destination = await makeAccount();
      const createRes = await app.request(`${base}/v1/transfers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "usd", destination }),
      });
      const transfer = (await createRes.json()) as { id: string };

      // Partial reversal
      const partialRes = await app.request(`${base}/v1/transfers/${transfer.id}/reversals`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 400 }),
      });
      expect(partialRes.status).toBe(200);
      const reversal = (await partialRes.json()) as { id: string; object: string; amount: number; transfer: string };
      expect(reversal.id).toMatch(/^trr_/);
      expect(reversal.object).toBe("transfer_reversal");
      expect(reversal.amount).toBe(400);
      expect(reversal.transfer).toBe(transfer.id);

      // Transfer now shows partial reversal
      const afterPartial = await app.request(`${base}/v1/transfers/${transfer.id}`, { headers: auth() });
      const tp = (await afterPartial.json()) as { amount_reversed: number; reversed: boolean };
      expect(tp.amount_reversed).toBe(400);
      expect(tp.reversed).toBe(false);

      // Reverse the remainder (default amount = remaining)
      const fullRes = await app.request(`${base}/v1/transfers/${transfer.id}/reversals`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(fullRes.status).toBe(200);

      const afterFull = await app.request(`${base}/v1/transfers/${transfer.id}`, { headers: auth() });
      const tf = (await afterFull.json()) as {
        amount_reversed: number;
        reversed: boolean;
        reversals: { total_count: number };
      };
      expect(tf.amount_reversed).toBe(1000);
      expect(tf.reversed).toBe(true);
      expect(tf.reversals.total_count).toBe(2);
    });

    it("rejects an over-reversal", async () => {
      const destination = await makeAccount();
      const createRes = await app.request(`${base}/v1/transfers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 100, currency: "usd", destination }),
      });
      const transfer = (await createRes.json()) as { id: string };

      const res = await app.request(`${base}/v1/transfers/${transfer.id}/reversals`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 200 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string } };
      expect(body.error.param).toBe("amount");
    });

    it("filters transfers by destination", async () => {
      const destination = await makeAccount();
      await app.request(`${base}/v1/transfers`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 250, currency: "usd", destination }),
      });
      const res = await app.request(`${base}/v1/transfers?destination=${destination}`, { headers: auth() });
      const body = (await res.json()) as { data: Array<{ destination: string }> };
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((t) => t.destination === destination)).toBe(true);
    });
  });

  describe("connect — payouts", () => {
    it("creates a payout in pending status", async () => {
      const res = await app.request(`${base}/v1/payouts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 5000, currency: "usd" }),
      });
      expect(res.status).toBe(200);
      const payout = (await res.json()) as {
        id: string;
        object: string;
        status: string;
        method: string;
        type: string;
        created: number;
        arrival_date: number;
        reconciliation_status: string;
      };
      expect(payout.id).toMatch(/^po_/);
      expect(payout.object).toBe("payout");
      expect(payout.status).toBe("pending");
      expect(payout.method).toBe("standard");
      expect(payout.type).toBe("bank_account");
      expect(payout.reconciliation_status).toBe("not_applicable");
      expect(payout.arrival_date).toBeGreaterThan(payout.created);
    });

    it("cancels a pending payout", async () => {
      const createRes = await app.request(`${base}/v1/payouts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 1000, currency: "usd" }),
      });
      const payout = (await createRes.json()) as { id: string };

      const cancelRes = await app.request(`${base}/v1/payouts/${payout.id}/cancel`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(cancelRes.status).toBe(200);
      const canceled = (await cancelRes.json()) as { status: string };
      expect(canceled.status).toBe("canceled");

      // Cannot cancel twice
      const again = await app.request(`${base}/v1/payouts/${payout.id}/cancel`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({}),
      });
      expect(again.status).toBe(400);
      const body = (await again.json()) as { error: { code: string } };
      expect(body.error.code).toBe("payout_not_cancelable");
    });

    it("requires amount and currency", async () => {
      const res = await app.request(`${base}/v1/payouts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ currency: "usd" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string } };
      expect(body.error.param).toBe("amount");
    });

    it("filters payouts by status", async () => {
      await app.request(`${base}/v1/payouts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ amount: 100, currency: "usd" }),
      });
      const res = await app.request(`${base}/v1/payouts?status=pending`, { headers: auth() });
      const body = (await res.json()) as { data: Array<{ status: string }> };
      expect(body.data.every((p) => p.status === "pending")).toBe(true);
    });
  });

  describe("connect — hosted onboarding", () => {
    async function makeExpressAccount(): Promise<string> {
      const res = await app.request(`${base}/v1/accounts`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ type: "express" }),
      });
      return ((await res.json()) as { id: string }).id;
    }

    it("points the account link at the emulator-hosted onboarding page", async () => {
      const acct = await makeExpressAccount();
      const linkRes = await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          account: acct,
          refresh_url: "https://agent-emulate.dev/reauth",
          return_url: "https://agent-emulate.dev/return",
          type: "account_onboarding",
        }),
      });
      const link = (await linkRes.json()) as { url: string };
      expect(link.url).toBe(`${base}/connect/onboard?acct=${acct}`);
    });

    it("renders the hosted onboarding page", async () => {
      const acct = await makeExpressAccount();
      await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          account: acct,
          return_url: "https://agent-emulate.dev/return",
          type: "account_onboarding",
        }),
      });

      const pageRes = await app.request(`${base}/connect/onboard?acct=${acct}`);
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      expect(html).toContain("Complete onboarding");
      expect(html).toContain("/connect/onboard/complete");
    });

    it("completes onboarding, flips the flags, and redirects to return_url", async () => {
      const acct = await makeExpressAccount();
      await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          account: acct,
          return_url: "https://agent-emulate.dev/return",
          type: "account_onboarding",
        }),
      });

      const completeRes = await app.request(`${base}/connect/onboard/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `acct=${acct}`,
      });
      expect(completeRes.status).toBe(302);
      expect(completeRes.headers.get("location")).toBe("https://agent-emulate.dev/return");

      const accountRes = await app.request(`${base}/v1/accounts/${acct}`, { headers: auth() });
      const account = (await accountRes.json()) as {
        charges_enabled: boolean;
        payouts_enabled: boolean;
        details_submitted: boolean;
        capabilities: Record<string, string>;
      };
      expect(account.charges_enabled).toBe(true);
      expect(account.payouts_enabled).toBe(true);
      expect(account.details_submitted).toBe(true);
      expect(account.capabilities.card_payments).toBe("active");
      expect(account.capabilities.transfers).toBe("active");
    });

    it("skips onboarding, leaving the account incomplete, and redirects to return_url", async () => {
      const acct = await makeExpressAccount();
      await app.request(`${base}/v1/account_links`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          account: acct,
          return_url: "https://agent-emulate.dev/return",
          type: "account_onboarding",
        }),
      });

      const skipRes = await app.request(`${base}/connect/onboard/skip?acct=${acct}`);
      expect(skipRes.status).toBe(302);
      expect(skipRes.headers.get("location")).toBe("https://agent-emulate.dev/return");

      const accountRes = await app.request(`${base}/v1/accounts/${acct}`, { headers: auth() });
      const account = (await accountRes.json()) as { charges_enabled: boolean; details_submitted: boolean };
      expect(account.charges_enabled).toBe(false);
      expect(account.details_submitted).toBe(false);
    });

    it("renders a not-found page for an unknown account", async () => {
      const pageRes = await app.request(`${base}/connect/onboard?acct=acct_nonexistent`);
      expect(pageRes.status).toBe(404);
    });
  });

  describe("checkout — inline price_data", () => {
    it("creates a session from inline price_data", async () => {
      const res = await app.request(`${base}/v1/checkout/sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          mode: "payment",
          success_url: "https://agent-emulate.dev/success",
          line_items: [
            {
              quantity: 2,
              price_data: {
                currency: "usd",
                unit_amount: 1500,
                product_data: { name: "Ad-hoc Widget" },
              },
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const session = (await res.json()) as { id: string; status: string; url: string };
      expect(session.id).toMatch(/^cs_/);
      expect(session.status).toBe("open");

      // The hosted checkout page should render the ad-hoc line item.
      const pageRes = await app.request(`${base}/checkout/${session.id}`);
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      expect(html).toContain("Ad-hoc Widget");
    });

    it("rejects inline price_data missing unit_amount", async () => {
      const res = await app.request(`${base}/v1/checkout/sessions`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: "usd", product_data: { name: "Bad" } } }],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { param: string } };
      expect(body.error.param).toBe("line_items[0][price_data][unit_amount]");
    });
  });

  describe("invoices", () => {
    it("returns an empty list", async () => {
      const res = await app.request(`${base}/v1/invoices`, { headers: auth() });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { object: string; data: unknown[]; has_more: boolean };
      expect(body.object).toBe("list");
      expect(body.data).toEqual([]);
      expect(body.has_more).toBe(false);
    });

    it("returns a 404 for a specific invoice", async () => {
      const res = await app.request(`${base}/v1/invoices/in_nonexistent`, { headers: auth() });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("seed", () => {
    it("seeds customers and products from config", async () => {
      const store = new Store();
      stripePlugin.seed?.(store, base);
      seedFromConfig(store, base, {
        customers: [{ email: "seed@agent-emulate.dev", name: "Seeded User" }],
        products: [{ name: "Widget" }],
        prices: [{ product_name: "Widget", currency: "usd", unit_amount: 999 }],
      });

      const { getStripeStore } = await import("../store.js");
      const ss = getStripeStore(store);
      const customers = ss.customers.all();
      expect(customers.some((c) => c.email === "seed@agent-emulate.dev")).toBe(true);

      const products = ss.products.all();
      const widget = products.find((p) => p.name === "Widget");
      expect(widget).toBeDefined();

      const prices = ss.prices.findBy("product_id", widget!.stripe_id);
      expect(prices).toHaveLength(1);
      expect(prices[0].unit_amount).toBe(999);
    });
  });
});
