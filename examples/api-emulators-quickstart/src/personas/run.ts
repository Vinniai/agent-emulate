// Persona driver — stream a persona's email/chat/CRM activity into the live
// `apps/server` and watch it land on the aggregate `/_activity` stream.
//
//   1. start apps/server on :4000   (pnpm --filter @emulators/server dev)
//   2. open the inspector            http://localhost:4000/_inspector
//   3. run a persona:
//        pnpm --filter api-emulators-quickstart persona large-org
//        pnpm --filter api-emulators-quickstart persona inbound-enquiries --duration 30
//
// Time compression — pace by wall-clock, but simulate a longer span:
//        persona large-org --duration 600  --sim-span 10d    # 10 min → 10 days
//        persona inbound-enquiries --duration 5400 --sim-span 9mo  # 90 min → 9 months
//        persona small-business --duration 20 --sim-span 30d  # quick compressed demo
//
// Every persona registers native generators (real REST writes per provider) and
// runs the matching scenario YAML against the server with real wall-clock
// timers, while a virtual clock (timeline.ts) fast-forwards the timestamps each
// message/record carries. Threaded streams (Gmail send/import, Slack thread_ts)
// produce coherent inbound/outbound conversations across the compressed window.
// Nothing here forks `@emulators/simulator` — generators are added via its
// public `registerGenerator()` extension point.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadScenario, Simulator } from "@emulators/simulator";
import { PERSONAS, PERSONA_NAMES } from "./profiles.js";
import { registerPersonaGenerators, CHANNEL_OF, type PersonaGenerators } from "./generators.js";
import { registerNangoGenerators, NANGO_CHANNEL_OF } from "./nango-generators.js";
import { nangoReadbackDemo } from "./nango-readback.js";
import { makeTimeline, parseDuration } from "./timeline.js";
import type { ConvMessage } from "./conversation.js";

const CHANNEL_LOOKUP: Record<string, "email" | "chat" | "crm"> = { ...CHANNEL_OF, ...NANGO_CHANNEL_OF };

interface Args {
  persona: string;
  base: string;
  duration?: number;
  simSpan?: string;
  providers?: string[];
  dryRun: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { persona: "", base: "http://localhost:4000", dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") a.list = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--base") a.base = argv[++i];
    else if (arg === "--duration") a.duration = Number(argv[++i]);
    else if (arg === "--sim-span") a.simSpan = argv[++i];
    else if (arg === "--providers")
      a.providers = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    else if (!arg.startsWith("--") && !a.persona) a.persona = arg;
  }
  return a;
}

// Friendly provider aliases → substrings matched against a stream's
// name/provider/pathPrefix. Kept collision-free (e.g. `msteams` does NOT expand
// to `microsoft`, which would also catch Outlook's /microsoft mount).
const PROVIDER_SYNONYMS: Record<string, string[]> = {
  gmail: ["gmail"],
  google: ["google", "gmail"],
  outlook: ["outlook"],
  msteams: ["msteams", "teams"],
  teams: ["teams", "msteams"],
  microsoft: ["microsoft"],
  salesforce: ["salesforce"],
  hubspot: ["hubspot"],
  xero: ["xero"],
  quickbooks: ["quickbooks", "qb"],
  slack: ["slack"],
  discord: ["discord"],
  intercom: ["intercom"],
  zendesk: ["zendesk"],
  pipedrive: ["pipedrive"],
  resend: ["resend"],
  nango: ["nango"],
};

interface StreamLike {
  name: string;
  provider: string;
  pathPrefix?: string;
}

function streamMatchesProviders(stream: StreamLike, aliases: string[]): boolean {
  const hay = `${stream.name} ${stream.provider} ${stream.pathPrefix ?? ""}`.toLowerCase();
  return aliases.some((alias) => (PROVIDER_SYNONYMS[alias] ?? [alias]).some((term) => hay.includes(term)));
}

const scenarioPath = (f: string): string => fileURLToPath(new URL(`../../scenarios/personas/${f}`, import.meta.url));

interface RecentResp {
  events: Array<{ service: string; action: string; entity: string; id: string }>;
}

async function ringCount(base: string): Promise<number> {
  try {
    const r = await fetch(`${base}/_activity/recent.json?limit=200`);
    return ((await r.json()) as RecentResp).events.length;
  } catch {
    return -1;
  }
}

function bar(n: number, scale = 1): string {
  return "█".repeat(Math.min(40, Math.round(n / scale)));
}

/** Print a sample inbound/outbound thread from whichever threaded stream has one. */
function printSampleThread(gens: PersonaGenerators): void {
  for (const [provider, conv] of Object.entries(gens.conversations)) {
    const thread = conv.sampleThread(3) ?? conv.sampleThread(2);
    if (!thread) continue;
    console.log(`\n  sample thread — ${provider} · "${thread[0].subject}"  (${thread.length} messages)`);
    for (const m of thread) {
      const dir = m.direction === "inbound" ? "📥 in " : "📤 out";
      const t = (m.now as ConvMessage["now"]).toISOString().replace("T", " ").slice(0, 16);
      console.log(`    ${t}  ${dir}  ${m.customer.padEnd(18)} ${m.body.slice(0, 52)}`);
    }
    return; // one good example is enough
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list || !args.persona) {
    console.log("\nPersonas:");
    for (const name of PERSONA_NAMES) console.log(`  ${name.padEnd(20)} ${PERSONAS[name].blurb}`);
    console.log(
      "\nUsage: persona <name> [--base URL] [--duration SECONDS] [--sim-span 10d|9mo|…]\n" +
        "                      [--providers gmail,outlook,salesforce,xero,…] [--dry-run]\n",
    );
    if (!args.persona) process.exit(args.list ? 0 : 1);
    return;
  }

  const profile = PERSONAS[args.persona];
  if (!profile) {
    console.error(`Unknown persona "${args.persona}". Known: ${PERSONA_NAMES.join(", ")}`);
    process.exit(1);
  }

  // Teach the simulator this persona's content + endpoints (no package fork).
  // Must precede loadScenario — scenario validation checks the generator
  // registry. Both the direct and Nango-routed generators are registered; the
  // scenario decides which keys are actually streamed.
  const gens = registerPersonaGenerators(profile.data);
  registerNangoGenerators(profile.data);

  const scn = loadScenario(readFileSync(scenarioPath(profile.scenario), "utf8"));
  if (args.duration != null) scn.durationSec = args.duration;
  const durationSec = scn.durationSec ?? 30;

  // --providers gmail,outlook,salesforce,… → keep only matching streams.
  if (args.providers?.length) {
    const all = scn.streams;
    scn.streams = all.filter((s) => streamMatchesProviders(s, args.providers!));
    if (scn.streams.length === 0) {
      const available = all.map((s) => s.provider).join(", ");
      console.error(
        `\n  ✗ --providers ${args.providers.join(",")} matched no streams in ${profile.scenario}.` +
          `\n    available providers: ${available}\n`,
      );
      process.exit(1);
    }
    const kept = scn.streams.map((s) => s.name).join(", ");
    console.log(`\n  --providers ${args.providers.join(",")} → ${scn.streams.length}/${all.length} streams: ${kept}`);
  }

  // Virtual clock: wall-clock pacing, compressed simulated span.
  const simSpanSec = args.simSpan ? parseDuration(args.simSpan) : undefined;
  const timeline = makeTimeline({ wallSeconds: durationSec, simSpanSec });

  console.log(`\n  ${profile.label} — ${profile.blurb}`);
  console.log(`  base ${args.base}   inspector ${args.base}/_inspector`);
  console.log(
    `  scenario ${profile.scenario}  •  ${scn.streams.length} streams  •  ${durationSec}s wall${args.dryRun ? "  •  DRY RUN" : ""}`,
  );
  console.log(`  time: ${timeline.describe()}\n`);

  if (!args.dryRun) {
    const pre = await ringCount(args.base);
    if (pre < 0) {
      console.error(`  ✗ no server at ${args.base} — start it with: pnpm --filter @emulators/server dev\n`);
      process.exit(1);
    }
    console.log(`  /_activity ring before: ${pre} events\n`);
  }

  const perStream = new Map<string, number>();
  const perChannel = { email: 0, chat: 0, crm: 0 };
  let total = 0;

  const sim = new Simulator(scn, {
    base: args.base,
    dryRun: args.dryRun,
    now: () => timeline.now(), // ← the fast-forward clock
    onTick: ({ stream, provider }) => {
      perStream.set(stream, (perStream.get(stream) ?? 0) + 1);
      const ch = CHANNEL_LOOKUP[provider];
      if (ch) perChannel[ch]++;
      total++;
    },
  });

  const start = Date.now();
  const dash = setInterval(() => {
    const t = ((Date.now() - start) / 1000).toFixed(0);
    const simNow = timeline.now().toISOString().slice(0, 10);
    void ringCount(args.base).then((ring) => {
      process.stdout.write(
        `  [t=${t.padStart(3)}s · sim ${simNow}] email ${String(perChannel.email).padStart(3)} · chat ${String(perChannel.chat).padStart(3)} · crm ${String(perChannel.crm).padStart(3)}  →  ${total} writes` +
          (args.dryRun ? "" : ` | ring ${ring}`) +
          "\n",
      );
    });
  }, 2500);

  await sim.start();
  clearInterval(dash);

  console.log(`\n  ── ${profile.label}: ${total} writes over ${durationSec}s wall ──`);
  for (const s of scn.streams) {
    const n = perStream.get(s.name) ?? 0;
    console.log(`    ${s.name.padEnd(26)} ${String(n).padStart(4)}  ${bar(n, 2)}`);
  }
  console.log(`\n    email ${perChannel.email}  ·  chat ${perChannel.chat}  ·  crm ${perChannel.crm}`);

  printSampleThread(gens);

  if (!args.dryRun) {
    const r = await fetch(`${args.base}/_activity/recent.json?limit=8`);
    const recent = ((await r.json()) as RecentResp).events;
    console.log(`\n  /_activity ring now: ${await ringCount(args.base)} events. Last ${recent.length}:`);
    for (const e of recent)
      console.log(`    ${e.service.padEnd(12)} ${e.action.padEnd(5)} ${e.entity.slice(0, 48).padEnd(48)} ${e.id}`);
    console.log(
      `\n  ▶ watch it live: ${args.base}/_inspector   (filter by provider, or stream ${args.base}/_activity/stream)\n`,
    );

    // The Nango persona drives provider *writes*. Follow up with a unified
    // *read-back* over `/proxy/*`, now that the engine forwards the required
    // Connection-Id + Provider-Config-Key headers per tick.
    if (args.persona === "nango-unified") await nangoReadbackDemo(args.base, profile.data);
  } else {
    console.log("");
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
