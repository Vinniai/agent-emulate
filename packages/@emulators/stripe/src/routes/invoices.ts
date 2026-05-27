import type { RouteContext } from "@emulators/core";
import { stripeError } from "../helpers.js";

/**
 * Invoices are not modelled as stored entities (only synthetic
 * `invoice.payment_succeeded` webhooks are emitted on subscription creation).
 * Real Stripe returns a paged list here, so we return an empty list rather than
 * a 404 — consumers that page over invoices then complete gracefully.
 */
export function invoiceRoutes({ app }: RouteContext): void {
  app.get("/v1/invoices", (c) => {
    return c.json({ object: "list", url: "/v1/invoices", has_more: false, data: [] });
  });

  app.get("/v1/invoices/:id", (c) =>
    stripeError(c, 404, "invalid_request_error", `No such invoice: '${c.req.param("id")}'`, "resource_missing"),
  );
}
