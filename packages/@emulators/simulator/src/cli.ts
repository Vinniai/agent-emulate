#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadScenario } from "./scenario.js";
import { Simulator } from "./engine.js";

// emulate-sim — external activity driver for a running emulator.
//
//   emulate-sim run <scenario.yaml> [--base URL] [--once] [--dry-run]
//                                   [--duration SECONDS]

interface Args {
  cmd?: string;
  scenario?: string;
  base?: string;
  once: boolean;
  dryRun: boolean;
  duration?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { once: false, dryRun: false };
  const rest = [...argv];
  a.cmd = rest.shift();
  while (rest.length) {
    const tok = rest.shift()!;
    if (tok === "--once") a.once = true;
    else if (tok === "--dry-run") a.dryRun = true;
    else if (tok === "--base") a.base = rest.shift();
    else if (tok === "--duration") a.duration = Number(rest.shift());
    else if (!tok.startsWith("--") && !a.scenario) a.scenario = tok;
  }
  return a;
}

const USAGE = `emulate-sim — stream live activity into a running emulator

Usage:
  emulate-sim run <scenario.yaml> [options]

Options:
  --base <url>        Emulator base URL (overrides scenario \`base:\`)
  --once              Fire exactly one tick per stream, then exit
  --dry-run           Generate + log, make no HTTP calls
  --duration <sec>    Stop after N seconds (overrides scenario \`durationSec\`)
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd !== "run" || !args.scenario) {
    process.stdout.write(USAGE);
    process.exit(args.cmd ? 1 : 0);
  }

  const path = resolve(process.cwd(), args.scenario);
  const scenario = loadScenario(await readFile(path, "utf8"));
  if (args.duration != null) scenario.durationSec = args.duration;

  const sim = new Simulator(scenario, {
    base: args.base,
    dryRun: args.dryRun,
    onTick: ({ stream, provider, kind, seq }) =>
      console.log(`[emulate-sim] ${new Date().toISOString()}  ${stream}  ${provider}/${kind}  #${seq}`),
  });

  const target = args.base ?? scenario.base;
  console.log(
    `[emulate-sim] ${args.dryRun ? "DRY-RUN " : ""}${args.once ? "once" : "streaming"} → ${target}` +
      `  (${scenario.streams.length} stream${scenario.streams.length === 1 ? "" : "s"})`,
  );

  if (args.once) {
    await sim.runOnce();
    console.log("[emulate-sim] done (--once)");
    return;
  }

  const done = sim.start();
  const onSig = () => {
    console.log("\n[emulate-sim] stopping…");
    sim.stop();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  await done;
  console.log("[emulate-sim] done");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
