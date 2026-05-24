// `emulate start`, then *build a comprehensive 90-day quarter inside it* and
// leave it running. This is the handoff from "the sims exit" to "a server my
// app talks to that never loses the data":
//
//   1. SEED  — boot ONE per-port `emulate` server (a port per provider) with
//      only the *roots*: WorkOS login, 90d of Nango Google history, and the
//      SimPro/Uptick reference rows (oauth client, baseline customer/site/job,
//      asset types, technicians). Nothing comprehensive yet.
//   2. BUILD — drive `simpro-sim` and `uptick-sim` in REMOTE mode *against the
//      running server over real HTTP*. They build the full linked quarter —
//      jobs → sections → cost centers → **line items** (catalog/labour/one-off/
//      prebuild), invoices → payments, quotes, recurring jobs/invoices, vendor
//      orders, leads, credit notes, the 79 setup collections, … — and SimPro
//      additionally crawls all 372 endpoints. Every row is dated across 90d.
//   3. PERSIST — because the data was written *into the long-lived server*
//      (not an in-process store that exits), it stays there until you Ctrl-C.
//      Your app reads it like the real providers; nothing disappears.
//   4. STREAM — layer the unbounded simulator on top so the Nango feed keeps
//      growing while the SimPro/Uptick quarter stays put.
//
//   pnpm --filter api-emulators-quickstart seeded-server
//   pnpm --filter api-emulators-quickstart seeded-server -- --seconds 8
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(HERE, "../../..");
const EMULATE_CLI = join(REPO_ROOT, "packages/emulate/dist/index.js");
const SIM_CLI = join(REPO_ROOT, "packages/@emulators/simulator/dist/cli.js");
const SCENARIO = join(HERE, "../scenarios/live-feed.yaml");
const TSX_BIN = [join(REPO_ROOT, "node_modules/.bin/tsx"), join(EXAMPLE_DIR, "node_modules/.bin/tsx")].find(existsSync);

// `--service` order fixes the port offsets (basePort + index).
const SERVICES = ["workos", "google", "nango", "simpro", "uptick"] as const;
const BASE_PORT = 4000;
const portOf = (svc: (typeof SERVICES)[number]): number => BASE_PORT + SERVICES.indexOf(svc);
const url = (svc: (typeof SERVICES)[number]): string => `http://localhost:${portOf(svc)}`;

const DAY = 86_400_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const seconds = Number(arg("--seconds") ?? process.env.SEEDED_SERVER_SECONDS ?? "0") || 0;

/** ~90 days of dated history for one Nango model (newest ≈3d old, oldest ≈90d). */
function history(idPrefix: string, extra: (n: number) => Record<string, unknown>): Record<string, unknown>[] {
  return Array.from({ length: 30 }, (_, i) => {
    const daysAgo = 90 - i * 3;
    return { id: `${idPrefix}-${i}`, _historyAt: new Date(Date.now() - daysAgo * DAY).toISOString(), ...extra(i) };
  });
}

function nangoConnections(): Record<string, unknown> {
  return {
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
  };
}

const workosBlock = (): Record<string, unknown> => ({
  users: [{ email: "dev@agent-emulate.dev", first_name: "Dev", last_name: "User", password: "DevPassword123!" }],
  organizations: [{ name: "Acme Inc", slug: "acme" }],
  memberships: [{ user_email: "dev@agent-emulate.dev", organization_slug: "acme", role: "owner" }],
  oauth_clients: [
    { client_id: "client_app_01", client_secret: "sk_app_secret", redirect_uris: ["http://localhost:3000/callback"] },
  ],
});

// SimPro *roots* only — the exact ids `simpro-sim` links its quarter to (oauth
// client, baseline customer 200 / site 55 / job 12345 / stock item 700, …).
// The comprehensive quarter is built on top of these by the REMOTE crawl.
const simproRoots = (): Record<string, unknown> => ({
  oauth: { client_id: "taskr_dev", client_secret: "taskr_dev_secret" },
  companies: [{ id: 0, name: "Taskr Test Co" }],
  tax_codes: [{ id: 1, name: "GST", rate: 10 }],
  statuses: [
    { id: 10, kind: "job", name: "In Progress" },
    { id: 20, kind: "quote", name: "Quoted" },
  ],
  master_cost_centers: [{ id: 500, name: "Service" }],
  staff: [{ id: 7, given_name: "Dana", family_name: "Tech", email: "dana@agent-emulate.dev" }],
  contractors: [{ id: 90, company_name: "Subbie Co", given_name: "Sam", family_name: "Sub" }],
  customers: [
    {
      id: 200,
      type: "company",
      company_name: "Acme Facilities Pty Ltd",
      email: "ops@agent-emulate.dev",
      sites: [{ id: 55, name: "North Campus Building A" }],
    },
    { id: 201, type: "individual", given_name: "Pat", family_name: "Owner" },
  ],
  jobs: [
    {
      id: 12345,
      type: "Project",
      name: "Baseline Job",
      customer_id: 200,
      site_id: 55,
      sections: [{ id: 1, name: "Mechanical", cost_centers: [{ id: 800, name: "Pipework", ex_tax: 4000 }] }],
    },
  ],
  quotes: [{ id: 9001, name: "Baseline Quote", customer_id: 201, status_id: 20 }],
  invoices: [{ id: 7001, job_id: 12345, type: "ProgressInvoice", total_ex_tax: 4000, total_inc_tax: 4400 }],
  schedules: [
    {
      id: 301,
      job_id: 12345,
      technician_id: 7,
      date: new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10),
      start_time: "09:00",
      duration_minutes: 240,
    },
  ],
  assets: [{ id: 410, customer_id: 200, site_id: 55, name: "Pump A1", asset_type: "Pump" }],
  contacts: [{ id: 600, type: "Customer", customer_id: 200, given_name: "Cara", family_name: "Contact" }],
  stock_items: [{ id: 700, name: "Pipe 50mm", part_no: "P-50" }],
});

// Uptick has no default seed — these reference rows must exist before the
// REMOTE crawl creates clients/properties/assets/defects against them.
const uptickRef = (): Record<string, unknown> => ({
  asset_types: [
    { name: "Sprinkler System", description: "Wet/dry pipe sprinkler network" },
    { name: "Fire Extinguisher", description: "Portable extinguisher (ABE/CO2)" },
    { name: "Fire Door", description: "Rated fire/smoke door assembly" },
    { name: "Hydrant", description: "Booster + feed hydrant" },
  ],
  users: [
    { username: "tess", email: "tess@agent-emulate.dev", first_name: "Tess", last_name: "Tech" },
    { username: "ravi", email: "ravi@agent-emulate.dev", first_name: "Ravi", last_name: "Singh" },
  ],
});

/** Run a sim in REMOTE mode against the running per-port server. */
function runRemoteSim(label: string, script: string, envVar: string, target: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!TSX_BIN) return reject(new Error("tsx binary not found — run `pnpm install`"));
    console.log(`\n[seeded-server] BUILD: ${label} — crawling ${target} to build a comprehensive 90-day quarter…\n`);
    const child = spawn(TSX_BIN, [join("src", script)], {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, [envVar]: target },
      stdio: "inherit", // show the coverage/line-item/span assertions as they run
    });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${label} REMOTE crawl failed (exit ${code})`)),
    );
  });
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await Promise.all([
        fetch(`${url("workos")}/`),
        fetch(`${url("nango")}/connection`),
        fetch(`${url("simpro")}/inspector/jobs`),
        fetch(`${url("uptick")}/?tab=defects`),
      ]);
      if (r.every((x) => x.status < 500)) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error("seeded per-port server did not become ready within timeout");
}

/** Authenticated SimPro count + a proof that jobs carry line items. */
async function simproProof(): Promise<{ jobs: number; lineItems: number }> {
  const authz = await fetch(
    `${url("simpro")}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  const code = new URL(authz.headers.get("Location") ?? "http://x/?code=x").searchParams.get("code");
  const tok = (await (
    await fetch(`${url("simpro")}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: "taskr_dev" }),
    })
  ).json()) as { access_token?: string };
  const H = { Authorization: `Bearer ${tok.access_token}` };
  const C = `${url("simpro")}/api/v1.0/companies/0`;
  const jobs = (await (await fetch(`${C}/jobs/?columns=ID&pageSize=250`, { headers: H })).json()) as Array<{
    ID: number;
  }>;
  // Scan newest→oldest for a job whose section → cost center carries line
  // items (Phase-B crawl appends bare jobs last, so don't just take .at(-1)).
  let lineItems = 0;
  for (const j of [...jobs].reverse().slice(0, 40)) {
    const secs = (await (await fetch(`${C}/jobs/${j.ID}/sections/`, { headers: H })).json()) as Array<{ ID: number }>;
    const sid = secs[0]?.ID;
    if (!sid) continue;
    const ccs = (await (
      await fetch(`${C}/jobs/${j.ID}/sections/${sid}/costCenters/`, { headers: H })
    ).json()) as Array<{ ID: number }>;
    const ccid = ccs[0]?.ID;
    if (!ccid) continue;
    let n = 0;
    for (const kind of ["catalogs", "labor", "oneOffs", "prebuilds"]) {
      const items = (await (
        await fetch(`${C}/jobs/${j.ID}/sections/${sid}/costCenters/${ccid}/${kind}/`, { headers: H })
      ).json()) as unknown[];
      if (Array.isArray(items)) n += items.length;
    }
    if (n > 0) {
      lineItems = n;
      break;
    }
  }
  return { jobs: jobs.length, lineItems };
}

async function uptickDefectCount(): Promise<number> {
  const tok = (await (
    await fetch(`${url("uptick")}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username: "tess@agent-emulate.dev",
        password: "x",
      }).toString(),
    })
  ).json()) as { access_token?: string };
  const r = (await (
    await fetch(`${url("uptick")}/api/v2/defects/?page[size]=300`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.api+json" },
    })
  ).json()) as { data?: unknown[] };
  return r.data?.length ?? 0;
}

function banner(simpro: { jobs: number; lineItems: number }, defects: number): void {
  const line = "─".repeat(78);
  console.log(`\n${line}`);
  console.log("  emulate is LIVE — per-port, with a COMPREHENSIVE 90-day quarter built in (persists)\n");
  for (const s of SERVICES) console.log(`    ${s.padEnd(8)} ${url(s)}`);
  console.log("\n  Paste into your app's env (host-only, no path prefix):\n");
  console.log(`    WORKOS_BASE_URL=${url("workos")}   WORKOS_CLIENT_ID=client_app_01`);
  console.log(`    GOOGLE_BASE_URL=${url("google")}`);
  console.log(`    NANGO_HOST=${url("nango")}`);
  console.log(`    SIMPRO_BASE_URL=${url("simpro")}`);
  console.log(`    UPTICK_BASE_URL=${url("uptick")}`);
  console.log(`\n  Built into the running server (read it over HTTP — it does NOT disappear):`);
  console.log(`    SimPro  ${simpro.jobs} jobs across 90 days; freshest job carries ${simpro.lineItems} line items`);
  console.log(`            (catalog/labour/one-off/prebuild) + all 372 endpoints exercised`);
  console.log(`            browse: ${url("simpro")}/inspector/jobs`);
  console.log(`            api:    GET ${url("simpro")}/api/v1.0/companies/0/jobs  (Bearer token)`);
  console.log(`    Uptick  ${defects} defects across clients → properties → assets`);
  console.log(`            browse: ${url("uptick")}/?tab=defects`);
  console.log(`            api:    GET ${url("uptick")}/api/v2/defects/  (Bearer token)`);
  console.log(`    Nango   3 Google connections, ~90 days of history each`);
  console.log(
    seconds > 0
      ? `\n  Streaming live Nango activity for ${seconds}s, then shutting down…`
      : "\n  Streaming live Nango activity on top — Ctrl-C to stop (the built quarter stays).",
  );
  console.log(`${line}\n`);
}

async function main(): Promise<void> {
  for (const [path, hint] of [
    [EMULATE_CLI, "pnpm --filter emulate build"],
    [SIM_CLI, "pnpm --filter @emulators/simulator build"],
  ] as const) {
    if (!existsSync(path))
      throw new Error(`Build not found at ${path}.\nRun \`pnpm -w build\` (or \`${hint}\`) first.`);
  }

  const workdir = mkdtempSync(join(tmpdir(), "emulate-seeded-"));
  const seedPath = join(workdir, "seed.json");
  let server: ChildProcess | undefined;
  let sim: ChildProcess | undefined;
  let shuttingDown = false;

  const shutdown = (code = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[seeded-server] shutting down…");
    if (sim && !sim.killed) sim.kill("SIGTERM");
    if (server && !server.killed) server.kill("SIGTERM");
    rmSync(workdir, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  try {
    // 1 — SEED: write the roots-only seed and boot the per-port server.
    writeFileSync(
      seedPath,
      JSON.stringify(
        { workos: workosBlock(), nango: nangoConnections(), simpro: simproRoots(), uptick: uptickRef() },
        null,
        2,
      ),
    );
    console.log(`[seeded-server] SEED: booting per-port emulate (${SERVICES.join(", ")}) with roots only…`);
    server = spawn(
      process.execPath,
      [EMULATE_CLI, "start", "--service", SERVICES.join(","), "--port", String(BASE_PORT), "--seed", seedPath],
      { cwd: workdir, env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"] },
    );
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`  [emulate] ${d}`));
    server.on("exit", (c) => {
      if (!shuttingDown && c) shutdown(1);
    });
    await waitForReady(25_000);

    // 2 — BUILD: drive both sims in REMOTE mode *into* the running server.
    await runRemoteSim("SimPro", "simpro-sim.ts", "SIMPRO_SIM_REMOTE", url("simpro"));
    await runRemoteSim("Uptick", "uptick-sim.ts", "UPTICK_SIM_REMOTE", url("uptick"));

    // 3 — PERSIST: the quarter is now in the long-lived server. Prove it.
    const simpro = await simproProof();
    const defects = await uptickDefectCount();
    banner(simpro, defects);

    // 4 — STREAM: unbounded live Nango feed on top of the static backfill.
    const simArgs = [SIM_CLI, "run", SCENARIO, "--base", url("nango")];
    if (seconds > 0) simArgs.push("--duration", String(seconds));
    sim = spawn(process.execPath, simArgs, { cwd: REPO_ROOT, env: { ...process.env }, stdio: "inherit" });
    sim.on("exit", (c) => shutdown(c && c !== 0 ? 1 : 0));

    await new Promise<void>(() => {}); // alive until SIGINT (or bounded sim exit)
  } catch (err) {
    console.error("\n[seeded-server] FAILED:\n", err);
    shutdown(1);
  }
}

main().catch((err: unknown) => {
  console.error("\n[seeded-server] FAILED:\n", err);
  process.exit(1);
});
