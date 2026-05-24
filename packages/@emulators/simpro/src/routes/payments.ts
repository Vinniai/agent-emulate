import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import {
  nowIso,
  paginate,
  parseJson,
  parsePagination,
  rateLimit,
  requireAuth,
  simproError,
  simproNotFound,
  simproValidation,
} from "../helpers.js";
import { formatPayment } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

export function paymentRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  app.get("/api/v1.0/companies/:cid/customerPayments/", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const companyId = Number(c.req.param("cid")) || 0;
    let items = ss.customerPayments.all().filter((p) => p.company_id === companyId || companyId === 0);
    const customerId = c.req.query("Customer.ID");
    if (customerId) items = items.filter((p) => p.customer_id === Number(customerId));
    const invoiceId = c.req.query("Invoice.ID");
    if (invoiceId) items = items.filter((p) => p.invoice_id === Number(invoiceId));
    const pagination = parsePagination(c);
    const page = paginate(c, items, pagination);
    return c.json(page.map((p) => formatPayment(p)));
  });

  app.get("/api/v1.0/companies/:cid/customerPayments/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.customerPayments.findOneBy("external_id", Number(c.req.param("id")));
    if (!p) return simproNotFound(c);
    return c.json(formatPayment(p));
  });

  app.post("/api/v1.0/companies/:cid/customerPayments/", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }

    // Swagger body: { Payment: { PaymentMethod, Date, Amount, ... }, Invoices: [{ID}], Notes }
    const paymentObj = body.Payment as Record<string, unknown> | undefined;
    const invoicesArr = (body.Invoices as Array<{ ID: number }> | undefined) ?? [];
    // Also support legacy flat fields for backward compat
    const amount = Number(paymentObj?.Amount ?? body.Amount ?? 0);
    if (!amount) return simproValidation(c, "Amount", "Amount is required and must be non-zero.");

    // Derive customer from first invoice or explicit Customer field
    const firstInvoiceId = invoicesArr[0]?.ID ?? (body.Invoice as { ID?: number } | undefined)?.ID ?? null;
    let customerId: number | null = (body.Customer as { ID?: number } | undefined)?.ID ?? null;
    if (!customerId && firstInvoiceId) {
      const inv = ss.invoices.findOneBy("external_id", firstInvoiceId);
      if (inv) {
        const job = ss.jobs.findOneBy("external_id", inv.job_id);
        if (job) customerId = job.customer_id;
      }
    }
    if (!customerId) return simproValidation(c, "Customer.ID", "Customer is required.");

    const companyId = Number(c.req.param("cid")) || 0;
    const externalId = nextExternalId(ss, "customerPayments", companyId);
    const now = nowIso();

    const payment = ss.customerPayments.insert({
      company_id: companyId,
      external_id: externalId,
      customer_id: customerId,
      invoice_id: firstInvoiceId,
      amount,
      date: (paymentObj?.Date as string) ?? (body.Date as string) ?? now.slice(0, 10),
      payment_method: (paymentObj?.PaymentMethod as string | null) ?? (body.PaymentMethod as string | null) ?? null,
      notes: (body.Notes as string | null) ?? null,
      date_created: now,
      date_modified: now,
    });

    // Update invoice.paid for all linked invoices
    for (const invRef of invoicesArr) {
      const inv = ss.invoices.findOneBy("external_id", invRef.ID);
      if (inv) ss.invoices.update(inv.id, { paid: inv.paid + amount });
    }
    if (invoicesArr.length === 0 && firstInvoiceId) {
      const inv = ss.invoices.findOneBy("external_id", firstInvoiceId);
      if (inv) ss.invoices.update(inv.id, { paid: inv.paid + amount });
    }

    return c.json(formatPayment(payment), 201);
  });

  app.patch("/api/v1.0/companies/:cid/customerPayments/:id", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.customerPayments.findOneBy("external_id", Number(c.req.param("id")));
    if (!p) return simproNotFound(c);
    let body: Record<string, unknown>;
    try {
      body = await parseJson(c);
    } catch {
      return simproError(c, 400, "Problems parsing JSON.");
    }
    const paymentBody = body.Payment as Record<string, unknown> | undefined;
    ss.customerPayments.update(p.id, {
      ...(paymentBody?.Amount !== undefined && { amount: Number(paymentBody.Amount) }),
      ...(paymentBody?.Date !== undefined && { date: paymentBody.Date as string }),
      ...(paymentBody?.PaymentMethod !== undefined && { payment_method: paymentBody.PaymentMethod as string | null }),
      ...(body.Notes !== undefined && { notes: body.Notes as string | null }),
      date_modified: nowIso(),
    });
    return c.body(null, 204);
  });

  app.delete("/api/v1.0/companies/:cid/customerPayments/:id", (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const p = ss.customerPayments.findOneBy("external_id", Number(c.req.param("id")));
    if (!p) return simproNotFound(c);
    // Reverse invoice.paid if linked
    if (p.invoice_id) {
      const inv = ss.invoices.findOneBy("external_id", p.invoice_id);
      if (inv) ss.invoices.update(inv.id, { paid: Math.max(0, inv.paid - p.amount) });
    }
    ss.customerPayments.delete(p.id);
    return c.body(null, 204);
  });
}
