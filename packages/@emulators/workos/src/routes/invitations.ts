import type { AppEnv, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";

export function invitationRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade, webhooks: WebhookDispatcher): void {
  app.post("/user_management/invitations", async (c) => {
    const body = await c.req.json<{
      email: string;
      organizationId?: string;
      organization_id?: string;
      roleSlug?: string;
      role_slug?: string;
    }>();
    const orgId = body.organizationId ?? body.organization_id ?? "";
    const role = body.roleSlug ?? body.role_slug ?? undefined;
    const invitation = ws.insertInvitation(body.email, orgId, role);

    // Best-effort webhook delivery
    webhooks.dispatch("user_invitation.created", undefined, { invitation }, "workos").catch(() => {});

    return c.json(invitation);
  });

  app.get("/user_management/invitations", (c) => {
    const orgId = c.req.query("organization_id") ?? c.req.query("organizationId") ?? "";
    const data = ws.listInvitations(orgId);
    return c.json({ data, list_metadata: { after: null, before: null } });
  });

  app.delete("/user_management/invitations/:invitationId", (c) => {
    const found = ws.revokeInvitation(c.req.param("invitationId"));
    if (!found) return c.json({ error: "invitation_not_found" }, 404);
    return c.body(null, 204);
  });
}
