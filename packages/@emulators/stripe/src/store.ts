import { Store, type Collection } from "@emulators/core";
import type {
  StripeCustomer,
  StripeProduct,
  StripePrice,
  StripePaymentIntent,
  StripeCharge,
  StripeCheckoutSession,
  StripeSubscription,
  StripeSubscriptionItem,
  StripeAccount,
  StripeTransfer,
  StripeTransferReversal,
  StripePayout,
} from "./entities.js";

export interface StripeStore {
  customers: Collection<StripeCustomer>;
  products: Collection<StripeProduct>;
  prices: Collection<StripePrice>;
  paymentIntents: Collection<StripePaymentIntent>;
  charges: Collection<StripeCharge>;
  checkoutSessions: Collection<StripeCheckoutSession>;
  subscriptions: Collection<StripeSubscription>;
  subscriptionItems: Collection<StripeSubscriptionItem>;
  accounts: Collection<StripeAccount>;
  transfers: Collection<StripeTransfer>;
  transferReversals: Collection<StripeTransferReversal>;
  payouts: Collection<StripePayout>;
}

export function getStripeStore(store: Store): StripeStore {
  return {
    customers: store.collection<StripeCustomer>("stripe.customers", ["stripe_id", "email"]),
    products: store.collection<StripeProduct>("stripe.products", ["stripe_id"]),
    prices: store.collection<StripePrice>("stripe.prices", ["stripe_id", "product_id", "lookup_key"]),
    paymentIntents: store.collection<StripePaymentIntent>("stripe.payment_intents", ["stripe_id", "customer_id"]),
    charges: store.collection<StripeCharge>("stripe.charges", ["stripe_id", "customer_id", "payment_intent_id"]),
    checkoutSessions: store.collection<StripeCheckoutSession>("stripe.checkout_sessions", ["stripe_id", "customer_id"]),
    subscriptions: store.collection<StripeSubscription>("stripe.subscriptions", ["stripe_id", "customer_id"]),
    subscriptionItems: store.collection<StripeSubscriptionItem>("stripe.subscription_items", [
      "stripe_id",
      "subscription_id",
    ]),
    accounts: store.collection<StripeAccount>("stripe.accounts", ["stripe_id"]),
    transfers: store.collection<StripeTransfer>("stripe.transfers", ["stripe_id", "destination", "transfer_group"]),
    transferReversals: store.collection<StripeTransferReversal>("stripe.transfer_reversals", [
      "stripe_id",
      "transfer_id",
    ]),
    payouts: store.collection<StripePayout>("stripe.payouts", ["stripe_id"]),
  };
}
