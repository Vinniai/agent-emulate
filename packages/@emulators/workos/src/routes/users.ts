import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";

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

export function userRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade): void {
  // List users (WorkOS SDK: userManagement.listUsers) — optional ?email= filter
  app.get("/user_management/users", (c) => {
    const email = c.req.query("email");
    const users = ws.allUsers().filter((u) => (email ? u.email === email : true));
    return c.json({ data: users.map(userObject), list_metadata: { after: null, before: null } });
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
    return c.json(userObject(updated));
  });

  // Delete user
  app.delete("/user_management/users/:userId", (c) => {
    const ok = ws.deleteUser(c.req.param("userId"));
    if (!ok) return c.json({ code: "entity_not_found", message: "User not found" }, 404);
    return c.body(null, 204);
  });

  // Get single organization membership by id
  app.get("/user_management/organization_memberships/:membershipId", (c) => {
    const m = ws.getMembership(c.req.param("membershipId"));
    if (!m) return c.json({ code: "entity_not_found", message: "Membership not found" }, 404);
    return c.json({
      ...m,
      object: "organization_membership",
      organizationId: m.organization_id,
      organizationName: ws.getOrg(m.organization_id)?.name ?? m.organization_id,
    });
  });

  // Delete (deactivate) an organization membership
  app.delete("/user_management/organization_memberships/:membershipId", (c) => {
    const ok = ws.deactivateMembership(c.req.param("membershipId"));
    if (!ok) return c.json({ code: "entity_not_found", message: "Membership not found" }, 404);
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
