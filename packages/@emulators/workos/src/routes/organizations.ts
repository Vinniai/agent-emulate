import type { AppEnv, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";
import { emitWorkOSEvent } from "./events.js";

function orgObject(o: { id: string; name: string; slug: string; created_at: string; updated_at: string }) {
  return {
    object: "organization",
    id: o.id,
    name: o.name,
    slug: o.slug,
    // WorkOS always returns a domains array; the SDK's deserializeOrganization
    // does `organization.domains.map(...)`, so omitting it throws
    // "Cannot read properties of undefined (reading 'map')" in callers.
    allow_profiles_outside_organization: false,
    domains: [] as unknown[],
    created_at: o.created_at,
    updated_at: o.updated_at,
    metadata: {},
  };
}

/**
 * WorkOS Organizations API.
 *
 * The WorkOS Node SDK's `workos.organizations.*` methods (createOrganization,
 * listOrganizations, getOrganization, updateOrganization, deleteOrganization)
 * all target the TOP-LEVEL `/organizations` path — not `/user_management/*`.
 * We register the top-level surface as the source of truth and keep the legacy
 * `/user_management/organizations` GET as a deprecated read-only alias for
 * back-compat with anything that hit the old path.
 */
export function organizationRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade, webhooks: WebhookDispatcher): void {
  // List organizations (SDK: organizations.listOrganizations)
  app.get("/organizations", (c) => {
    return c.json({
      object: "list",
      data: ws.allOrgs().map(orgObject),
      list_metadata: { after: null, before: null },
    });
  });

  // Create organization (SDK: organizations.createOrganization)
  app.post("/organizations", async (c) => {
    const body = await c.req.json<{ name?: string; domain_data?: unknown[] }>().catch(() => ({}) as { name?: string });
    if (!body.name) return c.json({ code: "validation_error", message: "name is required" }, 422);
    const org = ws.insertOrganization({ name: body.name });
    const payload = orgObject(org);
    emitWorkOSEvent(webhooks, "organization.created", payload);
    return c.json(payload, 201);
  });

  // Get single organization (SDK: organizations.getOrganization)
  app.get("/organizations/:organizationId", (c) => {
    const org = ws.getOrg(c.req.param("organizationId"));
    if (!org) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    return c.json(orgObject(org));
  });

  // Update organization (SDK: organizations.updateOrganization)
  app.put("/organizations/:organizationId", async (c) => {
    const id = c.req.param("organizationId");
    const body = await c.req.json<{ name?: string; domain_data?: unknown[] }>().catch(() => ({}) as { name?: string });
    const org = ws.updateOrganization(id, body.name ? { name: body.name } : {});
    if (!org) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    const payload = orgObject(org);
    emitWorkOSEvent(webhooks, "organization.updated", payload);
    return c.json(payload);
  });

  // Delete organization (SDK: organizations.deleteOrganization)
  app.delete("/organizations/:organizationId", (c) => {
    const id = c.req.param("organizationId");
    const existing = ws.getOrg(id);
    if (!existing) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    ws.deleteOrganization(id);
    emitWorkOSEvent(webhooks, "organization.deleted", orgObject(existing));
    return c.body(null, 204);
  });

  // Deprecated alias: organizations were briefly mounted under user_management,
  // which is not a real WorkOS path. Kept read-only for back-compat.
  app.get("/user_management/organizations", (c) => {
    return c.json({
      data: ws.allOrgs().map(orgObject),
      list_metadata: { after: null, before: null },
    });
  });

  // Deprecated alias for the old create path.
  app.post("/user_management/organizations", async (c) => {
    const body = await c.req.json<{ name?: string; domain_data?: unknown[] }>().catch(() => ({}) as { name?: string });
    if (!body.name) return c.json({ code: "validation_error", message: "name is required" }, 422);
    const org = ws.insertOrganization({ name: body.name });
    const payload = orgObject(org);
    emitWorkOSEvent(webhooks, "organization.created", payload);
    return c.json(payload, 201);
  });

  // Deprecated alias for the old single-org read path.
  app.get("/user_management/organizations/:organizationId", (c) => {
    const org = ws.getOrg(c.req.param("organizationId"));
    if (!org) return c.json({ code: "entity_not_found", message: "Organization not found" }, 404);
    return c.json(orgObject(org));
  });
}
