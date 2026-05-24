import type { ServicePlugin, Store, AppKeyResolver, AuthFallback, WebhookDispatcher } from "@emulators/core";

export interface LoadedService {
  plugin: ServicePlugin;
  seedFromConfig?(store: Store, baseUrl: string, config: unknown, webhooks?: WebhookDispatcher): void;
  createAppKeyResolver?(store: Store): AppKeyResolver;
  /**
   * Project live store state back into the editable `*SeedConfig` shape this
   * service's `seedFromConfig` consumes. The result must round-trip: feeding
   * it back through `seedFromConfig` reconstructs equivalent state. Credentials
   * are stripped unless `opts.includeCredentials` is set.
   */
  storeToSeedConfig?(store: Store, baseUrl: string, opts?: { includeCredentials?: boolean }): object;
}

export interface ServiceEntry {
  label: string;
  endpoints: string;
  load(): Promise<LoadedService>;
  defaultFallback(svcSeedConfig?: Record<string, unknown>): AuthFallback;
  initConfig: Record<string, unknown>;
}

const SERVICE_NAME_LIST = [
  "vercel",
  "github",
  "google",
  "slack",
  "apple",
  "microsoft",
  "okta",
  "aws",
  "resend",
  "stripe",
  "mongoatlas",
  "clerk",
  "workos",
  "nango",
  "simpro",
  "uptick",
] as const;
export type ServiceName = (typeof SERVICE_NAME_LIST)[number];
export const SERVICE_NAMES: readonly ServiceName[] = SERVICE_NAME_LIST;

export const SERVICE_REGISTRY: Record<ServiceName, ServiceEntry> = {
  vercel: {
    label: "Vercel REST API emulator",
    endpoints: "projects, deployments, domains, env vars, users, teams, file uploads, protection bypass",
    async load() {
      const mod = await import("@emulators/vercel");
      return { plugin: mod.vercelPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstLogin = (cfg?.users as Array<{ username?: string }> | undefined)?.[0]?.username ?? "admin";
      return { login: firstLogin, id: 1, scopes: [] };
    },
    initConfig: {
      vercel: {
        users: [{ username: "developer", name: "Developer", email: "dev@agent-emulate.dev" }],
        teams: [{ slug: "my-team", name: "My Team" }],
        projects: [{ name: "my-app", team: "my-team", framework: "nextjs" }],
        integrations: [
          {
            client_id: "oac_example_client_id",
            client_secret: "example_client_secret",
            name: "My Vercel App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/vercel"],
          },
        ],
      },
    },
  },

  github: {
    label: "GitHub REST API emulator",
    endpoints:
      "users, repos, issues, PRs, comments, reviews, labels, milestones, branches, git data, orgs, teams, releases, webhooks, search, actions, checks, rate limit",
    async load() {
      const mod = await import("@emulators/github");
      return {
        plugin: mod.githubPlugin,
        seedFromConfig: mod.seedFromConfig,
        createAppKeyResolver(store: Store): AppKeyResolver {
          return (appId: number) => {
            try {
              const gh = mod.getGitHubStore(store);
              const ghApp = gh.apps.all().find((a) => a.app_id === appId);
              if (!ghApp) return null;
              return { privateKey: ghApp.private_key, slug: ghApp.slug, name: ghApp.name };
            } catch {
              return null;
            }
          };
        },
      };
    },
    defaultFallback(cfg) {
      const firstLogin = (cfg?.users as Array<{ login?: string }> | undefined)?.[0]?.login ?? "admin";
      return { login: firstLogin, id: 1, scopes: ["repo", "user", "admin:org", "admin:repo_hook"] };
    },
    initConfig: {
      github: {
        users: [
          {
            login: "octocat",
            name: "The Octocat",
            email: "octocat@github.com",
            bio: "I am the Octocat",
            company: "GitHub",
            location: "San Francisco",
          },
        ],
        orgs: [{ login: "my-org", name: "My Organization", description: "A test organization" }],
        repos: [
          {
            owner: "octocat",
            name: "hello-world",
            description: "My first repository",
            language: "JavaScript",
            topics: ["hello", "world"],
            auto_init: true,
          },
          {
            owner: "my-org",
            name: "org-repo",
            description: "An organization repository",
            language: "TypeScript",
            auto_init: true,
          },
        ],
        oauth_apps: [
          {
            client_id: "Iv1.example_client_id",
            client_secret: "example_client_secret",
            name: "My App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/github"],
          },
        ],
      },
    },
  },

  google: {
    label: "Google OAuth 2.0 / OpenID Connect + Gmail, Calendar, and Drive emulator",
    endpoints:
      "OAuth authorize, token exchange, userinfo, OIDC discovery, token revocation, Gmail messages/drafts/threads/labels/history/settings, Calendar lists/events/freebusy, Drive files/uploads",
    async load() {
      const mod = await import("@emulators/google");
      return {
        plugin: mod.googlePlugin,
        seedFromConfig: mod.seedFromConfig,
        storeToSeedConfig: mod.storeToSeedConfig,
      };
    },
    defaultFallback(cfg) {
      const firstEmail =
        (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "testuser@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: ["openid", "email", "profile"] };
    },
    initConfig: {
      google: {
        users: [
          {
            email: "testuser@agent-emulate.dev",
            name: "Test User",
            picture: "https://lh3.googleusercontent.com/a/default-user",
            email_verified: true,
          },
        ],
        oauth_clients: [
          {
            client_id: "example-client-id.apps.googleusercontent.com",
            client_secret: "GOCSPX-example_secret",
            name: "Code App (Google)",
            redirect_uris: ["http://localhost:3000/api/auth/callback/google"],
          },
        ],
        labels: [
          {
            id: "Label_ops",
            user_email: "testuser@agent-emulate.dev",
            name: "Ops/Review",
            color_background: "#DDEEFF",
            color_text: "#111111",
          },
        ],
        messages: [
          {
            id: "msg_welcome",
            user_email: "testuser@agent-emulate.dev",
            from: "welcome@agent-emulate.dev",
            to: "testuser@agent-emulate.dev",
            subject: "Welcome to the Gmail emulator",
            body_text: "You can now test Gmail, Calendar, and Drive flows locally.",
            label_ids: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
            date: "2025-01-04T10:00:00.000Z",
          },
        ],
        calendars: [
          {
            id: "primary",
            user_email: "testuser@agent-emulate.dev",
            summary: "testuser@agent-emulate.dev",
            primary: true,
            selected: true,
            time_zone: "UTC",
          },
        ],
        calendar_events: [
          {
            id: "evt_kickoff",
            user_email: "testuser@agent-emulate.dev",
            calendar_id: "primary",
            summary: "Project Kickoff",
            start_date_time: "2025-01-10T09:00:00.000Z",
            end_date_time: "2025-01-10T09:30:00.000Z",
          },
        ],
        drive_items: [
          {
            id: "drv_docs",
            user_email: "testuser@agent-emulate.dev",
            name: "Docs",
            mime_type: "application/vnd.google-apps.folder",
            parent_ids: ["root"],
          },
        ],
      },
    },
  },

  slack: {
    label: "Slack API emulator",
    endpoints: "auth, chat, conversations, users, reactions, team, OAuth, incoming webhooks",
    async load() {
      const mod = await import("@emulators/slack");
      return { plugin: mod.slackPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "U000000001", id: 1, scopes: ["chat:write", "channels:read", "users:read", "reactions:write"] };
    },
    initConfig: {
      slack: {
        team: { name: "My Workspace", domain: "my-workspace" },
        users: [{ name: "developer", real_name: "Developer", email: "dev@agent-emulate.dev" }],
        channels: [
          { name: "general", topic: "General discussion" },
          { name: "random", topic: "Random stuff" },
        ],
        bots: [{ name: "my-bot" }],
        oauth_apps: [
          {
            client_id: "12345.67890",
            client_secret: "example_client_secret",
            name: "My Slack App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/slack"],
          },
        ],
      },
    },
  },

  apple: {
    label: "Apple Sign In / OAuth emulator",
    endpoints: "OAuth authorize, token exchange, JWKS",
    async load() {
      const mod = await import("@emulators/apple");
      return { plugin: mod.applePlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail =
        (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "testuser@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: ["openid", "email", "name"] };
    },
    initConfig: {
      apple: {
        users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
        oauth_clients: [
          {
            client_id: "com.example.app",
            team_id: "TEAM001",
            name: "My Apple App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/apple"],
          },
        ],
      },
    },
  },

  microsoft: {
    label: "Microsoft Entra ID OAuth 2.0 / OpenID Connect emulator",
    endpoints: "OAuth authorize, token exchange, userinfo, OIDC discovery, Graph /me, logout, token revocation",
    async load() {
      const mod = await import("@emulators/microsoft");
      return {
        plugin: mod.microsoftPlugin,
        seedFromConfig: mod.seedFromConfig,
        storeToSeedConfig: mod.storeToSeedConfig,
      };
    },
    defaultFallback(cfg) {
      const firstEmail =
        (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "testuser@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: ["openid", "email", "profile", "User.Read"] };
    },
    initConfig: {
      microsoft: {
        users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
        oauth_clients: [
          {
            client_id: "example-client-id",
            client_secret: "example-client-secret",
            name: "My Microsoft App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/microsoft-entra-id"],
          },
        ],
      },
    },
  },

  okta: {
    label: "Okta OAuth 2.0 / OpenID Connect + management API emulator",
    endpoints:
      "OIDC discovery, JWKS, OAuth authorize/token/userinfo/introspect/revoke/logout, users, groups, apps, authorization servers",
    async load() {
      const mod = await import("@emulators/okta");
      return { plugin: mod.oktaPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstLogin =
        (cfg?.users as Array<{ login?: string; email?: string }> | undefined)?.[0]?.login ??
        (cfg?.users as Array<{ login?: string; email?: string }> | undefined)?.[0]?.email ??
        "testuser@agent-emulate.dev";
      return { login: firstLogin, id: 1, scopes: ["openid", "profile", "email", "groups"] };
    },
    initConfig: {
      okta: {
        users: [
          {
            login: "testuser@agent-emulate.dev",
            email: "testuser@agent-emulate.dev",
            first_name: "Test",
            last_name: "User",
          },
        ],
        groups: [{ name: "Everyone", description: "All users", type: "BUILT_IN", okta_id: "00g_everyone" }],
        authorization_servers: [{ id: "default", name: "default", audiences: ["api://default"] }],
        oauth_clients: [
          {
            client_id: "okta-test-client",
            client_secret: "okta-test-secret",
            name: "Sample OIDC Client",
            redirect_uris: ["http://localhost:3000/callback"],
            auth_server_id: "default",
          },
        ],
      },
    },
  },

  aws: {
    label: "AWS cloud service emulator",
    endpoints:
      "S3 (buckets, objects), SQS (queues, messages), IAM (users, roles, access keys), STS (assume role, caller identity)",
    async load() {
      const mod = await import("@emulators/aws");
      return { plugin: mod.awsPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "admin", id: 1, scopes: ["s3:*", "sqs:*", "iam:*", "sts:*"] };
    },
    initConfig: {
      aws: {
        region: "us-east-1",
        s3: { buckets: [{ name: "my-app-bucket" }, { name: "my-app-uploads" }] },
        sqs: { queues: [{ name: "my-app-events" }, { name: "my-app-dlq" }] },
        iam: {
          users: [{ user_name: "developer", create_access_key: true }],
          roles: [{ role_name: "lambda-execution-role", description: "Role for Lambda function execution" }],
        },
      },
    },
  },
  resend: {
    label: "Resend email API emulator",
    endpoints: "emails, domains, contacts, API keys, inbox UI",
    async load() {
      const mod = await import("@emulators/resend");
      return { plugin: mod.resendPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "re_test_admin", id: 1, scopes: [] };
    },
    initConfig: {
      resend: {
        domains: [{ name: "agent-emulate.dev", region: "us-east-1" }],
        contacts: [{ email: "test@agent-emulate.dev", first_name: "Test", last_name: "User" }],
      },
    },
  },
  stripe: {
    label: "Stripe payments emulator",
    endpoints:
      "customers, payment methods, customer sessions, payment intents, charges, products, prices, checkout sessions, webhooks",
    async load() {
      const mod = await import("@emulators/stripe");
      return { plugin: mod.stripePlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "sk_test_admin", id: 1, scopes: [] };
    },
    initConfig: {
      stripe: {
        customers: [{ email: "test@agent-emulate.dev", name: "Test Customer" }],
        products: [{ name: "Pro Plan", description: "Monthly pro subscription" }],
        prices: [{ product_name: "Pro Plan", currency: "usd", unit_amount: 2000 }],
      },
    },
  },
  mongoatlas: {
    label: "MongoDB Atlas service emulator",
    endpoints:
      "Atlas Admin API v2 (projects, clusters, database users, databases, collections), Atlas Data API v1 (findOne, find, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany, aggregate)",
    async load() {
      const mod = await import("@emulators/mongoatlas");
      return { plugin: mod.mongoatlasPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "admin", id: 1, scopes: [] };
    },
    initConfig: {
      mongoatlas: {
        projects: [{ name: "Project0" }],
        clusters: [{ name: "Cluster0", project: "Project0" }],
        database_users: [{ username: "admin", project: "Project0" }],
        databases: [{ cluster: "Cluster0", name: "test", collections: ["items"] }],
      },
    },
  },
  clerk: {
    label: "Clerk authentication and user management emulator",
    endpoints:
      "OIDC discovery, JWKS, OAuth authorize/token/userinfo, users, email addresses, organizations, memberships, invitations, sessions",
    async load() {
      const mod = await import("@emulators/clerk");
      return { plugin: mod.clerkPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail =
        (cfg?.users as Array<{ email_addresses?: string[] }> | undefined)?.[0]?.email_addresses?.[0] ??
        "test@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: [] };
    },
    initConfig: {
      clerk: {
        users: [
          {
            first_name: "Test",
            last_name: "User",
            email_addresses: ["test@agent-emulate.dev"],
            password: "clerk_test_password",
          },
        ],
        organizations: [
          {
            name: "My Company",
            slug: "my-company",
            members: [{ email: "test@agent-emulate.dev", role: "admin" }],
          },
        ],
        oauth_applications: [
          {
            client_id: "clerk_emulate_client",
            client_secret: "clerk_emulate_secret",
            name: "Emulate App",
            redirect_uris: ["http://localhost:3000/api/auth/callback/clerk"],
          },
        ],
      },
    },
  },

  workos: {
    label: "WorkOS User Management emulator",
    endpoints:
      "OAuth 2.0/OIDC authorize, token exchange (code/password/org-selection/refresh), JWKS, organization memberships, session revocation, invitations, webhook simulation",
    async load() {
      const mod = await import("@emulators/workos");
      return { plugin: mod.workosPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "test@agent-emulate.dev";
      return { login: firstEmail, id: 1, scopes: [] };
    },
    initConfig: {
      workos: {
        users: [
          {
            id: "user_dev",
            email: "test@agent-emulate.dev",
            first_name: "Test",
            last_name: "User",
            password: "TestPassword123!",
          },
        ],
        organizations: [{ id: "org_dev", name: "My Company", slug: "my-company" }],
        memberships: [{ user_email: "test@agent-emulate.dev", organization_slug: "my-company", role: "owner" }],
        oauth_clients: [
          {
            client_id: "client_emulate_01",
            client_secret: "sk_emulate_secret",
            name: "Emulate App",
            redirect_uris: ["http://localhost:3000/callback"],
          },
        ],
      },
    },
  },

  nango: {
    label: "Nango integration platform emulator",
    endpoints:
      "connections (get/list/create/metadata), connect sessions (create/reconnect), proxy (QuickBooks /v3/company/:id/query, Xero /api.xro/2.0/*, MYOB, generic)",
    async load() {
      const mod = await import("@emulators/nango");
      return { plugin: mod.nangoPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "nango-emulator", id: 1, scopes: [] };
    },
    initConfig: {
      nango: {
        connections: [
          {
            id: "xero-demo",
            provider: "xero",
            provider_config_key: "xero",
            metadata: { activeTenantId: "demo-tenant-xero-001" },
            records: {
              Invoice: [
                {
                  id: "INV-001",
                  InvoiceNumber: "INV-001",
                  Total: 1100.0,
                  AmountDue: 1100.0,
                  Status: "AUTHORISED",
                  DateString: "2024-01-15",
                  DueDateString: "2024-02-15",
                  Contact: { ContactID: "CONTACT-001", Name: "Demo Customer" },
                },
              ],
              Contact: [{ id: "CONTACT-001", Name: "Demo Customer", EmailAddress: "customer@agent-emulate.dev" }],
            },
          },
          {
            id: "quickbooks-demo",
            provider: "quickbooks",
            provider_config_key: "quickbooks-sandbox",
            connection_config: { realmId: "sandbox-realm-001" },
            records: {
              Invoice: [
                {
                  Id: "1",
                  DocNumber: "1001",
                  TotalAmt: 550.0,
                  Balance: 550.0,
                  TxnDate: "2024-01-10",
                  DueDate: "2024-02-10",
                  CustomerRef: { value: "1", name: "Test Customer" },
                },
              ],
              Customer: [
                {
                  Id: "1",
                  DisplayName: "Test Customer",
                  PrimaryEmailAddr: { Address: "customer@agent-emulate.dev" },
                },
              ],
            },
          },
        ],
      },
    },
  },

  simpro: {
    label: "SimPRO field service management API emulator",
    endpoints:
      "customers, sites, jobs (sections/cost centres), quotes (convert to job), invoices, " +
      "staff, contractors, schedules, assets, cost centres, labour rates, " +
      "tax codes, catalogue, statuses, zones, custom fields, webhooks",
    async load() {
      const mod = await import("@emulators/simpro");
      return { plugin: mod.simproPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "sk_test_simpro", id: 1, scopes: [] };
    },
    initConfig: {
      simpro: {
        customers: [
          {
            type: "Company",
            company_name: "Demo Building Services",
            email: "accounts@agent-emulate.dev",
            mail_suburb: "Melbourne",
            mail_state: "VIC",
          },
        ],
        staff: [
          {
            given_name: "Demo",
            family_name: "Tech",
            email: "tech@agent-emulate.dev",
            role_name: "Technician",
          },
        ],
        jobs: [
          {
            order_no: "J-2025-001",
            description: "Annual Fire Inspection",
            customer_name: "Demo Building Services",
            stage: "Progress",
            total_ex_tax: 500,
            total_inc_tax: 550,
          },
        ],
        cost_centers: [{ name: "General" }, { name: "Fire Safety" }],
        tax_codes: [
          { name: "GST", rate: 10, description: "Goods and Services Tax" },
          { name: "GST Free", rate: 0, description: "GST exempt" },
        ],
        labor_rates: [
          { name: "Standard", rate: 95 },
          { name: "After Hours", rate: 142.5 },
        ],
      },
    },
  },

  uptick: {
    label: "Uptick fire protection field service API emulator",
    endpoints: "clients, properties, assets, defects, asset types, users, oauth2 token",
    async load() {
      const mod = await import("@emulators/uptick");
      return { plugin: mod.uptickPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "sk_test_uptick", id: 1, scopes: [] };
    },
    initConfig: {
      uptick: {
        clients: [
          {
            name: "Demo Property Group",
            contact_email: "admin@agent-emulate.dev",
            contact_name: "Demo Admin",
          },
        ],
        properties: [
          {
            name: "Demo Building A",
            client_name: "Demo Property Group",
            address_city: "Melbourne",
            address_state: "VIC",
          },
        ],
        assets: [
          {
            name: "Fire Hose Reel 01",
            property_name: "Demo Building A",
            client_name: "Demo Property Group",
            asset_type_name: "Fire Hose Reel",
          },
        ],
        asset_types: [{ name: "Fire Hose Reel" }, { name: "Fire Extinguisher" }, { name: "Fire Panel" }],
        users: [
          {
            username: "tech1",
            email: "tech@agent-emulate.dev",
            first_name: "Demo",
            last_name: "Tech",
          },
        ],
      },
    },
  },
};

export const DEFAULT_TOKENS = {
  tokens: {
    test_token_admin: {
      login: "admin",
      scopes: ["repo", "user", "admin:org", "admin:repo_hook"],
    },
    test_token_user1: {
      login: "octocat",
      scopes: ["repo", "user"],
    },
  },
};
