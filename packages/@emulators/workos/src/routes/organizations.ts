import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";

function orgObject(o: { id: string; name: string; slug: string; created_at: string; updated_at: string }) {
  return {
    object: "organization",
    id: o.id,
    name: o.name,
    slug: o.slug,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

export function organizationRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade): void {
  // List organizations (WorkOS SDK: organizations.listOrganizations)
  app.get("/user_management/organizations", (c) => {
    return c.json({ data: ws.allOrgs().map(orgObject), list_metadata: { after: null, before: null } });
  });

  // Get single organization
  app.get("/user_management/organizations/:organizationId", (c) => {
    const org = ws.getOrg(c.req.param("organizationId"));
    if (!org) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    return c.json(orgObject(org));
  });
}
