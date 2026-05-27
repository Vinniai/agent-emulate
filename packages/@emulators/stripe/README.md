# @emulators/stripe

Stripe API emulation with customers, payment methods, customer sessions, payment intents, charges, products, prices, checkout sessions, subscriptions, invoices, and Connect (accounts, account links, transfers, payouts). Includes hosted checkout and Express onboarding pages plus webhook delivery.

Part of [agent-emulate](https://github.com/Vinniai/agent-emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/stripe
```

## Endpoints

### Customers

- `POST /v1/customers` — create customer
- `GET /v1/customers/:id` — retrieve customer
- `POST /v1/customers/:id` — update customer
- `DELETE /v1/customers/:id` — delete customer
- `GET /v1/customers` — list customers

### Payment Methods

- `GET /v1/payment_methods` — list payment methods

### Customer Sessions

- `POST /v1/customer_sessions` — create customer session

### Payment Intents

- `POST /v1/payment_intents` — create payment intent
- `GET /v1/payment_intents/:id` — retrieve payment intent
- `POST /v1/payment_intents/:id` — update payment intent
- `POST /v1/payment_intents/:id/confirm` — confirm payment intent
- `POST /v1/payment_intents/:id/cancel` — cancel payment intent
- `GET /v1/payment_intents` — list payment intents

### Charges

- `GET /v1/charges/:id` — retrieve charge
- `GET /v1/charges` — list charges

### Products

- `POST /v1/products` — create product
- `GET /v1/products/:id` — retrieve product
- `GET /v1/products` — list products

### Prices

- `POST /v1/prices` — create price
- `GET /v1/prices/:id` — retrieve price
- `GET /v1/prices` — list prices

### Checkout Sessions

- `POST /v1/checkout/sessions` — create checkout session (`line_items[][price]` or inline `line_items[][price_data]` with `currency`, `unit_amount`, optional `product`/`product_data`, `recurring`)
- `GET /v1/checkout/sessions/:id` — retrieve session
- `POST /v1/checkout/sessions/:id/expire` — expire session
- `GET /v1/checkout/sessions` — list sessions (filter by `customer`, `status`, `payment_status`)
- `GET /checkout/:id` — hosted checkout page (HTML)
- `POST /checkout/:id/complete` — complete payment flow

### Subscriptions

- `POST /v1/subscriptions` — create subscription
- `GET /v1/subscriptions/:id` — retrieve subscription
- `POST /v1/subscriptions/:id` — update subscription
- `DELETE /v1/subscriptions/:id` — cancel subscription immediately
- `GET /v1/subscriptions` — list subscriptions (filter by `customer`, `status`)
- `POST /v1/billing_portal/sessions` — create billing portal session (stub)

### Connect — Accounts

- `POST /v1/accounts` — create connected account (`type`: `standard` | `express` | `custom`; requested `capabilities` are granted immediately in test mode)
- `GET /v1/accounts/:id` — retrieve account
- `POST /v1/accounts/:id` — update account (merge `capabilities`, set `email`, `business_type`, `metadata`)
- `DELETE /v1/accounts/:id` — delete account
- `GET /v1/accounts` — list accounts

### Connect — Account Links & Hosted Onboarding

- `POST /v1/account_links` — create onboarding link (`type`: `account_onboarding` | `account_update`; expires after ~5 minutes). The returned `url` points at the emulator's own hosted onboarding page, and `return_url`/`refresh_url` are stashed on the account for the redirect back.
- `GET /connect/onboard?acct=:id` — hosted Express onboarding page (HTML) with **Complete** and **Skip** actions
- `POST /connect/onboard/complete` — grant standard capabilities (`card_payments`, `transfers`), flip `charges_enabled`/`payouts_enabled`/`details_submitted` to `true`, emit `account.updated`, and redirect to the stashed `return_url`
- `GET /connect/onboard/skip?acct=:id` — leave the account incomplete and redirect to the stashed `return_url`

### Connect — Transfers

- `POST /v1/transfers` — create transfer (requires `amount`, `currency`, existing `destination` account)
- `GET /v1/transfers/:id` — retrieve transfer
- `POST /v1/transfers/:id` — update transfer (`description`, `metadata`)
- `GET /v1/transfers` — list transfers (filter by `destination`, `transfer_group`)
- `POST /v1/transfers/:id/reversals` — reverse a transfer (full or partial via `amount`)
- `GET /v1/transfers/:id/reversals` — list reversals
- `GET /v1/transfers/:id/reversals/:rid` — retrieve a reversal

### Connect — Payouts

- `POST /v1/payouts` — create payout (requires `amount`, `currency`; starts `pending`, arrives in ~2 days)
- `GET /v1/payouts/:id` — retrieve payout
- `POST /v1/payouts/:id` — update payout (`metadata`)
- `POST /v1/payouts/:id/cancel` — cancel a `pending`/`in_transit` payout
- `POST /v1/payouts/:id/reverse` — reverse a `paid`/`in_transit` payout (returns a new payout)
- `GET /v1/payouts` — list payouts (filter by `status`)

### Invoices

Invoices are not modelled as stored entities (only synthetic `invoice.payment_succeeded` webhooks are emitted on subscription creation), but the list endpoint is provided so consumers that page over invoices complete gracefully.

- `GET /v1/invoices` — returns an empty list
- `GET /v1/invoices/:id` — returns a `resource_missing` 404

## Webhooks

Events are delivered to configured webhook URLs:

- `checkout.session.completed` — when a checkout session is completed
- `checkout.session.expired` — when a checkout session expires
- `customer.created` / `customer.updated` / `customer.deleted`
- `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
- `invoice.payment_succeeded` — synthetic, on active subscription creation
- `account.updated` — on connected account create/update
- `transfer.created` — when a transfer is created
- `transfer.reversed` — when a transfer is fully reversed
- `payout.created` — when a payout (or payout reversal) is created
- `payout.canceled` — when a payout is canceled

## Seed Configuration

```yaml
stripe:
  customers:
    - name: Test Customer
      email: test@agent-emulate.dev
  products:
    - name: Pro Plan
  prices:
    - product: Pro Plan
      unit_amount: 2000
      currency: usd
      recurring:
        interval: month
```

## Links

- [Full documentation](https://github.com/Vinniai/agent-emulate)
- [GitHub](https://github.com/Vinniai/agent-emulate)
