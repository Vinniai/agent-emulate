# @emulators/simulator

An external activity driver for a running [`emulate`](https://github.com/Vinniai/agent-emulate)
deployment. It streams new records/events into the emulator over time — emails
into an inbox, Teams messages, WhatsApp inbound, Drive files, Calendar events —
by hitting the public Nango API (record append + sync/forward webhooks). It can
also drive **native** emulators directly (open GitHub issues, create Stripe
payment intents) so each emulator's *own* webhook dispatch fires on a schedule.

It imports nothing from the emulator: a pure HTTP client that drives any
deployment. The consuming project owns the scenario and the data it pushes.

## CLI

```bash
agent-emulate-sim run <scenario.yaml> [options]

  --base <url>        Emulator base URL (overrides scenario `base:`)
  --once              Fire exactly one tick per stream, then exit
  --dry-run           Generate + log, make no HTTP calls
  --duration <sec>    Stop after N seconds (overrides scenario `durationSec`)
```

`Ctrl-C` (SIGINT/SIGTERM) stops a continuous run gracefully.

## Scenario

YAML or JSON. See [`examples/inbox-stream.yaml`](./examples/inbox-stream.yaml).

| Field | Notes |
|---|---|
| `base` | Default emulator base URL (CLI `--base` wins). |
| `durationSec` | Optional global stop. |
| `streams[].kind` | `sync` (append a record + fire a `sync` webhook), `forward` (wrap+relay a provider webhook), or `native` (write a native emulator's real API so *its own* webhook dispatch fires). |
| `streams[].provider` | Any provider in the generator registry. Built in — sync: `gmail` · `graph-mail` · `teams` · `drive` · `calendar` · `xero` · `jira` · `salesforce` · `github` · `slack`; forward: `whatsapp`; native: `github-issues` · `stripe-payments`. Add your own with `registerGenerator(...)` — no scenario-schema change. |
| `streams[].connectionId` / `providerConfigKey` | Required for `sync`/`forward` — must match a Nango connection the emulator is seeded with. Unused by `native`. |
| `streams[].model` | Required for `sync` (the Nango model appended to). |
| `streams[].environmentUuid` | Required for `forward` (the inbound URL path segment). |
| `streams[].pathPrefix` | `native` only — prepended to the generator's provider-relative path. Empty for a single in-process plugin; `/github`, `/stripe`, … when driving `apps/server` (which mounts every service under its name). |
| `streams[].ratePerMinute` | Tick rate; normalised to an interval. |
| `streams[].jitter` | Fractional jitter on the interval, clamped to `[0,1]`. |
| `streams[].maxCount` | Optional per-stream tick cap. |

## Programmatic

```ts
import { loadScenario, Simulator } from "@emulators/simulator";

const sim = new Simulator(loadScenario(yamlText), { base: "http://emu/nango" });
const done = sim.start(); // resolves on maxCount / duration / sim.stop()
```

Everything non-deterministic (clock, timer, `fetch`, RNG) is injectable for
reproducible runs and tests.

### Teaching it a new provider

Generators live in an open registry keyed by provider name, so any
Nango-seeded provider can be a stream declared purely in a scenario — zero
package edits:

```ts
import { registerGenerator, generatorProviders } from "@emulators/simulator";

registerGenerator("acme-crm", (seq, now) => ({
  kind: "sync",
  model: "deals",
  record: { id: `acme-${seq}`, stage: "won", updatedAt: now.toISOString() },
}));

// scenarios can now use `provider: acme-crm`
generatorProviders(); // → [..., "acme-crm", ...]
```

Apache-2.0
