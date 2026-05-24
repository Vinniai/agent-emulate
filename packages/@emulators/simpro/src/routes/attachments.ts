import type { Context } from "hono";
import type { RouteContext } from "@emulators/core";
import { getSimproStore } from "../store.js";
import type { SimproAttachmentParentType } from "../entities.js";
import { nowIso, paginate, parsePagination, rateLimit, requireAuth, simproNotFound } from "../helpers.js";
import { formatAttachment } from "../formatters.js";
import { nextExternalId } from "./jobs.js";

/**
 * Attachment endpoints for Simpro Build v1.0. Attachments are nested under
 * each parent entity — the real API exposes six parallel routes:
 *
 *   GET /api/v1.0/companies/:cid/jobs/:id/attachments/
 *   GET /api/v1.0/companies/:cid/quotes/:id/attachments/
 *   GET /api/v1.0/companies/:cid/invoices/:id/attachments/
 *   GET /api/v1.0/companies/:cid/customers/:id/attachments/
 *   GET /api/v1.0/companies/:cid/sites/:id/attachments/
 *   GET /api/v1.0/companies/:cid/assets/:id/attachments/
 *
 * Each returns the attachments for that specific parent, discovered via the
 * parent_type + parent_id keys on the attachment row.
 */
const PARENT_TYPES: ReadonlyArray<{
  segment: string;
  parentType: SimproAttachmentParentType;
}> = [
  { segment: "jobs", parentType: "job" },
  { segment: "quotes", parentType: "quote" },
  { segment: "invoices", parentType: "invoice" },
  { segment: "customers", parentType: "customer" },
  { segment: "sites", parentType: "site" },
  { segment: "assets", parentType: "asset" },
];

export function attachmentRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const guard = (c: Context): Response | null => {
    const rateEnabled = store.getData<boolean>("simpro.rate_limit_enabled") ?? false;
    const rl = rateLimit(c, rateEnabled);
    if (rl) return rl;
    const auth = requireAuth(c, ss);
    if (auth) return auth as unknown as Response;
    return null;
  };

  for (const { segment, parentType } of PARENT_TYPES) {
    app.get(`/api/v1.0/companies/:cid/${segment}/:id/attachments/`, (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      const companyId = Number(c.req.param("cid")) || 0;
      const parentId = Number(c.req.param("id"));
      const items = ss.attachments
        .all()
        .filter(
          (a) =>
            (a.company_id === companyId || companyId === 0) && a.parent_type === parentType && a.parent_id === parentId,
        );
      const page = paginate(c, items, parsePagination(c));
      return c.json(page.map(formatAttachment));
    });

    app.get(`/api/v1.0/companies/:cid/${segment}/:id/attachments/:attachmentId`, (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      const parentId = Number(c.req.param("id"));
      const attachmentId = Number(c.req.param("attachmentId"));
      const attachment = ss.attachments
        .all()
        .find((a) => a.parent_type === parentType && a.parent_id === parentId && a.external_id === attachmentId);
      if (!attachment) return simproNotFound(c);
      return c.json(formatAttachment(attachment));
    });

    // Upload attachment (multipart or JSON metadata)
    app.post(`/api/v1.0/companies/:cid/${segment}/:id/attachments/`, async (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      const companyId = Number(c.req.param("cid")) || 0;
      const parentId = Number(c.req.param("id"));
      const externalId = nextExternalId(ss, "attachments", companyId);
      const now = nowIso();
      let filename = `upload-${externalId}`;
      let description: string | null = null;
      let mimeType: string | null = null;
      let size = 0;
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("multipart/form-data")) {
        const form = await c.req.formData();
        const file = form.get("File") ?? form.get("file");
        if (file && typeof file === "object" && "name" in file) {
          filename = (file as File).name;
          mimeType = (file as File).type || null;
          size = (file as File).size;
        }
        description = (form.get("Description") as string | null) ?? null;
      } else {
        try {
          const body = (await c.req.json()) as Record<string, unknown>;
          filename = (body.Filename as string) ?? filename;
          description = (body.Description as string | null) ?? null;
          mimeType = (body.MimeType as string | null) ?? null;
          size = (body.Size as number) ?? 0;
        } catch {
          /* ignore */
        }
      }
      const attachment = ss.attachments.insert({
        company_id: companyId,
        external_id: externalId,
        parent_type: parentType,
        parent_id: parentId,
        filename,
        description,
        mime_type: mimeType,
        size,
        url: `https://agent-emulate.dev/attachments/${parentType}/${parentId}/${externalId}/${filename}`,
        date_added: now,
      });
      return c.json(formatAttachment(attachment), 201);
    });

    app.delete(`/api/v1.0/companies/:cid/${segment}/:id/attachments/:attachmentId`, (c) => {
      const blocked = guard(c);
      if (blocked) return blocked;
      const parentId = Number(c.req.param("id"));
      const attachmentId = Number(c.req.param("attachmentId"));
      const attachment = ss.attachments
        .all()
        .find((a) => a.parent_type === parentType && a.parent_id === parentId && a.external_id === attachmentId);
      if (!attachment) return simproNotFound(c);
      ss.attachments.delete(attachment.id);
      return c.body(null, 204);
    });
  }
}
