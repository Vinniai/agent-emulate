# Persona simulations — email · chat · CRM, streamed live

Four personas drive realistic, multi-channel activity into a running
`apps/server` and light up its live `/_activity` inspector. Each persona pairs a
**content profile** (who's emailing, what they're chatting about, which
leads/deals/tickets flow through the CRM) with a **scenario YAML** (how fast,
how many streams, how bursty).

| Persona | Shape | Channels |
| --- | --- | --- |
| `large-org` | Enterprise — high-volume, every channel at once | Gmail + Outlook · Slack + Discord + Intercom · HubSpot + Salesforce + Zendesk |
| `small-business` | A local trades shop — modest, steady trickle | Gmail · Slack · Pipedrive (persons + deals) + Zendesk |
| `inbound-enquiries` | Sales/support intake — bursty chats & tickets, leads, auto-replies | Intercom + Zendesk + Slack · Salesforce + HubSpot · Resend |
| `nango-unified` | CRM + accounting routed **through Nango** as one service | Salesforce · HubSpot (contacts + deals) · Xero · QuickBooks — all via `/nango` |

Every stream is a `kind: native` tick: a **real REST write** to the provider
emulator (e.g. `POST /gmail/v1/users/me/messages/send`,
`POST /api/chat.postMessage`, `POST /crm/v3/objects/contacts`) routed through
`apps/server`'s `/:service/*` mount via the stream's `pathPrefix`. Because the
server publishes one activity event per forwarded request, the inspector fills
in real time.

## Run it

```bash
# 1. start the aggregate server (has the inspector + activity stream)
pnpm --filter @emulators/server dev          # http://localhost:4000

# 2. open the live inspector
open http://localhost:4000/_inspector

# 3. stream a persona
pnpm --filter api-emulators-quickstart persona large-org
pnpm --filter api-emulators-quickstart persona small-business --duration 20
pnpm --filter api-emulators-quickstart persona inbound-enquiries
pnpm --filter api-emulators-quickstart persona nango-unified

# list personas, or dry-run with no server / no HTTP
pnpm --filter api-emulators-quickstart persona --list
pnpm --filter api-emulators-quickstart persona large-org --dry-run
```

Flags: `--duration <seconds>` (wall-clock run length — override the scenario's
`durationSec`), `--sim-span <10d|9mo|…>` (compress this much *simulated* time
into the wall-clock run — see below), `--providers <a,b,c>` (run only the
matching streams — see below), `--base <url>` (target a different server),
`--dry-run` (generate + tally, no HTTP).

## Pick channels with `--providers`

Run a subset of a persona's streams by provider — handy for exercising one
integration at a time:

```bash
# only the Gmail, Outlook and Salesforce streams of the large-org persona
pnpm --filter api-emulators-quickstart persona large-org --providers gmail,outlook,salesforce

# just the accounting side of the Nango persona
pnpm --filter api-emulators-quickstart persona nango-unified --providers xero,quickbooks
```

Aliases match against each stream's name / provider / `pathPrefix`, with a few
synonyms (`gmail`↔`google`, `msteams`↔`teams`, `qb`↔`quickbooks`). Known names:
`gmail outlook msteams slack discord intercom zendesk salesforce hubspot
pipedrive xero quickbooks resend nango`. An alias that matches nothing prints
the scenario's available providers and exits.

## Time compression — run for minutes, simulate weeks or months

`--sim-span` paces the run by the wall clock (`--duration`) but stamps every
message and record with timestamps drawn from a much longer **simulated**
window. The run ends at "now"; the window opens `--sim-span` in the past.

```bash
# 10 real minutes → 10 days of history
pnpm --filter api-emulators-quickstart persona large-org --duration 600 --sim-span 10d

# 90 real minutes → 9 months of history
pnpm --filter api-emulators-quickstart persona inbound-enquiries --duration 5400 --sim-span 9mo

# quick demos
pnpm --filter api-emulators-quickstart persona small-business --duration 12 --sim-span 30d
```

Span units: `s` seconds · `m` minutes · `h` hours · `d` days · `w` weeks ·
`mo` months (30d) · `y` years (365d). The driver prints the resulting speed-up,
e.g. *"compressing 9mo of activity into 12s (1944000× speed) · sim window
2025-08-27 → 2026-05-24"*.

How it works: a virtual clock (`timeline.ts`) is injected as the simulator's
`now()`. Real `setTimeout` timers still pace the writes, but each generator
stamps the *scaled* time into the body it sends (`created_at`, `add_time`,
`createdate`, the Gmail `Date:` header, Slack `ts`, …). The emulators echo
those client-supplied timestamps back, so stored records land across the whole
compressed window — not bunched at the moment you ran the script.

## Conversational threading — coherent inbound + outbound

Threaded streams model real two-way conversations rather than firing isolated
writes. A shared `Conversations` model (`conversation.ts`) opens and advances
threads per provider; each turn flips direction, and **direction maps to a
genuinely different action**:

- **Gmail** (`gmail-thread`) — outbound = `messages/send`, inbound =
  `messages/import` (lands in INBOX/UNREAD), threaded via `In-Reply-To` /
  `References` headers.
- **Outlook** (`outlook-thread`) — outbound = `me/sendMail`, inbound = `POST
  me/messages`.
- **Slack** (`slack-thread`) — replies carry `thread_ts`; author + 📥/📤 marker
  flip by direction.
- **Discord** (`discord-thread`) — `[threadId #seq] 📥/📤 …` markers keep a
  conversation legible in one channel.

The driver prints a sample transcript after each run so you can see a thread's
messages alternate inbound/outbound across the (compressed) timeline.

## Nango variant — one service, many providers

The `nango-unified` persona streams the same CRM/accounting writes but routes
them **through the Nango emulator** (`/nango`) instead of each provider's own
mount. Nango fronts the providers it manages under stable `*-emu` base paths
that persist to Nango's store:

- **Salesforce** → `POST /nango/salesforce-emu/services/data/v60.0/sobjects/Lead`
- **HubSpot** → `POST /nango/hubspot-emu/crm/v3/objects/{contacts,deals}`
- **Xero** → `POST /nango/xero-emu/api.xro/2.0/Invoices` (also fires a Xero webhook)
- **QuickBooks** → `POST /nango/quickbooks-emu/v3/company/:realmId/invoice` (fires an Intuit event)

On the aggregate `/_activity` stream all of this appears under the single
`nango` service — exactly how a Nango-fronted integration looks in practice. The
generators live in `nango-generators.ts`.

### Unified read-back over `/proxy`

After streaming the writes, the `nango-unified` persona finishes with a
**unified read-back**: it seeds a connection + records for each provider, then
reads them back through Nango's `GET /proxy/<provider-path>` surface and prints
what came back:

```
── Nango unified read-back via /proxy (engine now forwards Connection-Id + Provider-Config-Key) ──
  ✓ Salesforce · Lead        seeded  5 → proxy returned  5   e.g. Rosa Delgado · Helios Robotics
  ✓ HubSpot · Contact        seeded  5 → proxy returned  5   e.g. Rosa Delgado · Helios Robotics
  ✓ Xero · Invoice           seeded  5 → proxy returned  5   e.g. INV-1000 · Helios Robotics · $48000
  ✓ QuickBooks · Invoice     seeded  5 → proxy returned  5   e.g. Helios Robotics · $48000
```

Nango's `/proxy/*` reads require `Connection-Id` + `Provider-Config-Key` request
headers. The simulator engine's `kind: native` ticks now carry per-tick
`headers` (merged onto the engine's own `Authorization`), so the read-back is
**driven by the engine itself** — each read is a real `GET /nango/proxy/…`
visible on `/_activity`. Each provider returns its native envelope
(`{records:[…]}` for Salesforce/HubSpot, `{Invoices:[…]}` for Xero,
`{QueryResponse:{Invoice:[…]}}` for QuickBooks). The read-back lives in
`nango-readback.ts`.

## Realistic throttling — provider-accurate 429s

Each emulator enforces a per-token rate limit and, when tripped, returns its
provider's **real wire shape** — the status code, JSON envelope and headers a
vendor SDK inspects to back off. Profiles live in
`@emulators/core` (`rate-limit.ts`): e.g. Slack `429 {ok:false,error:"ratelimited"}`,
Discord `429 {message,retry_after,global}` + `X-RateLimit-*`, HubSpot
`429 {errorType:"RATE_LIMIT"}` + `X-HubSpot-RateLimit-*`, Salesforce
`403 [{errorCode:"REQUEST_LIMIT_EXCEEDED"}]`, Google `429` usageLimits envelope,
Graph `429 {code:"TooManyRequests"}`. Unknown providers keep the GitHub default.

Under a heavy run you'll see this live: the high-rate Slack stream in `large-org`
(120/min vs Slack's 100/60s) trips genuine `429`s in the inspector. Limits are
overridable per server (`createServer({ rateLimit })`) so tests can force-trip
any provider — see `packages/@emulators/core/src/__tests__/rate-limit.test.ts`.

## Different streaming settings

The scenarios deliberately differ so you can see the inspector behave
differently:

- **large-org** — high `ratePerMinute` (45–120) across 9 streams, moderate
  jitter → a dense, steady firehose (~9–10 writes/sec).
- **small-business** — low rates (6–18) across 5 streams, higher jitter → a
  sparse, irregular trickle.
- **inbound-enquiries** — chat/ticket streams run hot with **high jitter
  (0.7)** → traffic arrives in bursts, the shape of a real enquiry queue, with
  CRM + email running steadier behind it.
- **nango-unified** — moderate CRM/accounting rates (24–40), light jitter, all
  under the one `nango` service.

## Extending — no package fork

Generators are registered through `@emulators/simulator`'s public
`registerGenerator()` extension point (see `generators.ts`), so adding a
provider or a persona never edits the published package:

- **new provider** → add a `kind: native` generator returning
  `{ method, path, body }` for its real endpoint, register it, reference its key
  + `pathPrefix` from a scenario stream.
- **new persona** → add a `PersonaProfile` (content + scenario file) to
  `profiles.ts` and a YAML under `scenarios/personas/`.
