// Phase 2.1 acceptance — a *new* scenario YAML drives Xero-invoice,
// Jira-issue, Salesforce-opportunity, GitHub-PR and Slack-message streams into
// a running emulator with **zero `@emulators/simulator` source edits**. These
// providers are not in the original built-in inbox set; they resolve purely
// through the open generator registry, declared only in
// `scenarios/business-streams.yaml`.
//
// We mount Nango in-process, seed the five connections, inject `fetch` →
// `emu.app.request`, run the scenario under an immediate timer (streams are
// `maxCount`-capped so it completes deterministically), then assert every
// stream's records are queryable via `GET /records` and that each sync emitted
// a webhook delivery.
//
//   pnpm --filter api-emulators-quickstart business-streams
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nangoPlugin, seedFromConfig } from "@emulators/nango";
import { loadScenario, Simulator, type TimerLike } from "@emulators/simulator";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4040";
const scenarioPath = (f: string): string => fileURLToPath(new URL(`../scenarios/${f}`, import.meta.url));

// One connection per business stream in scenarios/business-streams.yaml.
const CONNECTIONS = [
  { id: "xero-acme", key: "xero", provider: "xero", model: "invoices" },
  { id: "jira-acme", key: "jira", provider: "jira", model: "issues" },
  { id: "sfdc-acme", key: "salesforce", provider: "salesforce", model: "opportunities" },
  { id: "gh-acme", key: "github", provider: "github", model: "pull_requests" },
  { id: "slack-acme", key: "slack", provider: "slack", model: "messages" },
] as const;

// Timer that fires immediately (ms ignored). Streams are maxCount-capped, so
// the run completes deterministically and instantly with no wall-clock waits.
function immediateTimer(): TimerLike {
  let seq = 0;
  const live = new Set<number>();
  return {
    set: (fn: () => void): unknown => {
      const id = ++seq;
      live.add(id);
      setImmediate(() => {
        if (live.has(id)) fn();
      });
      return id;
    },
    clear: (h: unknown): void => {
      live.delete(h as number);
    },
  };
}

const settle = async (rounds = 200): Promise<void> => {
  for (let k = 0; k < rounds; k++) await new Promise<void>((r) => setImmediate(r));
};

async function recordCount(emu: ReturnType<typeof mount>, id: string, key: string, model: string): Promise<number> {
  const r = await emu.app.request(`${BASE}/records?model=${model}`, {
    headers: { "Connection-Id": id, "Provider-Config-Key": key },
  });
  return ((await r.json()) as { records: unknown[] }).records.length;
}

async function deliveriesCount(emu: ReturnType<typeof mount>): Promise<number> {
  const r = await emu.app.request(`${BASE}/webhook-deliveries`);
  return ((await r.json()) as { deliveries: unknown[] }).deliveries.length;
}

async function main(): Promise<void> {
  const emu = mount(nangoPlugin, BASE);
  seedFromConfig(emu.store, BASE, {
    connections: CONNECTIONS.map((c) => ({
      id: c.id,
      provider: c.provider,
      provider_config_key: c.key,
      metadata: { organizationId: "org_acme" },
      records: { [c.model]: [] },
    })),
  });
  await emu.app.request(`${BASE}/webhook-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://consumer.example/nango", events: ["sync"] }),
  });

  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(emu.app.request(url, init)) as Promise<Response>;

  heading("Phase 2.1 — business streams (scenario-declared, no simulator source edit)");

  const scn = loadScenario(readFileSync(scenarioPath("business-streams.yaml"), "utf8"));
  const capByConn = new Map(scn.streams.map((s) => [s.connectionId, s.maxCount ?? 0]));

  const before = new Map<string, number>();
  for (const c of CONNECTIONS) before.set(c.id, await recordCount(emu, c.id, c.key, c.model));
  const beforeDeliv = await deliveriesCount(emu);

  const tally = new Map<string, number>();
  let finished = false;
  const sim = new Simulator(scn, {
    base: BASE,
    fetch: fetchImpl,
    now: () => new Date(),
    timer: immediateTimer(),
    random: () => 0.5,
    onTick: (i) => tally.set(i.stream, (tally.get(i.stream) ?? 0) + 1),
  });
  const done = sim.start().then(() => {
    finished = true;
  });
  // Drive the immediate-timer queue until every capped stream is done.
  for (let i = 0; i < 100_000 && !finished; i++) await new Promise<void>((r) => setImmediate(r));
  await done;
  await settle();

  let ok = true;
  for (const c of CONNECTIONS) {
    const stream = scn.streams.find((s) => s.connectionId === c.id)!;
    const cap = capByConn.get(c.id) ?? 0;
    const ticks = tally.get(stream.name) ?? 0;
    const after = await recordCount(emu, c.id, c.key, c.model);
    const grew = after - (before.get(c.id) ?? 0);
    const good = ticks === cap && grew === cap;
    ok &&= good;
    console.log(
      `  ${good ? "✅" : "❌"} ${stream.name.padEnd(16)} ${c.model.padEnd(13)} ` +
        `${ticks}/${cap} ticks • +${grew} records queryable`,
    );
  }

  const afterDeliv = await deliveriesCount(emu);
  const totalSync = [...capByConn.values()].reduce((s, n) => s + n, 0);
  const delivOk = afterDeliv - beforeDeliv >= totalSync;
  ok &&= delivOk;
  console.log(
    `\n  webhook deliveries: ${beforeDeliv} → ${afterDeliv} (≥ +${totalSync} sync) — ${delivOk ? "✅" : "❌"}`,
  );

  console.log(
    `\n${ok ? "✅" : "❌"} ${
      ok
        ? "5 business providers streamed live + queryable + webhooked — declared only in YAML, zero simulator source edits."
        : "business-streams INCOMPLETE"
    }\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
