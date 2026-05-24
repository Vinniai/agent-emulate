// One command that runs the whole "compressed 90-day quarter across every
// provider we can drive" demo against an *already-running* per-port emulate:
//
//   • Seeds 10 Nango connections (gmail/drive/calendar/teams/graph-mail/slack/
//     jira/xero/salesforce/github) on the Nango port.
//   • Launches the compressed driver (sim 90 days → wall 90 min, 1440x clock)
//     to stream those 10 streams into the Nango server.
//   • Drives simpro-sim + uptick-sim in REMOTE mode against their per-port
//     servers — building the full linked 90-day SimPro/Uptick quarter.
//
// Assumes the emulate bundle is already up *and seeded with the simpro/uptick
// roots in `quarter-all.seed.yaml`* (otherwise simpro-sim REMOTE finishes
// 27/29 — the master CC + technician refs don't resolve). Defaults match the
// taskr per-port mapping (simpro 4002, uptick 4003, nango 4004); override via
// flags or env.
//
// Run with:
//   pnpm --filter api-emulators-quickstart quarter-all
//   pnpm --filter api-emulators-quickstart quarter-all -- --wall-minutes 10
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(HERE, "../../..");
const TSX = [join(REPO_ROOT, "node_modules/.bin/tsx"), join(EXAMPLE_DIR, "node_modules/.bin/tsx")].find(existsSync);

function flag(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const nangoBase = flag("--nango", process.env.NANGO_BASE ?? "http://localhost:4004")!;
const simproBase = flag("--simpro", process.env.SIMPRO_BASE ?? "http://localhost:4002")!;
const uptickBase = flag("--uptick", process.env.UPTICK_BASE ?? "http://localhost:4003")!;
const wallMinutes = flag("--wall-minutes", "90")!;
const simDays = flag("--sim-days", "90")!;
const scenario = flag("--scenario", "scenarios/quarter-all10-90min.yaml")!;

const CONNECTIONS: Array<[string, string]> = [
  ["gm-acme-90m", "google-mail"],
  ["dr-acme-90m", "google-drive"],
  ["cal-acme-90m", "google-calendar"],
  ["teams-acme-90m", "microsoft-teams"],
  ["outlook-acme-90m", "outlook"],
  ["slack-acme-90m", "slack"],
  ["jira-acme-90m", "jira"],
  ["xero-acme-90m", "xero"],
  ["sfdc-acme-90m", "salesforce"],
  ["gh-acme-90m", "github"],
];

async function liveness(): Promise<void> {
  for (const [label, url] of [
    ["nango", nangoBase],
    ["simpro", simproBase],
    ["uptick", uptickBase],
  ] as const) {
    const r = await fetch(url, { redirect: "manual" }).catch(() => null);
    if (!r || r.status >= 500) throw new Error(`${label} not reachable at ${url}`);
    console.log(`  ✓ ${label.padEnd(8)} ${url} (HTTP ${r.status})`);
  }
}

async function seedConnections(): Promise<void> {
  for (const [id, key] of CONNECTIONS) {
    const r = await fetch(`${nangoBase}/connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: id, provider_config_key: key }),
    });
    if (!r.ok && r.status !== 409) {
      throw new Error(`seed ${id} failed: HTTP ${r.status} ${await r.text()}`);
    }
    console.log(`  ✓ ${id.padEnd(20)} ${key.padEnd(18)} HTTP ${r.status}`);
  }
}

function spawnSim(label: string, script: string, env: Record<string, string>): ChildProcess {
  if (!TSX) throw new Error("tsx binary not found — run `pnpm install`");
  console.log(`\n[quarter-all] launching ${label} …`);
  const child = spawn(TSX, [join("src", script)], {
    cwd: EXAMPLE_DIR,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return child;
}

function waitChild(label: string, child: ChildProcess): Promise<number | null> {
  return new Promise((resolvePromise) => {
    child.on("exit", (code) => {
      console.log(`[quarter-all] ${label} exited with code=${code}`);
      resolvePromise(code);
    });
  });
}

async function main(): Promise<void> {
  console.log("\n[quarter-all] checking emulate liveness…");
  await liveness();

  console.log("\n[quarter-all] seeding 10 Nango connections…");
  await seedConnections();

  // 1) Compressed Nango stream — long-running (e.g. 90 minutes).
  if (!TSX) throw new Error("tsx binary not found — run `pnpm install`");
  console.log("\n[quarter-all] launching compressed-nango …");
  const compressedDriver = spawn(
    TSX,
    [
      join("src", "quarter-compressed.ts"),
      "--scenario",
      scenario,
      "--base",
      nangoBase,
      "--wall-minutes",
      wallMinutes,
      "--sim-days",
      simDays,
    ],
    { cwd: EXAMPLE_DIR, env: { ...process.env }, stdio: "inherit" },
  );

  // 2) SimPro + Uptick REMOTE crawls — finish in ~60s each.
  const simpro = spawnSim("simpro-sim REMOTE", "simpro-sim.ts", { SIMPRO_SIM_REMOTE: simproBase });
  const uptick = spawnSim("uptick-sim REMOTE", "uptick-sim.ts", { UPTICK_SIM_REMOTE: uptickBase });

  let shuttingDown = false;
  const shutdown = (code = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[quarter-all] shutting down…");
    for (const c of [compressedDriver, simpro, uptick]) if (c && !c.killed) c.kill("SIGTERM");
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const [sc, uc, dc] = await Promise.all([
    waitChild("simpro", simpro),
    waitChild("uptick", uptick),
    waitChild("compressed-nango", compressedDriver),
  ]);

  const ok = sc === 0 && uc === 0 && dc === 0;
  console.log(`\n[quarter-all] ${ok ? "✅ all sims completed" : "❌ one or more sims failed"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[quarter-all] FAILED:\n", err);
  process.exit(1);
});
