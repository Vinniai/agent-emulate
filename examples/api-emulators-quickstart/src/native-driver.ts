// Phase 2.2 acceptance — a *native-provider activity driver*.
//
// Phase 2.1 streamed activity through Nango (append a record → fire a Nango
// `sync` webhook). But the native emulators (GitHub, Stripe, Slack, Resend …)
// already dispatch *their own* provider-shaped webhooks on every write — and
// (Phase 2.3) those deliveries are now retry-backed. Nothing drove the writes.
//
// This proves the new `kind: "native"` stream: the simulator performs periodic
// real API writes against a native emulator (open GitHub issues, create Stripe
// payment intents) and the emulator's own webhook dispatch fires on a
// schedule, so a downstream consumer receives a realistic stream of
// GitHub/Stripe events — declared purely in a scenario, zero simulator edits.
//
//   pnpm --filter api-emulators-quickstart native-driver
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { githubPlugin, seedFromConfig as seedGitHub } from "@emulators/github";
import { stripePlugin, seedFromConfig as seedStripe } from "@emulators/stripe";
import { loadScenario, Simulator, type TimerLike } from "@emulators/simulator";
import { heading, mount } from "./harness.js";

const GH_BASE = "http://gh.localhost";
const ST_BASE = "http://stripe.localhost";

// A real downstream consumer: an HTTP endpoint that records the event name of
// every webhook the emulators POST to it. (`@emulators/core`'s shared
// dispatcher labels the delivery via the JSON body — GitHub uses `action`,
// Stripe uses `type` — so we read the name from the payload, provider-agnostic.)
function consumer(): { url: string; events: string[]; close: () => void } {
  const events: string[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        const p = JSON.parse(body) as { type?: string; action?: string; issue?: unknown };
        if (p.type)
          events.push(p.type); // Stripe: "payment_intent.created"
        else if (p.issue && p.action) events.push(`issues.${p.action}`); // GitHub
      } catch {
        /* ignore non-JSON */
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  srv.listen(0);
  const port = (srv.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/hook`, events, close: () => srv.close() };
}

// Fires immediately (ms ignored). Streams are maxCount-capped so the run is
// deterministic and instant — no wall-clock waits.
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
    clear: (h: unknown): void => void live.delete(h as number),
  };
}

const settle = async (rounds = 200): Promise<void> => {
  for (let k = 0; k < rounds; k++) await new Promise<void>((r) => setImmediate(r));
};

/** Poll until the consumer has captured `n` events (delivery is async). */
async function waitForHits(rcv: { events: string[] }, n: number, tries = 200): Promise<void> {
  for (let i = 0; i < tries && rcv.events.length < n; i++) {
    await new Promise<void>((r) => setTimeout(r, 25));
  }
}

const GH_SCENARIO = `
streams:
  - name: gh-issues
    kind: native
    provider: github-issues
    ratePerMinute: 600
    maxCount: 6
`;
const ST_SCENARIO = `
streams:
  - name: stripe-pi
    kind: native
    provider: stripe-payments
    ratePerMinute: 600
    maxCount: 4
`;

async function runStream(emu: ReturnType<typeof mount>, base: string, scenarioYaml: string): Promise<void> {
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(emu.app.request(url, init)) as Promise<Response>;
  let finished = false;
  const sim = new Simulator(loadScenario(scenarioYaml), {
    base,
    fetch: fetchImpl,
    now: () => new Date(),
    timer: immediateTimer(),
    nativeToken: "emulate-sim",
  });
  const done = sim.start().then(() => void (finished = true));
  for (let i = 0; i < 100_000 && !finished; i++) await new Promise<void>((r) => setImmediate(r));
  await done;
  await settle();
}

async function main(): Promise<void> {
  heading("Phase 2.2 — native-provider activity driver (scenario-declared, zero simulator edits)");

  const rcv = consumer();
  try {
    // --- GitHub: seed acme/app, subscribe a webhook, stream `issues opened` --
    const gh = mount(githubPlugin, GH_BASE, {
      fallbackUser: { login: "acme", id: 1, scopes: ["repo", "admin:repo_hook"] },
    });
    seedGitHub(gh.store, GH_BASE, {
      users: [{ login: "acme", name: "Acme Bot", email: "bot@agent-emulate.dev" }],
      repos: [{ owner: "acme", name: "app", description: "Acme field-service app" }],
    });
    const hookRes = await gh.app.request(`${GH_BASE}/repos/acme/app/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer acme-tok" },
      body: JSON.stringify({ events: ["issues"], config: { url: rcv.url, content_type: "json" } }),
    });
    console.log(`\n▶ subscribe GitHub webhook   POST /repos/acme/app/hooks  →  ${hookRes.status}`);

    // --- Stripe: subscribe a webhook endpoint, stream `payment_intent.*` -----
    const st = mount(stripePlugin, ST_BASE);
    seedStripe(st.store, ST_BASE, { webhooks: [{ url: rcv.url, events: ["payment_intent.created"] }] }, st.webhooks);
    console.log(`▶ subscribe Stripe webhook   (seed) payment_intent.created  →  registered`);

    await runStream(gh, GH_BASE, GH_SCENARIO);
    await runStream(st, ST_BASE, ST_SCENARIO);
    await waitForHits(rcv, 10);

    const ghHits = rcv.events.filter((e) => e === "issues.opened");
    const stHits = rcv.events.filter((e) => e === "payment_intent.created");
    const ghOk = ghHits.length === 6;
    const stOk = stHits.length === 4;

    console.log(`\n  ${ghOk ? "✅" : "❌"} GitHub  → ${ghHits.length}/6 'issues.opened' webhooks received downstream`);
    console.log(
      `  ${stOk ? "✅" : "❌"} Stripe  → ${stHits.length}/4 'payment_intent.created' webhooks received downstream`,
    );

    const ok = ghOk && stOk;
    console.log(
      `\n${ok ? "✅" : "❌"} ${
        ok
          ? "Native emulators driven on a schedule → downstream consumer received a realistic GitHub + Stripe event stream, declared only in YAML."
          : "native-driver INCOMPLETE"
      }\n`,
    );
    if (!ok) process.exit(1);
  } finally {
    rcv.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
