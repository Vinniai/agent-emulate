import type { RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getStripeStore } from "../store.js";

const SERVICE_LABEL = "Stripe";

function cents(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

function unixDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(status: string): string {
  const active = ["active", "succeeded", "trialing", "paid", "complete"];
  const warn = ["processing", "open", "past_due", "requires_action", "trialing"];
  const bad = ["canceled", "failed", "incomplete", "expired"];
  const cls = active.includes(status) ? "badge-granted" : bad.includes(status) ? "badge-denied" : "badge-requested";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

export function inspectorRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ss = () => getStripeStore(store);

  app.get("/", (c) => {
    const tab = c.req.query("tab") ?? "customers";
    const s = ss();

    const customers = s.customers.all();
    const products = s.products.all();
    const prices = s.prices.all();
    const subscriptions = s.subscriptions.all();
    const paymentIntents = s.paymentIntents.all();
    const charges = s.charges.all();

    const sidebar = `
<a href="/?tab=customers"${tab === "customers" ? ' class="active"' : ""}>Customers (${customers.length})</a>
<a href="/?tab=subscriptions"${tab === "subscriptions" ? ' class="active"' : ""}>Subscriptions (${subscriptions.length})</a>
<a href="/?tab=products"${tab === "products" ? ' class="active"' : ""}>Products (${products.length})</a>
<a href="/?tab=prices"${tab === "prices" ? ' class="active"' : ""}>Prices (${prices.length})</a>
<a href="/?tab=payments"${tab === "payments" ? ' class="active"' : ""}>Payments (${paymentIntents.length})</a>`;

    let bodyHtml = "";

    if (tab === "customers") {
      const rows =
        customers.length === 0
          ? `<tr><td colspan="4" class="inspector-empty">No customers yet.</td></tr>`
          : customers
              .map((c) => {
                const subs = subscriptions.filter((s) => s.customer_id === c.stripe_id);
                const subBadge =
                  subs.length > 0
                    ? subs.map((s) => statusBadge(s.status)).join(" ")
                    : '<span class="badge badge-requested">no subscription</span>';
                return `
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(c.email ?? "—")}</span><br><span style="color:#1a8c00;font-size:.75rem">${escapeHtml(c.name ?? "")}</span></td>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(c.stripe_id)}</code></td>
  <td>${subBadge}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Customers</h2>
  <table class="inspector-table">
    <thead><tr><th>Email / Name</th><th>ID</th><th>Subscriptions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "subscriptions") {
      const subItems = s.subscriptionItems.all();
      const rows =
        subscriptions.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No subscriptions yet.</td></tr>`
          : subscriptions
              .map((sub) => {
                const customer = customers.find((c) => c.stripe_id === sub.customer_id);
                const items = subItems.filter((i) => i.subscription_id === sub.stripe_id);
                const priceLabels =
                  items
                    .map((i) => {
                      const price = prices.find((p) => p.stripe_id === i.price_id);
                      const label = price
                        ? `${cents(price.unit_amount, price.currency)}/${price.recurring?.interval ?? ""}`
                        : i.price_id;
                      return `<span style="color:#33ff00">${escapeHtml(label)}</span> ×${i.quantity}`;
                    })
                    .join(", ") || "—";

                const trialNote =
                  sub.trial_end && sub.trial_end > Date.now() / 1000
                    ? `<br><span style="color:#1a8c00;font-size:.75rem">trial ends ${unixDate(sub.trial_end)}</span>`
                    : "";

                return `
<tr>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(sub.stripe_id)}</code></td>
  <td><span style="color:#33ff00">${escapeHtml(customer?.email ?? sub.customer_id)}</span></td>
  <td>${statusBadge(sub.status)}${trialNote}</td>
  <td>${priceLabels}</td>
  <td style="color:#1a8c00;font-size:.75rem">${unixDate(sub.current_period_end)}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Subscriptions</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Customer</th><th>Status</th><th>Plan</th><th>Renews</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "products") {
      const rows =
        products.length === 0
          ? `<tr><td colspan="3" class="inspector-empty">No products yet.</td></tr>`
          : products
              .map((p) => {
                const productPrices = prices.filter((pr) => pr.product_id === p.stripe_id);
                const priceList =
                  productPrices.length === 0
                    ? "—"
                    : productPrices
                        .map(
                          (pr) =>
                            `<span style="color:#33ff00">${escapeHtml(cents(pr.unit_amount, pr.currency))}</span> <span style="color:#1a8c00;font-size:.75rem">${pr.recurring ? `/${pr.recurring.interval}` : "one-time"}</span>`,
                        )
                        .join(", ");
                return `
<tr>
  <td><span style="color:#33ff00;font-weight:600">${escapeHtml(p.name)}</span><br><span style="color:#1a8c00;font-size:.75rem">${escapeHtml(p.description ?? "")}</span></td>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(p.stripe_id)}</code></td>
  <td>${p.active ? '<span class="badge badge-granted">active</span>' : '<span class="badge badge-denied">inactive</span>'}</td>
  <td>${priceList}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Products</h2>
  <table class="inspector-table">
    <thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Prices</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "prices") {
      const rows =
        prices.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No prices yet.</td></tr>`
          : prices
              .map((p) => {
                const product = products.find((pr) => pr.stripe_id === p.product_id);
                return `
<tr>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(p.stripe_id)}</code></td>
  <td>${escapeHtml(product?.name ?? p.product_id)}</td>
  <td><span style="color:#33ff00;font-weight:600">${cents(p.unit_amount, p.currency)}</span></td>
  <td>${p.recurring ? `<span class="badge badge-granted">${escapeHtml(p.recurring.interval)}ly</span>` : '<span class="badge badge-requested">one-time</span>'}</td>
  <td>${p.lookup_key ? `<code style="color:#1a8c00;font-size:.75rem">${escapeHtml(p.lookup_key)}</code>` : "—"}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Prices</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Product</th><th>Amount</th><th>Billing</th><th>Lookup Key</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    if (tab === "payments") {
      const rows =
        paymentIntents.length === 0
          ? `<tr><td colspan="5" class="inspector-empty">No payment intents yet.</td></tr>`
          : paymentIntents
              .map((pi) => {
                const customer = customers.find((c) => c.stripe_id === pi.customer_id);
                const charge = charges.find((ch) => ch.payment_intent_id === pi.stripe_id);
                return `
<tr>
  <td><code style="color:#1a8c00;font-size:.75rem">${escapeHtml(pi.stripe_id)}</code></td>
  <td><span style="color:#33ff00;font-weight:600">${cents(pi.amount, pi.currency)}</span></td>
  <td>${escapeHtml(customer?.email ?? pi.customer_id ?? "—")}</td>
  <td>${statusBadge(pi.status)}</td>
  <td>${charge ? statusBadge(charge.status) : "—"}</td>
</tr>`;
              })
              .join("");

      bodyHtml = `
<div class="inspector-section">
  <h2>Payment Intents</h2>
  <table class="inspector-table">
    <thead><tr><th>ID</th><th>Amount</th><th>Customer</th><th>Intent Status</th><th>Charge</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
    }

    const stats = `${customers.length} customers · ${subscriptions.length} subscriptions · ${paymentIntents.length} payments`;
    return c.html(
      renderSettingsPage(
        "Stripe Inspector",
        sidebar,
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">$</div>
    <div>
      <div class="s-title">Stripe Payments</div>
      <div class="s-subtitle">${stats}</div>
    </div>
  </div>
  ${bodyHtml}
</div>`,
        SERVICE_LABEL,
      ),
    );
  });
}
