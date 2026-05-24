// Stripe payments emulator — catalog, checkout, payment intents.
//
// The flow a storefront drives: browse the seeded catalog, open a Checkout
// Session, then create and confirm a PaymentIntent.
//
//   pnpm --filter api-emulators-quickstart stripe
import { stripePlugin, seedFromConfig } from "@emulators/stripe";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4090";

interface StripeList {
  data: Array<{ id: string }>;
}

async function main(): Promise<void> {
  const emu = mount(stripePlugin, BASE, { fallbackUser: { login: "sk_test_admin", id: 1, scopes: [] } });

  seedFromConfig(emu.store, BASE, {
    customers: [{ email: "buyer@agent-emulate.dev", name: "Acme Buyer" }],
    products: [{ name: "Pro Plan", description: "Monthly pro subscription" }],
    prices: [{ product_name: "Pro Plan", currency: "usd", unit_amount: 2000 }],
  });

  // Stripe accepts JSON or form-encoded; the SDK sends form, JSON reads cleaner.
  const auth = { Authorization: "Bearer sk_test_dev", "Content-Type": "application/json" };
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: auth, body: JSON.stringify(body) });

  heading("Stripe — catalog");

  const products = (await call(emu, "List products", `${BASE}/v1/products`, { headers: auth })) as StripeList;
  const prices = (await call(emu, "List prices", `${BASE}/v1/prices`, { headers: auth })) as StripeList;
  const priceId = prices.data[0]!.id;

  heading("Stripe — Checkout Session");

  await call(
    emu,
    "Create a Checkout Session",
    `${BASE}/v1/checkout/sessions`,
    post({
      mode: "payment",
      success_url: "https://agent-emulate.dev/success",
      cancel_url: "https://agent-emulate.dev/cancel",
      line_items: [{ price: priceId, quantity: 1 }],
    }),
  );

  heading("Stripe — PaymentIntent");

  const pi = (await call(
    emu,
    "Create a PaymentIntent",
    `${BASE}/v1/payment_intents`,
    post({
      amount: 2000,
      currency: "usd",
      payment_method: "pm_card_visa",
    }),
  )) as { id: string };

  await call(emu, "Confirm it", `${BASE}/v1/payment_intents/${pi.id}/confirm`, post({}));

  console.log(`\n✅ Stripe demo complete (catalog has ${products.data.length} product(s)).\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
