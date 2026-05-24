// Drive a scenario against a running emulator with a *compressed* clock —
// e.g. 90 simulated days delivered over 90 wall-minutes. Wall-clock timer is
// untouched (ticks fire at scenario.ratePerMinute), but every record is
// stamped with an accelerated `now()` so the data spans the simulated window.
//
//   pnpm --filter api-emulators-quickstart exec tsx src/quarter-compressed.ts \
//     --scenario scenarios/quarter-90min.yaml \
//     --base http://localhost:4004 \
//     --wall-minutes 90 --sim-days 90
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulator, loadScenario } from "@emulators/simulator";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, "..");

const scenarioPath = resolve(EXAMPLE_DIR, flag("--scenario") ?? "scenarios/quarter-90min.yaml");
const base = flag("--base") ?? "http://localhost:4004";
const wallMinutes = Number(flag("--wall-minutes") ?? "90");
const simDays = Number(flag("--sim-days") ?? "90");
const wallSecondsOverride = flag("--wall-seconds");
const wallMs = wallSecondsOverride != null ? Number(wallSecondsOverride) * 1000 : wallMinutes * 60_000;
const simMs = simDays * 86_400_000;
const scale = simMs / wallMs;

const scenario = loadScenario(readFileSync(scenarioPath, "utf8"));
// Override scenario.durationSec so the run auto-stops at the wall window
// (a safety net — maxCount usually finishes earlier).
scenario.durationSec = Math.ceil(wallMs / 1000) + 5;

const realStart = Date.now();
const simStart = realStart - simMs; // ends at "now"
const now = (): Date => new Date(simStart + (Date.now() - realStart) * scale);

console.log(
  `[quarter-compressed] scenario=${scenarioPath}\n` +
    `  base=${base}\n` +
    `  wall=${(wallMs / 60_000).toFixed(2)} min, sim=${simDays} days, scale=${scale.toFixed(2)}x\n` +
    `  sim window: ${new Date(simStart).toISOString()} → ${new Date(realStart).toISOString()}`,
);

const sim = new Simulator(scenario, {
  base,
  now,
  onTick: ({ stream, seq }) => {
    if (seq === 0 || (seq + 1) % 30 === 0) {
      console.log(`[quarter-compressed] ${stream} #${seq} stamped ${now().toISOString()}`);
    }
  },
});

await sim.start();
console.log("[quarter-compressed] done");
