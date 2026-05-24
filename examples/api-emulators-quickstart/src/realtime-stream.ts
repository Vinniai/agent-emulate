// Realtime activity streaming — `@emulators/simulator` driving a live emulator.
//
// `nango-providers-sim.ts` proves a *static* quarter of data. This proves the
// *moving* picture: new records arriving over time, exactly as a real
// connector would feed them, using the published `@emulators/simulator`
// `Simulator` against an in-process Nango emulator (injected `fetch` →
// `emu.app.request`, so zero network).
//
// Three segments, all config-driven (scenario YAML in ../scenarios/):
//
//   A. ONE stream, real wall clock — a Gmail inbox dripping live; you watch
//      each message land, then GET /records confirms they're queryable.
//   B. MANY streams at once — all 6 providers the simulator drives (5 sync +
//      WhatsApp forward), under a virtual clock so it completes instantly;
//      every stream asserted to deliver exactly its cap and resolve.
//   C. A different time frame — a slow drip whose injected clock advances ~a
//      quarter; the streamed records' own timestamps are asserted to span
//      ≥ 60 days, proving the time window is configurable per scenario.
//
//   pnpm --filter api-emulators-quickstart realtime-stream
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nangoPlugin, seedFromConfig } from "@emulators/nango";
import { loadScenario, Simulator, type TimerLike } from "@emulators/simulator";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4030";
const DAY = 86_400_000;
const scenarioPath = (f: string): string => fileURLToPath(new URL(`../scenarios/${f}`, import.meta.url));

// The 6 connections the scenarios target — must exist before streaming.
const CONNECTIONS = [
  { id: "gm-acme", key: "google-mail", provider: "gmail", model: "messages", histDays: 7 },
  { id: "ms-acme", key: "outlook", provider: "graph-mail", model: "messages", histDays: 30 },
  { id: "teams-acme", key: "microsoft-teams", provider: "teams", model: "messages", histDays: 90 },
  { id: "dr-acme", key: "google-drive", provider: "drive", model: "files", histDays: 180 },
  { id: "cal-acme", key: "google-calendar", provider: "calendar", model: "events", histDays: 365 },
  { id: "wa-acme", key: "whatsapp", provider: "whatsapp", model: null, histDays: 0 },
] as const;

// A small pre-existing history per connection, each over a *different* window
// (7d → 365d) so "different time frames" is visible before any live activity.
function history(model: string, days: number): Record<string, unknown>[] {
  const stamp = (n: number): string => new Date(Date.now() - (days - (days / 3) * n) * DAY).toISOString();
  return [0, 1, 2].map((n) => ({ id: `seed-${model}-${n}`, _historyAt: stamp(n) }));
}

// A virtual clock+timer: ticks fire in time order, `now()` advances with them,
// so a scenario that would take a quarter of wall time completes instantly and
// deterministically while the awaited in-process HTTP still really happens.
class VirtualClock {
  private t = Date.now();
  private q: { id: number; due: number; fn: () => void }[] = [];
  private seq = 0;
  now = (): Date => new Date(this.t);
  timer: TimerLike = {
    set: (fn: () => void, ms: number): unknown => {
      const id = ++this.seq;
      this.q.push({ id, due: this.t + Math.max(0, ms), fn });
      return id;
    },
    clear: (h: unknown): void => {
      this.q = this.q.filter((x) => x.id !== h);
    },
  };
  /** Fire due tasks in order until `stop()`. The engine's tick is async (it
   *  awaits two in-process fetches, *then* re-arms), so the queue goes
   *  transiently empty between a tick firing and its next task being
   *  scheduled — we wait that out instead of exiting early. */
  async drain(stop: () => boolean, maxSteps = 1_000_000): Promise<void> {
    const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));
    let steps = 0;
    while (!stop() && steps++ < maxSteps) {
      if (this.q.length === 0) {
        // In-flight async may still schedule the next task — give it room.
        let waited = 0;
        while (this.q.length === 0 && !stop() && waited++ < 2_000) await flush();
        if (this.q.length === 0) break; // genuinely drained / finished
        continue;
      }
      this.q.sort((a, b) => a.due - b.due || a.id - b.id);
      const task = this.q.shift()!;
      this.t = Math.max(this.t, task.due);
      task.fn();
      await flush();
      await flush();
    }
  }
}

// Let every in-flight async tick (awaited fetch → onTick → finish) fully
// settle before we read tallies/record counts, so no trailing tick is lost.
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
      records: c.model ? { [c.model]: history(c.model, c.histDays) } : {},
    })),
  });
  // Register a webhook sink so sync + forward deliveries are captured.
  await emu.app.request(`${BASE}/webhook-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://consumer.example/nango", events: ["sync", "forward"] }),
  });

  // In-process fetch — the Simulator thinks it's hitting a deployment.
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(emu.app.request(url, init)) as Promise<Response>;

  let ok = true;

  // ── Segment A — ONE stream, real wall clock ─────────────────────────────
  heading("Realtime — Segment A: one Gmail inbox, live (real wall clock)");
  const beforeA = await recordCount(emu, "gm-acme", "google-mail", "messages");
  const scnA = loadScenario(readFileSync(scenarioPath("single-gmail.yaml"), "utf8"));
  const t0 = Date.now();
  let aTicks = 0;
  const simA = new Simulator(scnA, {
    base: BASE,
    fetch: fetchImpl,
    onTick: (i) => {
      aTicks++;
      console.log(`  +${String(Date.now() - t0).padStart(5)}ms  ${i.stream}#${i.seq}  → message landed`);
    },
  });
  await simA.start();
  const afterA = await recordCount(emu, "gm-acme", "google-mail", "messages");
  const aOk = aTicks === 6 && afterA - beforeA === 6;
  console.log(
    `\n  ${aTicks} messages streamed in ~${((Date.now() - t0) / 1000).toFixed(1)}s • ` +
      `GET /records: ${beforeA} → ${afterA}  — ${aOk ? "✅ live + queryable" : "❌"}`,
  );
  ok &&= aOk;

  // ── Segment B — MANY streams at once, virtual clock ─────────────────────
  heading("Realtime — Segment B: 6 providers streaming at once (one run)");
  const scnB = loadScenario(readFileSync(scenarioPath("all-streams.yaml"), "utf8"));
  const capByStream = new Map(scnB.streams.map((s) => [s.name, s.maxCount ?? 0]));
  const before = new Map<string, number>();
  for (const c of CONNECTIONS) {
    if (c.model) before.set(c.id, await recordCount(emu, c.id, c.key, c.model));
  }
  const beforeDeliv = await deliveriesCount(emu);
  const tally = new Map<string, { n: number; kind: string }>();
  const clockB = new VirtualClock();
  const simB = new Simulator(scnB, {
    base: BASE,
    fetch: fetchImpl,
    now: clockB.now,
    timer: clockB.timer,
    random: () => 0.5,
    onTick: (i) => {
      const cur = tally.get(i.stream) ?? { n: 0, kind: i.kind };
      cur.n++;
      tally.set(i.stream, cur);
    },
  });
  let finishedB = false;
  const doneB = simB.start().then(() => {
    finishedB = true;
  });
  await clockB.drain(() => finishedB);
  await doneB;
  await settle();

  let bOk = true;
  for (const [name, cap] of capByStream) {
    const got = tally.get(name)?.n ?? 0;
    const good = got === cap;
    bOk &&= good;
    console.log(`  ${good ? "✅" : "❌"} ${name.padEnd(18)} ${got}/${cap} ticks (${tally.get(name)?.kind})`);
  }
  console.log("");
  for (const c of CONNECTIONS) {
    if (!c.model) continue;
    const after = await recordCount(emu, c.id, c.key, c.model);
    const cap = capByStream.get(scnB.streams.find((s) => s.connectionId === c.id)!.name) ?? 0;
    const grew = after - (before.get(c.id) ?? 0);
    const good = grew === cap;
    bOk &&= good;
    console.log(`  ${good ? "✅" : "❌"} ${c.id.padEnd(11)} ${c.model.padEnd(9)} +${grew} records (expected +${cap})`);
  }
  const afterDeliv = await deliveriesCount(emu);
  const syncTicks = [...capByStream].filter(([n]) => n !== "whatsapp-inbound").reduce((s, [, c]) => s + c, 0);
  const delivOk = afterDeliv - beforeDeliv >= syncTicks;
  bOk &&= delivOk;
  console.log(
    `\n  webhook deliveries: ${beforeDeliv} → ${afterDeliv} (≥ +${syncTicks} sync) — ${delivOk ? "✅" : "❌"}` +
      `\n  ${bOk ? "✅ every stream delivered its cap, all records resolved" : "❌ stream/delivery mismatch"}`,
  );
  ok &&= bOk;

  // ── Segment C — a different time frame (virtual clock spans a quarter) ───
  heading("Realtime — Segment C: slow drip, streamed records span a quarter");
  const scnC = loadScenario(readFileSync(scenarioPath("quarter-drip.yaml"), "utf8"));
  const clockC = new VirtualClock();
  const simC = new Simulator(scnC, {
    base: BASE,
    fetch: fetchImpl,
    now: clockC.now,
    timer: clockC.timer,
    random: () => 0.5,
  });
  let finishedC = false;
  const doneC = simC.start().then(() => {
    finishedC = true;
  });
  await clockC.drain(() => finishedC);
  await doneC;
  await settle();

  const spanOf = async (
    id: string,
    key: string,
    model: string,
    idPrefix: string,
    at: (r: Record<string, unknown>) => number,
  ) => {
    const r = await emu.app.request(`${BASE}/records?model=${model}`, {
      headers: { "Connection-Id": id, "Provider-Config-Key": key },
    });
    const rows = ((await r.json()) as { records: Record<string, unknown>[] }).records.filter((x) =>
      String(x.id).startsWith(idPrefix),
    );
    const ts = rows
      .map(at)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    return { n: rows.length, days: ts.length < 2 ? 0 : Math.round((ts[ts.length - 1]! - ts[0]!) / DAY) };
  };
  const gm = await spanOf("gm-acme", "google-mail", "messages", "sim-gm-", (r) => Number(r.internalDate));
  const dr = await spanOf("dr-acme", "google-drive", "files", "sim-dr-", (r) => Date.parse(String(r.modifiedTime)));
  const cOk = gm.days >= 60 && dr.days >= 60;
  console.log(`  gmail   streamed ${gm.n} messages spanning ${gm.days} days`);
  console.log(`  drive   streamed ${dr.n} files spanning ${dr.days} days`);
  console.log(`\n  both streams span ≥ a quarter of *simulated* time — ${cOk ? "✅ time frame configurable" : "❌"}`);
  ok &&= cOk;

  heading("Realtime — summary");
  console.log(`  A (one, realtime)        ${aOk ? "✅" : "❌"}`);
  console.log(`  B (many, one run)        ${bOk ? "✅" : "❌"}`);
  console.log(`  C (different time frame) ${cOk ? "✅" : "❌"}`);
  console.log(
    `\n${ok ? "✅" : "❌"} Realtime streaming ${ok ? "complete — events streamed live from one and many providers, configurable time frames" : "INCOMPLETE"}.\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
