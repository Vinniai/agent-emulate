// The turnkey "just leave it running" command.
//
// Boots the per-port `emulate` CLI (each provider on its OWN origin — the
// faithful topology: workos→:4000, google→:4001, nango→:4002, simpro→:4003),
// seeds a *quarter* of history plus the org's already-linked connections,
// prints a ready-to-paste env block for an external app (e.g. taskrs-convex),
// then runs `emulate-sim` UNBOUNDED so live activity keeps flowing into the
// running server until you Ctrl-C. Nothing here is in-process — this spawns
// the real `emulate` + `emulate-sim` binaries and talks to them over HTTP,
// exactly as a deployed app would.
//
//   pnpm --filter api-emulators-quickstart live-feed
//   pnpm --filter api-emulators-quickstart live-feed -- --seconds 8   (bounded)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const EMULATE_CLI = join(REPO_ROOT, "packages/emulate/dist/index.js");
const SIM_CLI = join(REPO_ROOT, "packages/@emulators/simulator/dist/cli.js");
const SCENARIO = join(HERE, "../scenarios/live-feed.yaml");

// `--service` order fixes the port offsets (basePort + index).
const SERVICES = ["workos", "google", "nango", "simpro"] as const;
const BASE_PORT = 4000;
const portOf = (svc: (typeof SERVICES)[number]): number => BASE_PORT + SERVICES.indexOf(svc);
const url = (svc: (typeof SERVICES)[number]): string => `http://localhost:${portOf(svc)}`;

const DAY = 86_400_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const seconds = Number(arg("--seconds") ?? process.env.LIVE_FEED_SECONDS ?? "0") || 0;

/** ~90 days of dated history for one model (newest ≈3d old, oldest ≈90d). */
function history(idPrefix: string, extra: (n: number) => Record<string, unknown>): Record<string, unknown>[] {
  return Array.from({ length: 30 }, (_, i) => {
    const daysAgo = 90 - i * 3;
    return {
      id: `${idPrefix}-${i}`,
      _historyAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
      ...extra(i),
    };
  });
}

function seedConfig(): Record<string, unknown> {
  return {
    workos: {
      users: [{ email: "dev@agent-emulate.dev", first_name: "Dev", last_name: "User", password: "DevPassword123!" }],
      organizations: [{ name: "Acme Inc", slug: "acme" }],
      memberships: [{ user_email: "dev@agent-emulate.dev", organization_slug: "acme", role: "owner" }],
      oauth_clients: [
        {
          client_id: "client_app_01",
          client_secret: "sk_app_secret",
          redirect_uris: ["http://localhost:3000/callback"],
        },
      ],
    },
    // Three already-linked Google connections, each with a quarter of history
    // so the external app's "unified view" is non-empty before live activity.
    // The ids/keys match scenarios/live-feed.yaml.
    nango: {
      connections: [
        {
          id: "gm-acme",
          provider: "gmail",
          provider_config_key: "google-mail",
          metadata: { organizationId: "org_acme", linkedBy: "dev@agent-emulate.dev" },
          records: { messages: history("hist-m", (n) => ({ snippet: `Archived message ${n}` })) },
        },
        {
          id: "dr-acme",
          provider: "drive",
          provider_config_key: "google-drive",
          metadata: { organizationId: "org_acme", linkedBy: "dev@agent-emulate.dev" },
          records: { files: history("hist-f", (n) => ({ name: `Document ${n}.gdoc` })) },
        },
        {
          id: "cal-acme",
          provider: "calendar",
          provider_config_key: "google-calendar",
          metadata: { organizationId: "org_acme", linkedBy: "dev@agent-emulate.dev" },
          records: { events: history("hist-e", (n) => ({ summary: `Past meeting ${n}` })) },
        },
      ],
    },
    simpro: {
      oauth: { client_id: "acme_app", client_secret: "acme_app_secret" },
      companies: [{ id: 0, name: "Acme Facilities" }],
      customers: [{ id: 200, type: "company", company_name: "North Campus", email: "ops@agent-emulate.dev" }],
      jobs: [{ id: 12345, type: "Project", name: "Sprinkler Overhaul Q3", customer_id: 200, stage: 3 }],
    },
  };
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [n, w] = await Promise.all([fetch(`${url("nango")}/connection`), fetch(`${url("workos")}/`)]);
      if (n.ok && w.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("emulate per-port server did not become ready within timeout");
}

function banner(): void {
  const line = "─".repeat(74);
  console.log(`\n${line}`);
  console.log("  emulate is LIVE — per-port (each provider its own origin)\n");
  for (const s of SERVICES) console.log(`    ${s.padEnd(8)} ${url(s)}`);
  console.log("\n  Paste into taskrs-convex env (host-only, no path prefix):\n");
  console.log(`    WORKOS_BASE_URL=${url("workos")}`);
  console.log(`    WORKOS_CLIENT_ID=client_app_01`);
  console.log(`    GOOGLE_BASE_URL=${url("google")}`);
  console.log(`    NANGO_HOST=${url("nango")}`);
  console.log(`    SIMPRO_BASE_URL=${url("simpro")}`);
  console.log("\n  Login:        POST " + `${url("workos")}/user_management/authenticate`);
  console.log("  Connections:  GET  " + `${url("nango")}/connection`);
  console.log("  Proxied read: GET  " + `${url("nango")}/records?model=messages`);
  console.log("                     (Connection-Id: gm-acme, Provider-Config-Key: google-mail)");
  console.log(`\n  Seeded: org "acme", 3 Google connections, ~90 days of history each.`);
  console.log(
    seconds > 0
      ? `  Streaming live activity for ${seconds}s, then shutting down…`
      : "  Streaming live activity — Ctrl-C to stop.",
  );
  console.log(`${line}\n`);
}

async function main(): Promise<void> {
  for (const [path, hint] of [
    [EMULATE_CLI, "pnpm --filter emulate build"],
    [SIM_CLI, "pnpm --filter @emulators/simulator build"],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`Build not found at ${path}.\nRun \`pnpm -w build\` (or \`${hint}\`) first.`);
    }
  }

  const workdir = mkdtempSync(join(tmpdir(), "emulate-live-feed-"));
  const seedPath = join(workdir, "seed.json");
  writeFileSync(seedPath, JSON.stringify(seedConfig(), null, 2));

  let server: ChildProcess | undefined;
  let sim: ChildProcess | undefined;
  let shuttingDown = false;

  const shutdown = (code = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[live-feed] shutting down…");
    if (sim && !sim.killed) sim.kill("SIGTERM");
    if (server && !server.killed) server.kill("SIGTERM");
    rmSync(workdir, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  try {
    console.log(`[live-feed] starting per-port emulate (services: ${SERVICES.join(", ")})…`);
    server = spawn(
      process.execPath,
      [EMULATE_CLI, "start", "--service", SERVICES.join(","), "--port", String(BASE_PORT), "--seed", seedPath],
      { cwd: workdir, env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"] },
    );
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`  [emulate] ${d}`));
    server.on("exit", (c) => {
      if (!shuttingDown && c) shutdown(1);
    });

    await waitForReady(20_000);
    banner();

    const simArgs = [SIM_CLI, "run", SCENARIO, "--base", url("nango")];
    if (seconds > 0) simArgs.push("--duration", String(seconds));
    sim = spawn(process.execPath, simArgs, { cwd: REPO_ROOT, env: { ...process.env }, stdio: "inherit" });
    sim.on("exit", (c) => {
      // Bounded run (or sim ended): tear the whole thing down.
      shutdown(c && c !== 0 ? 1 : 0);
    });

    // Keep the parent alive while children run (unbounded → until SIGINT).
    await new Promise<void>(() => {});
  } catch (err) {
    console.error("\n[live-feed] FAILED:\n", err);
    shutdown(1);
  }
}

main().catch((err: unknown) => {
  console.error("\n[live-feed] FAILED:\n", err);
  process.exit(1);
});
