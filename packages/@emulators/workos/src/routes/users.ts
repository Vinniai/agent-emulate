import type { AppEnv, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";
import { emitWorkOSEvent } from "./events.js";

function membershipObject(
  m: {
    id: string;
    user_id: string;
    organization_id: string;
    role: { slug: string };
    status: string;
    created_at: string;
    updated_at: string;
  },
  orgName: string,
) {
  return {
    ...m,
    object: "organization_membership",
    organizationId: m.organization_id,
    organizationName: orgName,
  };
}

function userObject(u: {
  id: string;
  email: string;
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    object: "user",
    id: u.id,
    email: u.email,
    email_verified: u.email_verified,
    first_name: u.first_name,
    last_name: u.last_name,
    profile_picture_url: u.profile_picture_url,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

export function userRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade, webhooks: WebhookDispatcher): void {
  // List users (WorkOS SDK: userManagement.listUsers) — optional ?email= filter
  app.get("/user_management/users", (c) => {
    const email = c.req.query("email");
    const users = ws.allUsers().filter((u) => (email ? u.email === email : true));
    return c.json({ data: users.map(userObject), list_metadata: { after: null, before: null } });
  });

  // Create user (WorkOS SDK: userManagement.createUser)
  app.post("/user_management/users", async (c) => {
    const body = await c.req
      .json<{
        email?: string;
        password?: string;
        first_name?: string;
        last_name?: string;
        email_verified?: boolean;
      }>()
      .catch(
        () =>
          ({}) as {
            email?: string;
            password?: string;
            first_name?: string;
            last_name?: string;
            email_verified?: boolean;
          },
      );
    if (!body.email) return c.json({ code: "validation_error", message: "email is required" }, 422);
    const user = ws.insertUser({
      email: body.email,
      password: body.password,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      email_verified: body.email_verified,
    });
    const payload = userObject(user);
    emitWorkOSEvent(webhooks, "user.created", payload);
    return c.json(payload, 201);
  });

  // Get single user
  app.get("/user_management/users/:userId", (c) => {
    const user = ws.getUser(c.req.param("userId"));
    if (!user) return c.json({ code: "entity_not_found", message: "User not found" }, 404);
    return c.json(userObject(user));
  });

  // Update user (PUT — WorkOS SDK: userManagement.updateUser)
  app.put("/user_management/users/:userId", async (c) => {
    const patch = await c.req.json<{
      first_name?: string;
      last_name?: string;
      email?: string;
      email_verified?: boolean;
      profile_picture_url?: string;
    }>();
    const updated = ws.updateUser(c.req.param("userId"), patch);
    if (!updated) return c.json({ code: "entity_not_found", message: "User not found" }, 404);
    const payload = userObject(updated);
    emitWorkOSEvent(webhooks, "user.updated", payload);
    return c.json(payload);
  });

  // Delete user
  app.delete("/user_management/users/:userId", (c) => {
    const userId = c.req.param("userId");
    // Capture the user before deletion so the event payload carries its identity.
    const existing = ws.getUser(userId);
    const ok = ws.deleteUser(userId);
    if (!ok || !existing) return c.json({ code: "entity_not_found", message: "User not found" }, 404);
    emitWorkOSEvent(webhooks, "user.deleted", userObject(existing));
    return c.body(null, 204);
  });

  // Create an organization membership (WorkOS SDK: userManagement.createOrganizationMembership)
  app.post("/user_management/organization_memberships", async (c) => {
    const body = await c.req
      .json<{ user_id?: string; organization_id?: string; role_slug?: string }>()
      .catch(() => ({}) as { user_id?: string; organization_id?: string; role_slug?: string });
    if (!body.user_id || !body.organization_id) {
      return c.json({ code: "validation_error", message: "user_id and organization_id are required" }, 422);
    }
    if (!ws.getUser(body.user_id)) return c.json({ code: "entity_not_found", message: "User not found" }, 404);
    const org = ws.getOrg(body.organization_id);
    if (!org) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    const m = ws.insertMembership(body.user_id, body.organization_id, body.role_slug ?? "member");
    const payload = membershipObject(m, org.name);
    emitWorkOSEvent(webhooks, "organization_membership.created", payload);
    return c.json(payload, 201);
  });

  // Get single organization membership by id
  app.get("/user_management/organization_memberships/:membershipId", (c) => {
    const m = ws.getMembership(c.req.param("membershipId"));
    if (!m) return c.json({ code: "entity_not_found", message: "Membership not found" }, 404);
    return c.json(membershipObject(m, ws.getOrg(m.organization_id)?.name ?? m.organization_id));
  });

  // Delete (deactivate) an organization membership
  app.delete("/user_management/organization_memberships/:membershipId", (c) => {
    const membershipId = c.req.param("membershipId");
    // Capture the membership before deactivating so the event carries its identity.
    const existing = ws.getMembership(membershipId);
    const ok = ws.deactivateMembership(membershipId);
    if (!ok || !existing) return c.json({ code: "entity_not_found", message: "Membership not found" }, 404);
    emitWorkOSEvent(
      webhooks,
      "organization_membership.deleted",
      membershipObject(
        { ...existing, status: "inactive" },
        ws.getOrg(existing.organization_id)?.name ?? existing.organization_id,
      ),
    );
    return c.body(null, 204);
  });

  // Nested route: GET /user_management/users/:userId/organization_memberships
  app.get("/user_management/users/:userId/organization_memberships", (c) => {
    const userId = c.req.param("userId");
    const statusFilter = c.req.query("statuses[]") ?? "active";

    const memberships = ws.getUserMemberships(userId);
    const filtered = statusFilter === "active" ? memberships.filter((m) => m.status === "active") : memberships;

    const data = filtered.map((m) => ({
      ...m,
      organizationId: m.organization_id,
      organizationName: ws.getOrg(m.organization_id)?.name ?? m.organization_id,
    }));

    return c.json({ data, list_metadata: { after: null, before: null } });
  });

  // Flat list route (WorkOS SDK v8+): GET /user_management/organization_memberships?user_id=...
  app.get("/user_management/organization_memberships", (c) => {
    const userId = c.req.query("user_id");
    const statusFilter = c.req.query("statuses[]") ?? "active";

    const memberships = userId ? ws.getUserMemberships(userId) : [];
    const filtered = statusFilter === "active" ? memberships.filter((m) => m.status === "active") : memberships;

    const data = filtered.map((m) => ({
      ...m,
      organizationId: m.organization_id,
      organizationName: ws.getOrg(m.organization_id)?.name ?? m.organization_id,
    }));

    return c.json({ data, list_metadata: { after: null, before: null } });
  });
}
