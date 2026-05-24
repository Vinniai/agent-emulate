import { requireAuthWhen } from "@emulators/core";
import type { AppEnv, ServicePlugin, Store, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "hono";
import { discoveryRoutes } from "./routes/discovery.js";
import { invitationRoutes } from "./routes/invitations.js";
import { oauthRoutes } from "./routes/oauth.js";
import { organizationRoutes } from "./routes/organizations.js";
import { sessionRoutes } from "./routes/sessions.js";
import { userRoutes } from "./routes/users.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { getWorkOSStore } from "./store.js";

export type { WorkOSStoreFacade } from "./store.js";
export { getWorkOSStore } from "./store.js";

export interface WorkOSSeedConfig {
  users?: Array<{
    id?: string;
    email: string;
    first_name?: string;
    last_name?: string;
    password?: string;
    profile_picture_url?: string;
    email_verified?: boolean;
  }>;
  organizations?: Array<{
    id?: string;
    name: string;
    slug?: string;
  }>;
  memberships?: Array<{
    user_email: string;
    organization_slug: string;
    role?: string;
  }>;
  oauth_clients?: Array<{
    client_id: string;
    client_secret?: string;
    name?: string;
    redirect_uris?: string[];
  }>;
  webhook_target?: string;
}

export function seedFromConfig(store: Store, _baseUrl: string, config: WorkOSSeedConfig): void {
  const ws = getWorkOSStore(store);

  for (const client of config.oauth_clients ?? []) {
    ws.insertOAuthClient({
      client_id: client.client_id,
      client_secret: client.client_secret,
      name: client.name ?? "Default App",
      redirect_uris: client.redirect_uris ?? ["http://localhost:3000/callback"],
    });
  }

  for (const org of config.organizations ?? []) {
    ws.insertOrganization({ id: org.id, name: org.name, slug: org.slug });
  }

  for (const user of config.users ?? []) {
    ws.insertUser({
      id: user.id,
      email: user.email,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      password: user.password,
      profile_picture_url: user.profile_picture_url ?? null,
      email_verified: user.email_verified,
    });
  }

  for (const m of config.memberships ?? []) {
    const user = ws.findUserByEmail(m.user_email);
    const org = ws.findOrgBySlug(m.organization_slug);
    if (user && org) {
      ws.insertMembership(user.id, org.id, m.role ?? "member");
    } else {
      console.warn(
        `[workos-emulator] Skipping membership: user=${m.user_email} org=${m.organization_slug} — not found`,
      );
    }
  }
}

/**
 * Inverse of {@link seedFromConfig}: snapshot the live WorkOS store back into a
 * seed config so a fresh store can be re-seeded to an identical state. Used by
 * the export round-trip (mirrors simpro/uptick `storeToSeedConfig`).
 */
export function storeToSeedConfig(store: Store, _baseUrl: string): WorkOSSeedConfig {
  const ws = getWorkOSStore(store);
  const orgsById = new Map(ws.allOrgs().map((o) => [o.id, o]));
  const usersById = new Map(ws.allUsers().map((u) => [u.id, u]));

  return {
    oauth_clients: ws.allOAuthClients().map((c) => ({
      client_id: c.client_id,
      client_secret: c.client_secret,
      name: c.name,
      redirect_uris: c.redirect_uris,
    })),
    organizations: ws.allOrgs().map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    users: ws.allUsers().map((u) => ({
      id: u.id,
      email: u.email,
      first_name: u.first_name ?? undefined,
      last_name: u.last_name ?? undefined,
      password: u.password,
      profile_picture_url: u.profile_picture_url ?? undefined,
      email_verified: u.email_verified,
    })),
    memberships: ws
      .allMemberships()
      .filter((m) => m.status === "active")
      .flatMap((m) => {
        const user = usersById.get(m.user_id);
        const org = orgsById.get(m.organization_id);
        if (!user || !org) return [];
        return [{ user_email: user.email, organization_slug: org.slug, role: m.role.slug }];
      }),
  };
}

export const workosPlugin: ServicePlugin = {
  name: "workos",

  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string): void {
    const ws = getWorkOSStore(store);

    app.get("/health", (c) => c.json({ ok: true }));

    inspectorRoutes({ app, store, webhooks, baseUrl });
    discoveryRoutes(app, baseUrl);
    oauthRoutes(app, ws, baseUrl);
    // Opt-in: real WorkOS rejects management API calls without a token.
    // `authorize`/`authenticate` (registered above) and discovery/JWKS/health
    // stay open so a token can still be obtained; only the management
    // surface below is gated. Off by default so smoke tests/demos are green.
    app.use("/user_management/*", requireAuthWhen("EMULATE_WORKOS_REQUIRE_AUTH", "EMULATE_REQUIRE_AUTH"));
    userRoutes(app, ws, webhooks);
    organizationRoutes(app, ws, webhooks);
    sessionRoutes(app, ws);
    invitationRoutes(app, ws, webhooks);
    webhookRoutes(app);
  },

  seed(store: Store, _baseUrl: string): void {
    const ws = getWorkOSStore(store);
    // Default seed — single dev user so first-run works without config
    const user = ws.insertUser({
      id: "user_test_dev",
      email: "dev@agent-emulate.dev",
      first_name: "Dev",
      last_name: "User",
      password: "DevPassword123!",
    });
    const org = ws.insertOrganization({
      id: "org_test_taskr",
      name: "Taskr Dev",
      slug: "taskr-dev",
    });
    ws.insertMembership(user.id, org.id, "owner");
    ws.insertOAuthClient({
      client_id: "client_test_01",
      client_secret: "sk_test_secret",
      name: "Taskr Local",
      redirect_uris: ["http://localhost:3000/callback", "taskr://auth/callback"],
    });
  },
};
