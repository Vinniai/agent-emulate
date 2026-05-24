// Generator for the standalone "direct to source" emulator packages.
//
//   Phase 1  — extract the 5 native-logic route files that live inside the
//              nango package into proper standalone @emulators/* packages
//              (nango itself is left untouched: routes are COPIED, the
//              "/<x>-emu" path prefix stripped so they serve real native
//              paths at the package root).
//   Phase 2  — every other provider in examples/nango-seeds.yaml that has no
//              standalone package yet gets one, driven by @emulators/native-kit
//              from its seed slice.
//
// Idempotent: rewrites generated files in place. Run: node tools/gen-standalone.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import YAML from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKGDIR = join(ROOT, "packages", "@emulators");
const SEEDS = join(ROOT, "examples", "nango-seeds.yaml");

const w = (p, s) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s.endsWith("\n") ? s : s + "\n");
};

// ---------------------------------------------------------------------------
// Shared scaffold (package.json / tsconfig / tsup / vitest / README)
// ---------------------------------------------------------------------------
function scaffold(name, { description, extraDeps = {} }) {
  const dir = join(PKGDIR, name);
  w(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@emulators/${name}`,
        version: "0.5.0",
        license: "Apache-2.0",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
        homepage: "https://github.com/Vinniai/agent-emulate",
        repository: {
          type: "git",
          url: "https://github.com/Vinniai/agent-emulate.git",
          directory: `packages/@emulators/${name}`,
        },
        bugs: { url: "https://github.com/Vinniai/agent-emulate/issues" },
        publishConfig: { access: "public" },
        files: ["dist"],
        scripts: {
          build: "tsup --clean",
          dev: "tsup --watch",
          test: "vitest run --passWithNoTests",
          clean: "rm -rf dist .turbo",
          "type-check": "tsc --noEmit",
          lint: "eslint src",
        },
        dependencies: { "@emulators/core": "workspace:*", hono: "^4", ...extraDeps },
        devDependencies: { tsup: "^8", typescript: "^5.7", vitest: "^4.1.0" },
      },
      null,
      2,
    ),
  );
  w(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../../tsconfig.json",
        compilerOptions: { outDir: "./dist", rootDir: "./src" },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );
  w(
    join(dir, "tsup.config.ts"),
    `import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Some emulate packages render HTML (OAuth consent) via @emulators/core's
// shared Geist fonts; tsup inlines core's font loader, so copy the fonts
// alongside the bundle. Harmless for API-only packages.
const copyFonts = async () => {
  const src = resolve(__dirname, "../core/src/fonts");
  const dest = resolve(__dirname, "dist/fonts");
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  noExternal: [/^@emulators\\/(core|native-kit)/],
  onSuccess: copyFonts,
});
`,
  );
  w(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";

export default defineConfig({ test: { globals: true } });
`,
  );
  w(
    join(dir, "README.md"),
    `# @emulators/${name}

${description}

A **standalone, direct-to-source** emulator: mount it on its own and clients
speak this provider's real native API directly — no Nango connection /
records / proxy envelope. The Nango emulator remains an alternative path; this
package is the "go direct" option.

\`\`\`ts
import { createServer } from "@emulators/core";
import { ${camel(name)}Plugin } from "@emulators/${name}";

const { app } = createServer(${camel(name)}Plugin, { baseUrl: "http://localhost:4000" });
\`\`\`
`,
  );
}

const camel = (s) => s.replace(/[-_](.)/g, (_, c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Phase 1 — extract native-logic routes from the nango package
// ---------------------------------------------------------------------------
const NANGO_ROUTES = join(PKGDIR, "nango", "src", "routes");

function stripPrefix(src, prefix) {
  // "/xero-emu/..." → "/...", `${base}` definitions → ""
  return src
    .replaceAll(`"${prefix}"`, `""`)
    .replaceAll(prefix, "")
    .replace(/const base = ""\s*;/g, 'const base = "";')
    .replace(/`\$\{origin\(c\)\}/g, "`${origin(c)}");
}

// Vendored, trimmed copy of nango's provider-webhook helper so xero /
// quickbooks deliver their own signed webhooks standalone (nango untouched).
const VENDORED_WEBHOOKS = `import { createHmac } from "node:crypto";
import type { AppEnv, Store } from "@emulators/core";
import type { Hono } from "hono";

const SETTINGS_KEY = "webhook.settings";
const DELIVERIES_KEY = "webhook.deliveries";
const MAX_DELIVERIES = 1000;

export interface WebhookSettings {
  url: string | null;
  secret?: string;
}
export interface ProviderWebhookDelivery {
  id: number;
  event: "provider";
  url: string;
  status_code: number | null;
  success: boolean;
  signature: string | null;
  payload: unknown;
  delivered_at: string;
}

export function signBodyBase64(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

export function getWebhookSettings(store: Store): WebhookSettings {
  return store.getData<WebhookSettings>(SETTINGS_KEY) ?? { url: null };
}
export function setWebhookSettings(store: Store, patch: { url?: string | null; secret?: string }): WebhookSettings {
  const cur = getWebhookSettings(store);
  const next: WebhookSettings = {
    url: patch.url !== undefined ? patch.url : cur.url,
    secret: patch.secret !== undefined ? patch.secret : cur.secret,
  };
  store.setData(SETTINGS_KEY, next);
  return next;
}
export function getDeliveries(store: Store): ProviderWebhookDelivery[] {
  return store.getData<ProviderWebhookDelivery[]>(DELIVERIES_KEY) ?? [];
}
function recordDelivery(store: Store, d: ProviderWebhookDelivery): void {
  const all = getDeliveries(store);
  all.push(d);
  if (all.length > MAX_DELIVERIES) all.splice(0, all.length - MAX_DELIVERIES);
  store.setData(DELIVERIES_KEY, all);
}

/** Deliver a provider-native webhook (own payload + signature header). */
export async function dispatchProviderWebhook(
  store: Store,
  opts: { signatureHeader: string; payload: unknown },
): Promise<void> {
  const settings = getWebhookSettings(store);
  if (!settings.url) return;
  const body = JSON.stringify(opts.payload);
  const signature = settings.secret ? signBodyBase64(settings.secret, body) : null;
  const delivery: ProviderWebhookDelivery = {
    id: getDeliveries(store).length + 1,
    event: "provider",
    url: settings.url,
    status_code: null,
    success: false,
    signature,
    payload: opts.payload,
    delivered_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(settings.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature ? { [opts.signatureHeader]: signature } : {}) },
      body,
      signal: AbortSignal.timeout(10000),
    });
    delivery.status_code = res.status;
    delivery.success = res.ok;
  } catch {
    delivery.success = false;
  }
  recordDelivery(store, delivery);
}

/** /webhook-settings + /webhook-deliveries — register a destination + inspect. */
export function webhookRoutes(app: Hono<AppEnv>, store: Store): void {
  const view = () => {
    const s = getWebhookSettings(store);
    return { url: s.url, hasSecret: !!s.secret };
  };
  app.get("/webhook-settings", (c) => c.json(view()));
  app.post("/webhook-settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string | null; secret?: string };
    setWebhookSettings(store, { url: body.url, secret: body.secret });
    return c.json(view());
  });
  app.get("/webhook-deliveries", (c) => c.json({ deliveries: getDeliveries(store) }));
}
`;

const PHASE1 = [
  {
    name: "xero",
    description:
      "Direct Xero Accounting — OAuth2, tenants, stateful Invoices, and Xero's own signed `events[]` webhook.",
    routeFiles: ["direct-xero"],
    fns: ["directXeroRoutes"],
    prefixes: ["/xero-emu"],
    webhooks: true,
  },
  {
    name: "quickbooks",
    description:
      "Direct QuickBooks Online — OAuth2, stateful invoices, SQL-ish query, and QuickBooks' own signed `eventNotifications[]` webhook.",
    routeFiles: ["direct-quickbooks"],
    fns: ["directQuickbooksRoutes"],
    prefixes: ["/quickbooks-emu"],
    webhooks: true,
  },
  {
    name: "salesforce",
    description:
      "Direct Salesforce — OAuth2 (password/code/refresh), sObjects CRUD, SOQL query, composite create, describe.",
    routeFiles: ["direct-salesforce"],
    fns: ["directSalesforceRoutes"],
    prefixes: ["/salesforce-emu"],
  },
  {
    name: "hubspot",
    description:
      "Direct HubSpot — OAuth2 + token introspection and the CRM v3/v4 object API (CRUD, search, batch, associations).",
    routeFiles: ["direct-hubspot", "direct-hubspot-crm"],
    fns: ["directHubspotRoutes", "directHubspotCrmRoutes"],
    prefixes: ["/hubspot-emu"],
  },
];

function genPhase1() {
  for (const p of PHASE1) {
    scaffold(p.name, { description: p.description });
    const dir = join(PKGDIR, p.name, "src");
    const imports = [];
    const calls = [];
    if (p.webhooks) {
      w(join(dir, "webhooks.ts"), VENDORED_WEBHOOKS);
      imports.push(`import { webhookRoutes } from "./webhooks.js";`);
      calls.push(`    webhookRoutes(app, store);`);
    }
    for (let i = 0; i < p.routeFiles.length; i++) {
      const rf = p.routeFiles[i];
      let src = readFileSync(join(NANGO_ROUTES, `${rf}.ts`), "utf8");
      for (const pre of p.prefixes) src = stripPrefix(src, pre);
      // The standalone build lives in this package, not nango; relax the
      // header comment's "mounted under the nango plugin" framing.
      src = src.replace(/^\/\/ Direct .*/m, `// Direct ${p.name} native routes — standalone (extracted from the nango`);
      w(join(dir, "routes", `${rf}.ts`), src);
      imports.push(`import { ${p.fns[i]} } from "./routes/${rf}.js";`);
      calls.push(`    ${p.fns[i]}(app, store);`);
    }
    w(
      join(dir, "index.ts"),
      `import type { AppEnv, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import type { Hono } from "hono";
${imports.join("\n")}

// Standalone direct-to-source ${p.name} emulator. The route logic is the same
// native surface the nango package exposes under "/${p.name}-emu", but here it
// is served at the package root — clients hit the provider's real paths with
// no Nango envelope. Nango is left entirely untouched (this is a copy).

export const ${camel(p.name)}Plugin: ServicePlugin = {
  name: "${p.name}",
  register(app: Hono<AppEnv>, store: Store, _webhooks: WebhookDispatcher, _baseUrl: string, _tokenMap?: TokenMap): void {
${calls.join("\n")}
  },
  seed(_store: Store, _baseUrl: string): void {
    // Native state is created on demand by writes; no default fixtures.
  },
};

export default ${camel(p.name)}Plugin;
`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — every remaining seed provider, via @emulators/native-kit
// ---------------------------------------------------------------------------

// Packages that already exist independently of this generator — never (re)gen
// or collide with these. (Phase 1's xero/quickbooks/salesforce/hubspot plus
// the original standalone emulators and infra packages.)
const PREEXISTING = new Set([
  "apple",
  "aws",
  "clerk",
  "core",
  "github",
  "google",
  "microsoft",
  "mongoatlas",
  "nango",
  "okta",
  "resend",
  "simpro",
  "simulator",
  "slack",
  "stripe",
  "uptick",
  "vercel",
  "workos",
  "adapter-next",
  "xero",
  "quickbooks",
  "salesforce",
  "hubspot",
]);

// Seed providers that map onto an already-existing standalone package — skip.
const SKIP = new Set([
  "salesforce",
  "github",
  "gmail", // → @emulators/google
  "google-calendar", // → @emulators/google
  "microsoft-teams", // → @emulators/microsoft
  "outlook-calendar", // → @emulators/microsoft
]);

// Provider id → response dialect (list-envelope + error-shape + pagination)
// so the provider's real SDK strict-parses the standalone emulator. Providers
// absent here keep native-kit's historical `{ data, total, model }` default.
const DIALECTS = {
  jira: "jira",
  zendesk: "zendesk",
  shopify: "shopify",
};

// Provider id → OAuth token path (real-world-ish), best effort.
const TOKEN_PATH = {
  salesforce: "/services/oauth2/token",
  shopify: "/admin/oauth/access_token",
  zoho: "/oauth/v2/token",
  "zoho-crm": "/oauth/v2/token",
};

// Authoritative native REST collection paths, per provider/model, from each
// vendor's public API docs. This is the source of truth for path fidelity —
// it wins over any heuristic. Providers/models absent here fall back to a
// row's *API self-link* (not its human-facing URL) and finally to a clean
// pluralised path. GraphQL-only products (linear, monday, wave) have no REST
// collection; the clean fallback is used and is fine for an emulator.
const PATH_OVERRIDES = {
  pipedrive: { Person: "/v1/persons", Deal: "/v1/deals" },
  "zoho-crm": { Leads: "/crm/v3/Leads" },
  freshbooks: { Invoice: "/accounting/account/ACME/invoices/invoices" },
  discord: { Channel: "/api/v10/channels", Message: "/api/v10/channels/CHANNEL/messages" },
  mailchimp: { Member: "/3.0/lists/LIST/members", Campaign: "/3.0/campaigns" },
  sendgrid: { Contact: "/v3/marketing/contacts" },
  klaviyo: { Profile: "/api/profiles" },
  dropbox: { File: "/2/files" },
  box: { File: "/2.0/files" },
  jira: { Issue: "/rest/api/3/issue", Project: "/rest/api/3/project" },
  asana: { Task: "/api/1.0/tasks" },
  notion: { Page: "/v1/pages", Database: "/v1/databases" },
  clickup: { Task: "/api/v2/task" },
  trello: { Card: "/1/cards", Board: "/1/boards" },
  gitlab: { Project: "/api/v4/projects", Issue: "/api/v4/issues" },
  zendesk: { Ticket: "/api/v2/tickets", User: "/api/v2/users" },
  intercom: { Contact: "/contacts", Conversation: "/conversations" },
  bamboohr: { Employee: "/api/v1/employees" },
  greenhouse: { Candidate: "/v1/candidates", Job: "/v1/jobs" },
  lever: { Opportunity: "/v1/opportunities" },
  shopify: { Product: "/admin/api/2024-01/products", Order: "/admin/api/2024-01/orders" },
  mixpanel: { Event: "/api/2.0/events" },
  typeform: { Form: "/forms", Response: "/forms/FORM/responses" },
  airtable: { Record: "/v0/BASE/Records" },
  calendly: { ScheduledEvent: "/scheduled_events" },
};

// Pluralise a model name for the clean fallback collection path. Handles the
// cases the old `${model}s` got wrong (Leads→leadss, Opportunity→opportunitys).
function pluralize(model) {
  const s = model.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(s)) return /s$/.test(s) ? s : `${s}es`;
  if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
}

// Strip a trailing /<id> off a seed row's API self-link to get the collection.
function collectionFromUrl(u) {
  try {
    const path = u.startsWith("http") ? new URL(u).pathname : u;
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 1) parts.pop();
    return "/" + parts.join("/");
  } catch {
    return null;
  }
}

function pickIdField(row) {
  for (const f of ["id", "Id", "uuid", "gid", "key", "contact_id", "message_id"]) {
    if (f in row) return f;
  }
  return "id";
}

// Only true *API self-links* are usable as a collection path. `url`,
// `html_url`, `web_url`, `permalink`, `archive_url`, `public_url` are
// human-facing browser URLs (trello.com/c/…, mailchi.mp/acme/…) and must
// never drive an API path — they produced the /acme, /c/… garbage.
function apiSelfLinkOf(row) {
  const meta = row?._metadata;
  if (meta && typeof meta === "object") {
    for (const f of ["self", "url"]) {
      const v = meta[f];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  const v = row?.self;
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Resolve the native collection path: explicit override → API self-link →
// clean pluralised fallback.
function collectionPathFor(provider, model, firstRow) {
  const ov = PATH_OVERRIDES[provider]?.[model];
  if (ov) return ov;
  const link = apiSelfLinkOf(firstRow);
  return (link && collectionFromUrl(link)) || `/${pluralize(model)}`;
}

function genPhase2() {
  const doc = YAML.parse(readFileSync(SEEDS, "utf8"));
  const conns = doc?.nango?.connections ?? [];
  const built = [];
  for (const conn of conns) {
    const provider = conn.provider;
    if (!provider || SKIP.has(provider) || PREEXISTING.has(provider)) continue;
    const models = [];
    for (const [model, rows] of Object.entries(conn.records ?? {})) {
      const arr = Array.isArray(rows) ? rows : [];
      if (arr.length === 0) continue;
      const idField = pickIdField(arr[0]);
      const collectionPath = collectionPathFor(provider, model, arr[0]);
      models.push({ model, collectionPath, idField, rows: arr });
    }
    if (models.length === 0) continue;

    const spec = {
      name: provider,
      tokenPath: TOKEN_PATH[provider] ?? "/oauth/token",
      tokenPrefix: provider.replace(/[^a-z0-9]/gi, "").slice(0, 4),
      connectionConfig: conn.connection_config ?? {},
      ...(DIALECTS[provider] ? { dialect: DIALECTS[provider] } : {}),
      models,
    };
    scaffold(provider, {
      description: `Direct ${provider} — native REST surface (OAuth2 token + ${models
        .map((m) => m.model)
        .join(", ")}) driven by @emulators/native-kit from the SDK-aligned seed.`,
      extraDeps: { "@emulators/native-kit": "workspace:*" },
    });
    const dir = join(PKGDIR, provider, "src");
    w(
      join(dir, "spec.ts"),
      `import type { NativeSpec } from "@emulators/native-kit";

// Derived from examples/nango-seeds.yaml — the SDK-aligned seed slice for
// "${provider}", with each model's native collection path inferred from the
// seed rows' own url/self field. Regenerate via: node tools/gen-standalone.mjs
export const spec: NativeSpec = ${JSON.stringify(spec, null, 2)};
`,
    );
    w(
      join(dir, "index.ts"),
      `import { makeNativePlugin } from "@emulators/native-kit";
import { spec } from "./spec.js";

// Standalone direct-to-source ${provider} emulator. Mount it and clients hit
// ${provider}'s real native paths (${models
        .map((m) => m.collectionPath)
        .join(", ")}) behind a bearer token — no Nango envelope. The Nango
// emulator remains the alternative; this is the "go direct" option.

const built = makeNativePlugin(spec);

export const ${camel(provider)}Plugin = built.plugin;
export const seedFromConfig = built.seedFromConfig;
export const storeToSeedConfig = built.storeToSeedConfig;
export default ${camel(provider)}Plugin;
`,
    );
    w(
      join(dir, "__tests__", "smoke.test.ts"),
      `import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher } from "@emulators/core";
import { ${camel(provider)}Plugin, seedFromConfig, storeToSeedConfig } from "../index.js";
import { spec } from "../spec.js";

// Auto-generated by tools/gen-standalone.mjs — proves the seed-derived native
// surface: default seed serves rows at the provider's real collection path,
// bearer is enforced, and the store round-trips through storeToSeedConfig.
const base = "http://localhost:4000";

function mk() {
  const store = new Store();
  const app = new Hono();
  ${camel(provider)}Plugin.register(app as never, store, new WebhookDispatcher(), base);
  return { app, store };
}

// The row array lives under a dialect-specific key (\`data\` for the default
// envelope, \`issues\`/\`tickets\`/\`products\` for Jira/Zendesk/Shopify): take
// the first array value so the assertion is dialect-agnostic.
const rowsOf = (body: Record<string, unknown>): unknown[] =>
  (Object.values(body).find(Array.isArray) as unknown[] | undefined) ?? [];

describe("${provider} standalone native (native-kit, seed-derived)", () => {
  for (const model of spec.models) {
    it(\`serves seeded \${model.model} at \${model.collectionPath}\`, async () => {
      const { app, store } = mk();
      ${camel(provider)}Plugin.seed?.(store, base);
      const r = await app.request(\`\${base}\${model.collectionPath}\`, {
        headers: { Authorization: "Bearer x" },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(rowsOf(body).length).toBe(model.rows.length);
    });
  }

  it("rejects unauthenticated reads", async () => {
    const { app } = mk();
    const r = await app.request(\`\${base}\${spec.models[0].collectionPath}\`);
    expect(r.status).toBe(401);
  });

  it("storeToSeedConfig round-trips the live store", async () => {
    const { app, store } = mk();
    ${camel(provider)}Plugin.seed?.(store, base);
    const m0 = spec.models[0];
    await app.request(\`\${base}\${m0.collectionPath}\`, {
      method: "POST",
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      body: JSON.stringify({ _smoke: true }),
    });
    const exported = storeToSeedConfig(store, base);
    expect((exported.records?.[m0.model] ?? []).length).toBe(m0.rows.length + 1);

    const fresh = mk();
    seedFromConfig(fresh.store, base, exported);
    const rr = await fresh.app.request(\`\${base}\${m0.collectionPath}\`, {
      headers: { Authorization: "Bearer x" },
    });
    const reread = (await rr.json()) as Record<string, unknown>;
    expect(rowsOf(reread).length).toBe(m0.rows.length + 1);
  });
});
`,
    );
    built.push({
      name: provider,
      tokenPath: spec.tokenPath,
      models: models.map((m) => ({ model: m.model, collectionPath: m.collectionPath })),
    });
  }
  return built;
}

// ---------------------------------------------------------------------------
// Server wiring — register every standalone emulator with apps/server so the
// reconciled server exposes "go direct" alongside the Nango proxy. Generated
// into its own file so apps/server/src/plugins.ts only merges it in (one line).
// ---------------------------------------------------------------------------
function genServerRegistry(p1, p2) {
  const SERVER = join(ROOT, "apps", "server");
  const lines = [];
  lines.push(`// AUTO-GENERATED by tools/gen-standalone.mjs — do not edit by hand.`);
  lines.push(`//`);
  lines.push(`// Every provider the Nango emulator can proxy is ALSO shipped here as a`);
  lines.push(`// standalone emulator that serves the provider's OWN native REST surface`);
  lines.push(`// behind its own bearer token — no Nango connection/records/proxy layer.`);
  lines.push(`// Nango stays one option; "go direct to source" is always the other.`);
  lines.push(`import type { ServiceEntry } from "emulate";`);
  lines.push(``);
  const entries = [];

  // Phase 1 — rich hand-extracted native surfaces (plugin only; state is
  // created on demand by writes, so no seedFromConfig).
  for (const p of p1) {
    const plug = `${camel(p.name)}Plugin`;
    entries.push(
      `  "${p.name}": {
    label: ${JSON.stringify(`${p.name} direct-to-source emulator (native REST, no proxy)`)},
    endpoints: ${JSON.stringify(p.description)},
    async load() {
      const m = await import("@emulators/${p.name}");
      return { plugin: m.${plug} };
    },
    defaultFallback() {
      return { login: "${p.name}-emulator", id: 1, scopes: [] };
    },
    initConfig: { "${p.name}": {} },
  }`,
    );
  }
  // Phase 2 — seed-derived native-kit emulators (plugin + round-trip pair).
  for (const p of p2) {
    const plug = `${camel(p.name)}Plugin`;
    const ep = `OAuth2 token (${p.tokenPath}) + native collections: ${p.models
      .map((m) => `${m.model} ${m.collectionPath}`)
      .join(", ")}`;
    entries.push(
      `  "${p.name}": {
    label: ${JSON.stringify(`${p.name} direct-to-source emulator (native REST, no proxy)`)},
    endpoints: ${JSON.stringify(ep)},
    async load() {
      const m = await import("@emulators/${p.name}");
      return { plugin: m.${plug}, seedFromConfig: m.seedFromConfig, storeToSeedConfig: m.storeToSeedConfig };
    },
    defaultFallback() {
      return { login: "${p.name}-emulator", id: 1, scopes: [] };
    },
    initConfig: { "${p.name}": {} },
  }`,
    );
  }
  const names = [...p1, ...p2].map((p) => p.name);
  lines.push(`export const DIRECT_REGISTRY: Record<string, ServiceEntry> = {`);
  lines.push(entries.join(",\n"));
  lines.push(`};`);
  lines.push(``);
  lines.push(`export const DIRECT_NAMES = ${JSON.stringify(names)} as const;`);
  w(join(SERVER, "src", "direct-emulators.ts"), lines.join("\n"));

  // Declare each package as an apps/server dependency (tsup noExternal bundles
  // them; pnpm needs the workspace edge to resolve the import).
  const pjPath = join(SERVER, "package.json");
  const pj = JSON.parse(readFileSync(pjPath, "utf8"));
  for (const n of names) pj.dependencies[`@emulators/${n}`] = "workspace:*";
  pj.dependencies = Object.fromEntries(Object.entries(pj.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n");
}

// native-kit's own scaffold (no native-kit self-dep)
scaffold("native-kit", {
  description:
    "Generic direct-to-source engine: turns a provider seed slice into a standalone native-API ServicePlugin.",
});

genPhase1();
const p2 = genPhase2();
genServerRegistry(PHASE1, p2);
console.log(`Phase 1: ${PHASE1.map((p) => p.name).join(", ")}`);
console.log(`Phase 2 (${p2.length}): ${p2.map((p) => p.name).join(", ")}`);
console.log(`Server: registered ${PHASE1.length + p2.length} direct emulators in apps/server/src/direct-emulators.ts`);

// Generated TS/JSON is hand-shaped; let the repo's prettier own final style so
// regeneration stays CI-clean (format:check passes without a manual pass).
execSync(
  'pnpm exec prettier --write --log-level warn "packages/@emulators/*/src/**/*.ts" "apps/server/src/direct-emulators.ts"',
  { cwd: ROOT, stdio: "inherit" },
);
console.log("Prettier: formatted generated sources");
