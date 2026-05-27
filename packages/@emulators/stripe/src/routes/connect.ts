import type { RouteContext } from "@emulators/core";
import { renderCardPage, escapeHtml, escapeAttr } from "@emulators/core";
import { getStripeStore } from "../store.js";
import { stripeId, toUnixTimestamp, parseStripeBody, stripeError, stripeList } from "../helpers.js";
import type {
  StripeAccount,
  StripeTransfer,
  StripeTransferReversal,
  StripePayout,
  AccountType,
  AccountBusinessType,
  CapabilityStatus,
  PayoutMethod,
  PayoutType,
} from "../entities.js";

const ACCOUNT_TYPES: AccountType[] = ["standard", "express", "custom"];
const BUSINESS_TYPES: AccountBusinessType[] = ["individual", "company", "non_profit", "government_entity"];
const ACCOUNT_LINK_TYPES = ["account_onboarding", "account_update"] as const;

// ── Formatters (Stripe-exact shapes) ────────────────────────────────────────

function emptyRequirements() {
  return {
    alternatives: [] as unknown[],
    current_deadline: null,
    currently_due: [] as string[],
    disabled_reason: null,
    errors: [] as unknown[],
    eventually_due: [] as string[],
    past_due: [] as string[],
    pending_verification: [] as string[],
  };
}

function formatAccount(a: StripeAccount) {
  return {
    id: a.stripe_id,
    object: "account" as const,
    type: a.type,
    business_type: a.business_type,
    capabilities: a.capabilities,
    charges_enabled: a.charges_enabled,
    country: a.country,
    created: toUnixTimestamp(a.created_at),
    default_currency: a.default_currency,
    details_submitted: a.details_submitted,
    email: a.email,
    external_accounts: {
      object: "list" as const,
      data: [] as unknown[],
      has_more: false,
      total_count: 0,
      url: `/v1/accounts/${a.stripe_id}/external_accounts`,
    },
    future_requirements: emptyRequirements(),
    metadata: a.metadata,
    payouts_enabled: a.payouts_enabled,
    requirements: emptyRequirements(),
    settings: {
      payouts: {
        debit_negative_balances: true,
        schedule: { delay_days: 2, interval: "daily" as const },
        statement_descriptor: null,
      },
    },
    livemode: false,
  };
}

function formatTransferReversal(r: StripeTransferReversal) {
  return {
    id: r.stripe_id,
    object: "transfer_reversal" as const,
    amount: r.amount,
    balance_transaction: null,
    created: toUnixTimestamp(r.created_at),
    currency: r.currency,
    destination_payment_refund: null,
    metadata: r.metadata,
    source_refund: null,
    transfer: r.transfer_id,
  };
}

function formatTransfer(t: StripeTransfer, reversals: StripeTransferReversal[]) {
  return {
    id: t.stripe_id,
    object: "transfer" as const,
    amount: t.amount,
    amount_reversed: t.amount_reversed,
    balance_transaction: null,
    created: toUnixTimestamp(t.created_at),
    currency: t.currency,
    description: t.description,
    destination: t.destination,
    destination_payment: null,
    livemode: false,
    metadata: t.metadata,
    reversals: {
      object: "list" as const,
      data: reversals.map(formatTransferReversal),
      has_more: false,
      total_count: reversals.length,
      url: `/v1/transfers/${t.stripe_id}/reversals`,
    },
    reversed: t.reversed,
    source_transaction: t.source_transaction,
    source_type: t.source_type,
    transfer_group: t.transfer_group,
  };
}

function formatPayout(p: StripePayout) {
  return {
    id: p.stripe_id,
    object: "payout" as const,
    amount: p.amount,
    arrival_date: p.arrival_date,
    automatic: p.automatic,
    balance_transaction: null,
    created: toUnixTimestamp(p.created_at),
    currency: p.currency,
    description: p.description,
    destination: p.destination,
    failure_balance_transaction: null,
    failure_code: null,
    failure_message: null,
    livemode: false,
    metadata: p.metadata,
    method: p.method,
    original_payout: p.original_payout,
    reconciliation_status: "not_applicable" as const,
    reversed_by: p.reversed_by,
    source_type: p.source_type,
    statement_descriptor: p.statement_descriptor,
    status: p.status,
    type: p.type,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map `capabilities[card_payments][requested]=true` form input to active statuses. */
function parseCapabilities(input: unknown): Record<string, CapabilityStatus> {
  const result: Record<string, CapabilityStatus> = {};
  if (!input || typeof input !== "object") return result;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    const requested =
      value && typeof value === "object" && "requested" in (value as Record<string, unknown>)
        ? (value as Record<string, unknown>).requested
        : value;
    if (requested === true || requested === "true") {
      result[name] = "active";
    }
  }
  return result;
}

const SERVICE_LABEL = "Stripe";

export function connectRoutes({ app, store, webhooks, baseUrl }: RouteContext): void {
  const ss = getStripeStore(store);

  // ── Accounts ───────────────────────────────────────────────────────────────

  app.post("/v1/accounts", async (c) => {
    const body = await parseStripeBody(c);

    const type = (body.type as AccountType) ?? "standard";
    if (!ACCOUNT_TYPES.includes(type)) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Invalid account type: must be one of ${ACCOUNT_TYPES.join(", ")}.`,
        undefined,
        "type",
      );
    }

    const businessType = body.business_type as AccountBusinessType | undefined;
    if (businessType && !BUSINESS_TYPES.includes(businessType)) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Invalid business_type: must be one of ${BUSINESS_TYPES.join(", ")}.`,
        undefined,
        "business_type",
      );
    }

    const capabilities = parseCapabilities(body.capabilities);

    const account = ss.accounts.insert({
      stripe_id: stripeId("acct"),
      type,
      country: (body.country as string) ?? "US",
      default_currency: ((body.default_currency as string) ?? "usd").toLowerCase(),
      email: (body.email as string) ?? null,
      business_type: businessType ?? null,
      // Test-mode emulation: requested capabilities are granted immediately.
      charges_enabled: capabilities.card_payments === "active",
      payouts_enabled: capabilities.transfers === "active",
      details_submitted: false,
      capabilities,
      onboarding_return_url: null,
      onboarding_refresh_url: null,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    await webhooks.dispatch(
      "account.updated",
      undefined,
      { type: "account.updated", data: { object: formatAccount(account) } },
      "stripe",
    );

    return c.json(formatAccount(account), 200);
  });

  app.get("/v1/accounts/:id", (c) => {
    const account = ss.accounts.findOneBy("stripe_id", c.req.param("id"));
    if (!account)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such account: '${c.req.param("id")}'`,
        "resource_missing",
      );
    return c.json(formatAccount(account));
  });

  app.post("/v1/accounts/:id", async (c) => {
    const account = ss.accounts.findOneBy("stripe_id", c.req.param("id"));
    if (!account)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such account: '${c.req.param("id")}'`,
        "resource_missing",
      );

    const body = await parseStripeBody(c);
    const patch: Partial<StripeAccount> = {};

    if (body.email !== undefined) patch.email = body.email as string;
    if (body.default_currency !== undefined) patch.default_currency = (body.default_currency as string).toLowerCase();
    if (body.business_type !== undefined) {
      const businessType = body.business_type as AccountBusinessType;
      if (!BUSINESS_TYPES.includes(businessType)) {
        return stripeError(
          c,
          400,
          "invalid_request_error",
          `Invalid business_type: must be one of ${BUSINESS_TYPES.join(", ")}.`,
          undefined,
          "business_type",
        );
      }
      patch.business_type = businessType;
    }
    if (body.metadata !== undefined) patch.metadata = body.metadata as Record<string, string>;
    if (body.capabilities !== undefined) {
      const merged = { ...account.capabilities, ...parseCapabilities(body.capabilities) };
      patch.capabilities = merged;
      patch.charges_enabled = merged.card_payments === "active";
      patch.payouts_enabled = merged.transfers === "active";
    }

    const updated = ss.accounts.update(account.id, patch)!;

    await webhooks.dispatch(
      "account.updated",
      undefined,
      { type: "account.updated", data: { object: formatAccount(updated) } },
      "stripe",
    );

    return c.json(formatAccount(updated));
  });

  app.delete("/v1/accounts/:id", (c) => {
    const account = ss.accounts.findOneBy("stripe_id", c.req.param("id"));
    if (!account)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such account: '${c.req.param("id")}'`,
        "resource_missing",
      );

    ss.accounts.delete(account.id);
    return c.json({ id: account.stripe_id, object: "account", deleted: true });
  });

  app.get("/v1/accounts", (c) => {
    return stripeList(c, ss.accounts.all(), "/v1/accounts", formatAccount);
  });

  // ── Account Links ────────────────────────────────────────────────────────────

  app.post("/v1/account_links", async (c) => {
    const body = await parseStripeBody(c);

    if (!body.account) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: account.", undefined, "account");
    }
    const account = ss.accounts.findOneBy("stripe_id", body.account as string);
    if (!account) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `No such account: '${body.account}'`,
        "resource_missing",
        "account",
      );
    }

    const type = body.type as (typeof ACCOUNT_LINK_TYPES)[number] | undefined;
    if (!type || !ACCOUNT_LINK_TYPES.includes(type)) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Invalid account link type: must be one of ${ACCOUNT_LINK_TYPES.join(", ")}.`,
        undefined,
        "type",
      );
    }

    // Stash the caller's redirect targets so the hosted page can send the
    // browser back when onboarding finishes (or is skipped).
    ss.accounts.update(account.id, {
      onboarding_return_url: (body.return_url as string) ?? null,
      onboarding_refresh_url: (body.refresh_url as string) ?? null,
    });

    const now = Math.floor(Date.now() / 1000);
    return c.json(
      {
        object: "account_link" as const,
        created: now,
        expires_at: now + 5 * 60, // Stripe links expire after ~5 minutes
        // Point at the emulator's own hosted onboarding page (analogous to the
        // hosted checkout page) rather than the real connect.stripe.com domain.
        url: `${baseUrl}/connect/onboard?acct=${account.stripe_id}`,
      },
      200,
    );
  });

  // ── Hosted Express onboarding (emulator-only) ───────────────────────────────
  // The page the account_link.url points at. "Complete" grants the standard
  // Express capabilities and flips the account to fully enabled; "Skip" leaves
  // it incomplete. Both redirect back to the stashed return_url.

  app.get("/connect/onboard", (c) => {
    const acct = c.req.query("acct") ?? "";
    const account = ss.accounts.findOneBy("stripe_id", acct);
    if (!account) {
      return c.html(
        renderCardPage(
          "Account Not Found",
          "This onboarding link is no longer valid.",
          '<p class="empty">The connected account does not exist or has been removed.</p>',
          SERVICE_LABEL,
        ),
        404,
      );
    }

    const status = account.details_submitted
      ? '<p class="empty check">Onboarding already complete</p>'
      : `<p class="empty">Charges and payouts are not yet enabled for this account.</p>`;

    const body = `
${status}
<form method="POST" action="/connect/onboard/complete">
  <input type="hidden" name="acct" value="${escapeAttr(account.stripe_id)}" />
  <button type="submit" class="checkout-pay-btn">Complete onboarding</button>
</form>
<div class="checkout-cancel"><a href="/connect/onboard/skip?acct=${escapeAttr(account.stripe_id)}">Skip for now (leave incomplete)</a></div>`;

    return c.html(
      renderCardPage("Complete onboarding", `Express account ${escapeHtml(account.stripe_id)}`, body, SERVICE_LABEL),
    );
  });

  app.post("/connect/onboard/complete", async (c) => {
    const body = await parseStripeBody(c);
    const acct = (body.acct as string) ?? c.req.query("acct") ?? "";
    const account = ss.accounts.findOneBy("stripe_id", acct);
    if (!account) {
      return c.html(
        renderCardPage(
          "Account Not Found",
          "This onboarding link is no longer valid.",
          '<p class="empty">The connected account does not exist or has been removed.</p>',
          SERVICE_LABEL,
        ),
        404,
      );
    }

    const updated = ss.accounts.update(account.id, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { ...account.capabilities, card_payments: "active", transfers: "active" },
    })!;

    await webhooks.dispatch(
      "account.updated",
      undefined,
      { type: "account.updated", data: { object: formatAccount(updated) } },
      "stripe",
    );

    if (updated.onboarding_return_url) {
      return c.redirect(updated.onboarding_return_url);
    }
    return c.html(
      renderCardPage(
        "Onboarding Complete",
        `Express account ${escapeHtml(updated.stripe_id)}`,
        '<p class="empty check">Charges and payouts enabled</p>',
        SERVICE_LABEL,
      ),
    );
  });

  app.get("/connect/onboard/skip", (c) => {
    const account = ss.accounts.findOneBy("stripe_id", c.req.query("acct") ?? "");
    // Leave the account incomplete; just send the browser back. The caller's
    // callback re-fetches status and sees details_submitted=false.
    if (account?.onboarding_return_url) {
      return c.redirect(account.onboarding_return_url);
    }
    return c.html(
      renderCardPage(
        "Onboarding Incomplete",
        account ? `Express account ${escapeHtml(account.stripe_id)}` : "Express onboarding",
        '<p class="empty">Onboarding was not completed.</p>',
        SERVICE_LABEL,
      ),
    );
  });

  // ── Transfers ─────────────────────────────────────────────────────────────

  app.post("/v1/transfers", async (c) => {
    const body = await parseStripeBody(c);

    if (body.amount === undefined) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: amount.", undefined, "amount");
    }
    if (!body.currency) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: currency.", undefined, "currency");
    }
    if (!body.destination) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        "Missing required param: destination.",
        undefined,
        "destination",
      );
    }

    const destination = body.destination as string;
    if (!ss.accounts.findOneBy("stripe_id", destination)) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `No such destination: '${destination}'`,
        "resource_missing",
        "destination",
      );
    }

    const transfer = ss.transfers.insert({
      stripe_id: stripeId("tr"),
      amount: Number(body.amount),
      currency: (body.currency as string).toLowerCase(),
      destination,
      description: (body.description as string) ?? null,
      source_transaction: (body.source_transaction as string) ?? null,
      source_type: (body.source_type as string) ?? "card",
      transfer_group: (body.transfer_group as string) ?? null,
      amount_reversed: 0,
      reversed: false,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    const formatted = formatTransfer(transfer, []);
    await webhooks.dispatch(
      "transfer.created",
      undefined,
      { type: "transfer.created", data: { object: formatted } },
      "stripe",
    );

    return c.json(formatted, 200);
  });

  app.get("/v1/transfers/:id", (c) => {
    const transfer = ss.transfers.findOneBy("stripe_id", c.req.param("id"));
    if (!transfer)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such transfer: '${c.req.param("id")}'`,
        "resource_missing",
      );
    const reversals = ss.transferReversals.findBy("transfer_id", transfer.stripe_id);
    return c.json(formatTransfer(transfer, reversals));
  });

  app.post("/v1/transfers/:id", async (c) => {
    const transfer = ss.transfers.findOneBy("stripe_id", c.req.param("id"));
    if (!transfer)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such transfer: '${c.req.param("id")}'`,
        "resource_missing",
      );

    const body = await parseStripeBody(c);
    const patch: Partial<StripeTransfer> = {};
    if (body.description !== undefined) patch.description = body.description as string;
    if (body.metadata !== undefined) patch.metadata = body.metadata as Record<string, string>;

    const updated = ss.transfers.update(transfer.id, patch)!;
    const reversals = ss.transferReversals.findBy("transfer_id", updated.stripe_id);
    return c.json(formatTransfer(updated, reversals));
  });

  app.get("/v1/transfers", (c) => {
    let items = ss.transfers.all();
    const destination = c.req.query("destination");
    const transferGroup = c.req.query("transfer_group");
    if (destination) items = items.filter((t) => t.destination === destination);
    if (transferGroup) items = items.filter((t) => t.transfer_group === transferGroup);
    return stripeList(c, items, "/v1/transfers", (t) =>
      formatTransfer(t, ss.transferReversals.findBy("transfer_id", t.stripe_id)),
    );
  });

  // ── Transfer Reversals ────────────────────────────────────────────────────

  app.post("/v1/transfers/:id/reversals", async (c) => {
    const transfer = ss.transfers.findOneBy("stripe_id", c.req.param("id"));
    if (!transfer)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such transfer: '${c.req.param("id")}'`,
        "resource_missing",
      );

    const body = await parseStripeBody(c);
    const remaining = transfer.amount - transfer.amount_reversed;
    const amount = body.amount !== undefined ? Number(body.amount) : remaining;

    if (amount <= 0 || amount > remaining) {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Reversal amount (${amount}) exceeds the unreversed amount on the transfer (${remaining}).`,
        undefined,
        "amount",
      );
    }

    const reversal = ss.transferReversals.insert({
      stripe_id: stripeId("trr"),
      transfer_id: transfer.stripe_id,
      amount,
      currency: transfer.currency,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    const newReversed = transfer.amount_reversed + amount;
    const updated = ss.transfers.update(transfer.id, {
      amount_reversed: newReversed,
      reversed: newReversed >= transfer.amount,
    })!;

    if (updated.reversed) {
      const reversals = ss.transferReversals.findBy("transfer_id", updated.stripe_id);
      await webhooks.dispatch(
        "transfer.reversed",
        undefined,
        { type: "transfer.reversed", data: { object: formatTransfer(updated, reversals) } },
        "stripe",
      );
    }

    return c.json(formatTransferReversal(reversal), 200);
  });

  app.get("/v1/transfers/:id/reversals", (c) => {
    const transfer = ss.transfers.findOneBy("stripe_id", c.req.param("id"));
    if (!transfer)
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such transfer: '${c.req.param("id")}'`,
        "resource_missing",
      );
    const reversals = ss.transferReversals.findBy("transfer_id", transfer.stripe_id);
    return stripeList(c, reversals, `/v1/transfers/${transfer.stripe_id}/reversals`, formatTransferReversal);
  });

  app.get("/v1/transfers/:id/reversals/:rid", (c) => {
    const reversal = ss.transferReversals.findOneBy("stripe_id", c.req.param("rid"));
    if (!reversal || reversal.transfer_id !== c.req.param("id"))
      return stripeError(
        c,
        404,
        "invalid_request_error",
        `No such transfer reversal: '${c.req.param("rid")}'`,
        "resource_missing",
      );
    return c.json(formatTransferReversal(reversal));
  });

  // ── Payouts ───────────────────────────────────────────────────────────────

  app.post("/v1/payouts", async (c) => {
    const body = await parseStripeBody(c);

    if (body.amount === undefined) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: amount.", undefined, "amount");
    }
    if (!body.currency) {
      return stripeError(c, 400, "invalid_request_error", "Missing required param: currency.", undefined, "currency");
    }

    const now = Math.floor(Date.now() / 1000);
    const payout = ss.payouts.insert({
      stripe_id: stripeId("po"),
      amount: Number(body.amount),
      currency: (body.currency as string).toLowerCase(),
      status: "pending",
      description: (body.description as string) ?? null,
      destination: (body.destination as string) ?? null,
      method: ((body.method as PayoutMethod) ?? "standard") as PayoutMethod,
      type: "bank_account" as PayoutType,
      source_type: (body.source_type as string) ?? "card",
      statement_descriptor: (body.statement_descriptor as string) ?? null,
      automatic: false,
      arrival_date: now + 2 * 24 * 3600, // standard payouts arrive in ~2 days
      original_payout: null,
      reversed_by: null,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    await webhooks.dispatch(
      "payout.created",
      undefined,
      { type: "payout.created", data: { object: formatPayout(payout) } },
      "stripe",
    );

    return c.json(formatPayout(payout), 200);
  });

  app.get("/v1/payouts/:id", (c) => {
    const payout = ss.payouts.findOneBy("stripe_id", c.req.param("id"));
    if (!payout)
      return stripeError(c, 404, "invalid_request_error", `No such payout: '${c.req.param("id")}'`, "resource_missing");
    return c.json(formatPayout(payout));
  });

  app.post("/v1/payouts/:id", async (c) => {
    const payout = ss.payouts.findOneBy("stripe_id", c.req.param("id"));
    if (!payout)
      return stripeError(c, 404, "invalid_request_error", `No such payout: '${c.req.param("id")}'`, "resource_missing");

    const body = await parseStripeBody(c);
    const patch: Partial<StripePayout> = {};
    if (body.metadata !== undefined) patch.metadata = body.metadata as Record<string, string>;

    const updated = ss.payouts.update(payout.id, patch)!;
    return c.json(formatPayout(updated));
  });

  app.post("/v1/payouts/:id/cancel", async (c) => {
    const payout = ss.payouts.findOneBy("stripe_id", c.req.param("id"));
    if (!payout)
      return stripeError(c, 404, "invalid_request_error", `No such payout: '${c.req.param("id")}'`, "resource_missing");

    if (payout.status !== "pending" && payout.status !== "in_transit") {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Payout cannot be canceled because it has status '${payout.status}'.`,
        "payout_not_cancelable",
      );
    }

    const updated = ss.payouts.update(payout.id, { status: "canceled" })!;
    await webhooks.dispatch(
      "payout.canceled",
      undefined,
      { type: "payout.canceled", data: { object: formatPayout(updated) } },
      "stripe",
    );

    return c.json(formatPayout(updated));
  });

  app.post("/v1/payouts/:id/reverse", async (c) => {
    const payout = ss.payouts.findOneBy("stripe_id", c.req.param("id"));
    if (!payout)
      return stripeError(c, 404, "invalid_request_error", `No such payout: '${c.req.param("id")}'`, "resource_missing");

    if (payout.status !== "paid" && payout.status !== "in_transit") {
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Only payouts with status 'paid' or 'in_transit' can be reversed (status is '${payout.status}').`,
        "payout_not_reversible",
      );
    }

    const body = await parseStripeBody(c);
    const now = Math.floor(Date.now() / 1000);

    // A reversal is represented as a new payout that references the original.
    const reversal = ss.payouts.insert({
      stripe_id: stripeId("po"),
      amount: payout.amount,
      currency: payout.currency,
      status: "in_transit",
      description: payout.description,
      destination: payout.destination,
      method: payout.method,
      type: payout.type,
      source_type: payout.source_type,
      statement_descriptor: payout.statement_descriptor,
      automatic: false,
      arrival_date: now + 2 * 24 * 3600,
      original_payout: payout.stripe_id,
      reversed_by: null,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    ss.payouts.update(payout.id, { reversed_by: reversal.stripe_id });

    await webhooks.dispatch(
      "payout.created",
      undefined,
      { type: "payout.created", data: { object: formatPayout(reversal) } },
      "stripe",
    );

    return c.json(formatPayout(reversal), 200);
  });

  app.get("/v1/payouts", (c) => {
    let items = ss.payouts.all();
    const status = c.req.query("status");
    if (status) items = items.filter((p) => p.status === status);
    return stripeList(c, items, "/v1/payouts", formatPayout);
  });
}
