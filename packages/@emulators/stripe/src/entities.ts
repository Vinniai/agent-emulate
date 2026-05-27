import type { Entity } from "@emulators/core";

export interface StripeCustomer extends Entity {
  stripe_id: string;
  email: string | null;
  name: string | null;
  description: string | null;
  metadata: Record<string, string>;
}

export interface StripeProduct extends Entity {
  stripe_id: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: Record<string, string>;
}

export interface StripePrice extends Entity {
  stripe_id: string;
  product_id: string;
  currency: string;
  unit_amount: number | null;
  type: "one_time" | "recurring";
  lookup_key: string | null;
  recurring: { interval: "month" | "year"; interval_count: number } | null;
  active: boolean;
  metadata: Record<string, string>;
}

export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "canceled";

export interface StripePaymentIntent extends Entity {
  stripe_id: string;
  amount: number;
  currency: string;
  status: PaymentIntentStatus;
  customer_id: string | null;
  description: string | null;
  payment_method: string | null;
  metadata: Record<string, string>;
}

export interface StripeCharge extends Entity {
  stripe_id: string;
  amount: number;
  currency: string;
  status: "succeeded" | "pending" | "failed";
  customer_id: string | null;
  payment_intent_id: string | null;
  description: string | null;
  metadata: Record<string, string>;
}

export interface StripeCheckoutSession extends Entity {
  stripe_id: string;
  mode: "payment" | "setup" | "subscription";
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  customer_id: string | null;
  success_url: string | null;
  cancel_url: string | null;
  line_items: Array<{ price: string; quantity: number }>;
  metadata: Record<string, string>;
}

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "paused";

export interface StripeSubscription extends Entity {
  stripe_id: string;
  customer_id: string;
  status: SubscriptionStatus;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  trial_start: number | null;
  trial_end: number | null;
  metadata: Record<string, string>;
}

export interface StripeSubscriptionItem extends Entity {
  stripe_id: string;
  subscription_id: string;
  price_id: string;
  price_lookup_key: string | null;
  quantity: number;
  metadata: Record<string, string>;
}

// ── Connect ────────────────────────────────────────────────────────────────

export type AccountType = "standard" | "express" | "custom";
export type AccountBusinessType = "individual" | "company" | "non_profit" | "government_entity";
export type CapabilityStatus = "active" | "inactive" | "pending";

export interface StripeAccount extends Entity {
  stripe_id: string;
  type: AccountType;
  country: string;
  default_currency: string;
  email: string | null;
  business_type: AccountBusinessType | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  capabilities: Record<string, CapabilityStatus>;
  // Redirect targets stashed by the most recent account link, used by the
  // emulator's hosted onboarding page to send the browser back when finished.
  onboarding_return_url: string | null;
  onboarding_refresh_url: string | null;
  metadata: Record<string, string>;
}

export interface StripeTransfer extends Entity {
  stripe_id: string;
  amount: number;
  currency: string;
  destination: string | null;
  description: string | null;
  source_transaction: string | null;
  source_type: string | null;
  transfer_group: string | null;
  amount_reversed: number;
  reversed: boolean;
  metadata: Record<string, string>;
}

export interface StripeTransferReversal extends Entity {
  stripe_id: string;
  transfer_id: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
}

export type PayoutStatus = "paid" | "pending" | "in_transit" | "canceled" | "failed";
export type PayoutMethod = "standard" | "instant";
export type PayoutType = "bank_account" | "card";

export interface StripePayout extends Entity {
  stripe_id: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  description: string | null;
  destination: string | null;
  method: PayoutMethod;
  type: PayoutType;
  source_type: string;
  statement_descriptor: string | null;
  automatic: boolean;
  arrival_date: number;
  original_payout: string | null;
  reversed_by: string | null;
  metadata: Record<string, string>;
}
