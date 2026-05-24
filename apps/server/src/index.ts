import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import pc from "picocolors";
import {
  registerFontRoutes,
  registerActivityRoutes,
  filePersistence,
  snapshotBundle,
  restoreBundle,
  type AppEnv,
  type Store,
} from "@emulators/core";
import { SERVICE_NAMES } from "./plugins.js";
import { loadConfig } from "./config.js";
import { expandUnifiedUsers } from "./seed/users.js";
import { buildServiceApps, mountDispatcher, type ServiceName } from "./dispatcher.js";
import { createAdminRouter } from "./admin.js";
import { createInspectorRouter } from "./inspector.js";
import { createPreviewerRouter } from "./previewer.js";

async function main() {
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  const baseUrl = process.env.EMULATE_BASE_URL ?? `http://localhost:${port}`;

  const loaded = await loadConfig();
  const config = loaded?.config ?? {};
  const source = loaded?.source ?? "(none — booting with hardcoded defaults only)";

  const tokens = expandUnifiedUsers(config);

  const tokenMap: Record<string, { login: string; id: number; scopes?: string[] }> = {};
  let id = 100;
  for (const [tok, user] of Object.entries(config.tokens ?? {})) {
    tokenMap[tok] = { login: user.login, id: id++, scopes: user.scopes };
  }

  const present = SERVICE_NAMES.filter((name) => name in config);
  const services: ServiceName[] = present.length > 0 ? present : [...SERVICE_NAMES];

  const serviceConfigs: Record<string, Record<string, unknown> | undefined> = {};
  for (const name of SERVICE_NAMES) {
    serviceConfigs[name] = config[name] as Record<string, unknown> | undefined;
  }

  const apps = await buildServiceApps(services, { baseUrl, serviceConfigs, tokens: tokenMap });

  const parent = new Hono<AppEnv>();
  registerFontRoutes(parent);
  parent.use("*", cors());

  // Aggregate live-activity stream across every mounted provider. Filter to one
  // provider with `?service=<name>`. Published from the dispatcher per request.
  registerActivityRoutes(parent);

  parent.get("/", (c) =>
    c.json({
      service: "emulate-server",
      services: [...apps.keys()],
      users: tokens.length,
      inspector: `${baseUrl}/_inspector`,
      previewer: `${baseUrl}/_previewer`,
      activity: `${baseUrl}/_activity/stream`,
      docs: "https://github.com/Vinniai/agent-emulate#readme",
    }),
  );

  parent.route("/", createInspectorRouter({ apps, baseUrl }));
  parent.route("/", createPreviewerRouter({ baseUrl }));
  parent.route("/", createAdminRouter({ apps, config, tokens, baseUrl }));
  mountDispatcher(parent, apps);

  // Optional cross-restart persistence: restore a prior snapshot over the
  // freshly-seeded stores (persisted state is newer than fixtures), then
  // flush back on shutdown so connections, tokens and records survive a
  // restart. Off unless --snapshot-file / EMULATE_SNAPSHOT_PATH is given.
  const snapshotPath = resolveSnapshotPath();
  if (snapshotPath) await wireSnapshotPersistence(snapshotPath, apps);

  serve({ fetch: parent.fetch, port });
  printBanner({ port, baseUrl, source, services: [...apps.keys()], tokens });
}

/** `--snapshot-file <path>` / `--snapshot-file=<path>` (CLI wins) else
 *  `EMULATE_SNAPSHOT_PATH`. Returns undefined when persistence is disabled. */
function resolveSnapshotPath(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot-file") return argv[i + 1];
    if (a.startsWith("--snapshot-file=")) return a.slice("--snapshot-file=".length);
  }
  return process.env.EMULATE_SNAPSHOT_PATH || undefined;
}

async function wireSnapshotPersistence(path: string, apps: Map<ServiceName, { store: Store }>): Promise<void> {
  const persistence = filePersistence(path);
  const stores = new Map<string, Store>([...apps].map(([name, sa]) => [name, sa.store]));

  const existing = await persistence.load();
  if (existing) {
    const restored = restoreBundle(stores, existing);
    console.log(
      restored.length > 0
        ? `[emulate] snapshot: restored ${restored.length} service(s) from ${path}`
        : `[emulate] snapshot: ${path} present but matched no services — booted from seed`,
    );
  } else {
    console.log(`[emulate] snapshot: none at ${path} — booted from seed (persists on exit)`);
  }

  let saving = false;
  const persist = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    try {
      await persistence.save(snapshotBundle(stores));
    } catch (err) {
      console.error("[emulate] snapshot: save failed", err);
    } finally {
      saving = false;
    }
  };

  let shuttingDown = false;
  const shutdown = (sig: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void persist().then(() => {
      console.log(`[emulate] snapshot: saved to ${path} on ${sig}`);
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  const intervalSec = Number.parseInt(process.env.EMULATE_SNAPSHOT_INTERVAL_SEC ?? "0", 10);
  if (Number.isFinite(intervalSec) && intervalSec > 0) {
    setInterval(() => void persist(), intervalSec * 1000).unref();
    console.log(`[emulate] snapshot: periodic flush every ${intervalSec}s`);
  }
}

interface BannerOpts {
  port: number;
  baseUrl: string;
  source: string;
  services: string[];
  tokens: Array<{ token: string; login: string }>;
}

function printBanner({ port, baseUrl, source, services, tokens }: BannerOpts) {
  console.log("");
  console.log(`  ${pc.bold("emulate-server")} ${pc.dim(`listening on :${port}`)}`);
  console.log(`  ${pc.dim("Base URL:")} ${pc.bold(baseUrl)}`);
  console.log(`  ${pc.dim("Config:")}   ${source}`);
  console.log("");
  console.log(`  ${pc.dim("Services")}`);
  for (const name of services) {
    console.log(`    ${pc.cyan(name.padEnd(12))} ${baseUrl}/${name}`);
  }
  if (tokens.length > 0) {
    console.log("");
    console.log(`  ${pc.dim("Unified user tokens")}`);
    for (const t of tokens) {
      console.log(`    ${pc.dim(t.token)} ${pc.dim("->")} ${t.login}`);
    }
  }
  console.log("");
  console.log(`  ${pc.dim("Admin:")} ${baseUrl}/_admin/health`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
