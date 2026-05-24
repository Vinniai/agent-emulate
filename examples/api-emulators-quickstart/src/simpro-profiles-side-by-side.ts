import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(HERE, "../../..");
const EMULATE_CLI = join(REPO_ROOT, "packages/emulate/dist/index.js");
const TSX_BIN = [join(REPO_ROOT, "node_modules/.bin/tsx"), join(EXAMPLE_DIR, "node_modules/.bin/tsx")].find(existsSync);
const DAY = 86_400_000;

const PROFILES = [
  { name: "90d", env: "SIMPRO_90D_BASE_URL", port: 4030 },
  { name: "180d", env: "SIMPRO_180D_BASE_URL", port: 4031 },
  { name: "1y-plus-6m", env: "SIMPRO_1Y_PLUS_6M_BASE_URL", port: 4032 },
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seconds = Number(arg("--seconds") ?? process.env.SIMPRO_PROFILES_SECONDS ?? "0") || 0;
const basePort = Number(arg("--base-port") ?? process.env.SIMPRO_PROFILES_BASE_PORT ?? "4030") || 4030;
const workdir = resolve(arg("--workdir") ?? join(tmpdir(), `emulate-simpro-profiles-${process.pid}`));

function run(command: string, args: string[], env: Record<string, string | undefined>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: EXAMPLE_DIR,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      const lines = text
        .split("\n")
        .filter((line) => line.includes("simulation complete") || line.includes("exported linked"));
      for (const line of lines) console.log(`  ${line.trim()}`);
    });
    child.stderr.on("data", (data: Buffer) => process.stderr.write(data));
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`)),
    );
  });
}

function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = async (): Promise<void> => {
      try {
        const res = await fetch(`${baseUrl}/inspector/jobs`);
        if (res.status < 500) {
          await res.body?.cancel();
          resolvePromise();
          return;
        }
        await res.body?.cancel();
      } catch {
        // keep waiting
      }
      if (Date.now() - started > timeoutMs) reject(new Error(`${baseUrl} did not become ready`));
      else setTimeout(() => void check(), 250);
    };
    void check();
  });
}

async function tokenFor(baseUrl: string): Promise<string> {
  const authz = await fetch(`${baseUrl}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`, {
    redirect: "manual",
  });
  const location = authz.headers.get("Location");
  if (!location) throw new Error(`${baseUrl} did not return an OAuth redirect`);
  const code = new URL(location).searchParams.get("code");
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, client_id: "taskr_dev" }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`${baseUrl} did not issue an access token`);
  return body.access_token;
}

async function proof(baseUrl: string): Promise<{ jobs: number; spanDays: number; futureJobs: number }> {
  const accessToken = await tokenFor(baseUrl);
  const res = await fetch(`${baseUrl}/api/v1.0/companies/0/jobs/?columns=ID,DateIssued&pageSize=250`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const rows = (await res.json()) as Array<{ DateIssued?: string }>;
  const dates = rows
    .map((row) => row.DateIssued)
    .filter((date): date is string => Boolean(date))
    .sort();
  const today = new Date().toISOString().slice(0, 10);
  const spanDays =
    dates.length >= 2 ? Math.round((Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / DAY) : 0;
  return {
    jobs: rows.length,
    spanDays,
    futureJobs: dates.filter((date) => date > today).length,
  };
}

async function main(): Promise<void> {
  if (!TSX_BIN) throw new Error("tsx binary not found. Run pnpm install first.");
  if (!existsSync(EMULATE_CLI)) throw new Error(`Build not found at ${EMULATE_CLI}. Run pnpm --filter emulate build.`);

  mkdirSync(workdir, { recursive: true });
  const servers: ChildProcess[] = [];
  let stopping = false;

  const shutdown = async (code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log("\n[simpro-profiles] shutting down");
    for (const server of servers) {
      if (!server.killed) server.kill("SIGTERM");
    }
    rmSync(workdir, { recursive: true, force: true });
    process.exit(code);
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  try {
    console.log(`[simpro-profiles] generating profile seeds in ${workdir}`);
    const seeds: Array<{ name: string; env: string; port: number; seed: Record<string, unknown> }> = [];
    for (let i = 0; i < PROFILES.length; i++) {
      const profile = PROFILES[i]!;
      const seedPath = join(workdir, `simpro-${profile.name}.seed.json`);
      console.log(`[simpro-profiles] export ${profile.name}`);
      await run(TSX_BIN, [join("src", "simpro-sim.ts"), "--profile", profile.name], {
        SIMPRO_SIM_EXPORT: seedPath,
      });
      seeds.push({
        name: profile.name,
        env: profile.env,
        port: basePort + i,
        seed: JSON.parse(readFileSync(seedPath, "utf8")) as Record<string, unknown>,
      });
    }

    console.log("\n[simpro-profiles] starting local endpoints");
    for (const item of seeds) {
      const seedPath = join(workdir, `server-${item.name}.seed.json`);
      writeFileSync(seedPath, JSON.stringify(item.seed, null, 2));
      const server = spawn(
        process.execPath,
        [
          EMULATE_CLI,
          "start",
          "--service",
          "simpro",
          "--port",
          String(item.port),
          "--base-url",
          `http://localhost:${item.port}`,
          "--seed",
          seedPath,
        ],
        {
          cwd: workdir,
          env: { ...process.env },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      server.stderr?.on("data", (data: Buffer) => process.stderr.write(`  [${item.name}] ${data}`));
      servers.push(server);
      await waitForReady(`http://localhost:${item.port}`, 20_000);
    }

    const proofs = await Promise.all(
      seeds.map(async (item) => ({
        ...item,
        url: `http://localhost:${item.port}`,
        ...(await proof(`http://localhost:${item.port}`)),
      })),
    );

    console.log("\nPaste into your app environment:");
    for (const item of proofs) console.log(`${item.env}=http://localhost:${item.port}`);

    console.log("\nEndpoint smoke checks:");
    for (const item of proofs) {
      console.log(
        `${item.name.padEnd(12)} ${String(item.jobs).padStart(4)} jobs, ${String(item.futureJobs).padStart(3)} future jobs, ${String(item.spanDays).padStart(4)} day span, ${item.url}`,
      );
    }

    console.log(
      seconds > 0
        ? `\n[simpro-profiles] keeping endpoints alive for ${seconds}s`
        : "\n[simpro-profiles] endpoints are running. Press Ctrl-C to stop.",
    );
    if (seconds > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, seconds * 1000));
      await shutdown(0);
    } else {
      await new Promise<void>(() => {});
    }
  } catch (err) {
    console.error("\n[simpro-profiles] failed");
    console.error(err);
    await shutdown(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
