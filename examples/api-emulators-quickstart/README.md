# API Emulators Quickstart

Runnable, narrated end-to-end demos for **every** `emulate` emulator — all 16
direct providers, the Nango provider library, and five comprehensive
operational simulations / end-to-end chains with full endpoint coverage.

Each script mounts one emulator in-process — no ports, no Docker, no network —
seeds it with realistic data, then walks the integration flow a backend would
actually run, printing each request and response the way you'd inspect it in a
REST client.

## Getting started

From the repository root:

```bash
pnpm install

# A single provider
pnpm --filter api-emulators-quickstart github
pnpm --filter api-emulators-quickstart simpro

# All 13 OAuth/API direct quickstarts back to back
pnpm --filter api-emulators-quickstart direct

# The Nango provider-library walkthrough (34-provider seed catalogue)
pnpm --filter api-emulators-quickstart nango-providers

# The five simulations / e2e chains (full route coverage, assertion-gated)
pnpm --filter api-emulators-quickstart sims

# Realtime streaming — live events from one and many providers
pnpm --filter api-emulators-quickstart realtime-stream

# The end-to-end proof: a separate process auths over real HTTP through a
# running emulate server (needs `pnpm -w build` first)
pnpm --filter api-emulators-quickstart external-consumer

# The composed story: WorkOS sign-in → connect Google + SimPro → unified
# proxy reads → live events streamed into the app's webhook sink
pnpm --filter api-emulators-quickstart workos-dashboard-live

# "Just leave it running": per-port server + quarter of seeded history +
# UNBOUNDED live activity, with a paste-ready env block for your own app
# (needs `pnpm -w build` first; Ctrl-C to stop)
pnpm --filter api-emulators-quickstart live-feed

# Same, but pre-loaded with the FULL comprehensive 90-day SimPro + Uptick
# quarter (every endpoint) — your app reads it over HTTP; it persists
pnpm --filter api-emulators-quickstart seeded-server

# Everything
pnpm --filter api-emulators-quickstart all
```

## Composed end-to-end story (`workos-dashboard-live`)

The whole three-pillar vision — **emulate auth → simulate activity → proxy for
the providers** — in one narrated run, with no ports and no network (three
emulators mounted in-process; the simulator's `fetch` injected straight at
`app.request`):

1. **Sign in with WorkOS** — `authorize` → `authenticate` → the user's
   organization membership loads the dashboard context.
2. **Connect applications from the dashboard** — Google Mail + Drive through
   the hosted **Nango** connect-session handshake (`/connect/sessions` →
   `/connect/complete`), and **SimPro** via its own OAuth 2.0 code flow.
3. **Unified data back to the end app** — proxied reads across every linked
   provider: `GET /connection`, Gmail messages and Drive files through Nango,
   and the SimPro job through its own API surface.
4. **Watch live events arrive** — [`@emulators/simulator`](../../packages/@emulators/simulator/)
   drips brand-new Gmail messages into the _running_ emulator over real
   wall-clock time ([`scenarios/single-gmail.yaml`](./scenarios/single-gmail.yaml));
   each one lands at the app's registered webhook sink. Asserted: 6 streamed,
   `GET /records` grows by 6, ≥6 webhook deliveries to the app.

Every act is assertion-gated; the script exits non-zero if any pillar fails.

## Quickstarts

Concise (~4–6 narrated steps) demos representative of each provider.

| Script            | Provider             | Flow exercised                                                        |
| ----------------- | -------------------- | --------------------------------------------------------------------- |
| `vercel`          | Vercel               | token auth → projects / deployments                                   |
| `github`          | GitHub               | token auth → repos / issues                                           |
| `google`          | Google               | OIDC authorize → token → userinfo + JWKS                              |
| `slack`           | Slack                | token auth → `chat.postMessage` / history                             |
| `apple`           | Apple                | authorize → token → decode signed `id_token` (JWKS)                   |
| `microsoft`       | Microsoft Entra      | OIDC authorize → token → Graph `/me`                                  |
| `okta`            | Okta                 | OIDC (custom auth server) → token → SSWS mgmt API                     |
| `aws`             | AWS                  | S3 put/get (XML) + SQS send/receive (form)                            |
| `resend`          | Resend               | API key → send email → inbox capture                                  |
| `stripe`          | Stripe               | products/prices → checkout session → payment intent                   |
| `mongoatlas`      | MongoDB Atlas        | API key → clusters / database users                                   |
| `clerk`           | Clerk                | OIDC sign-in → userinfo → Backend API (secret key)                    |
| `workos`          | WorkOS               | authorize → authenticate → memberships → password grant               |
| `nango`           | Nango                | connections → records → proxy → connect-session handshake             |
| `nango-providers` | Nango ×34            | loads `../nango-seeds.yaml`, one provider per category                |
| `crm`             | HubSpot + Salesforce | OAuth → object CRUD → associations / SOQL → search / describe → batch |

## Deep walkthroughs

`simpro` and `uptick` are full narrated walkthroughs that exercise the real
provider surface end to end, including a **store → seed-config → re-seed**
round-trip that is asserted in-script:

- **`simpro`** — OAuth 2.0 auth-code + single-use refresh-token rotation,
  reference data, customers/sites/staff/contractors, jobs → sections → cost
  centers (the deepest nested route), quotes/invoices/payments/schedules/assets,
  webhook `Secret`-returned-once, inspector HTML, then a deep-route round-trip.
- **`uptick`** — OAuth 2.0 password grant, JSON:API across
  clients → properties → assets → defects with name-based FK auto-resolution,
  version-path + `page[size]` behaviour, PATCH status transitions, inspector
  tabs, then a closed-defect round-trip.

## CRM end-to-end (`crm`)

`crm` drives the two CRMs a real backend integrates first, both served by the
Nango plugin's **direct** routes (no proxy / connection layer — point a
HubSpot/Salesforce client straight at the emulator base URL):

- **HubSpot** — OAuth 2.0 authorization-code flow → create contact + company →
  v4 association → PATCH → CRM Search (`filterGroups`) → batch-create.
- **Salesforce** — OAuth 2.0 username-password grant → sObject CRUD (with the
  `attributes` envelope) → `composite/sobjects` collection-create → SOQL
  (`SELECT … FROM … WHERE …`) → sObject `describe`.

## 3-month simulations (full endpoint coverage)

These simulate a quarter of operations and then drive **every** route the
emulator registers, asserting 100 % route-pattern coverage. They exit non-zero
on any coverage gap, 5xx, or list-endpoint failure — so they double as
contract tests.

| Script                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uptick-sim`               | 12 weekly client onboardings + defect lifecycle across 90 days; **28/28** uptick routes including official-style `OPTIONS` metadata; round-trip verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `simpro-sim`               | Profile-driven SimPro workflow seeding: `90d`, `180d`, or `1y-plus-6m`, each with six months of future scheduled work; jobs, schedules, invoices, payments, quotes, vendor orders, recurring work, line items, assets, staff, contractors, leads and setup collections are linked; a generic crawler resolves every `:param` transitively and exercises **all 1,435 SimPro Swagger operations** plus local OAuth/inspector routes; spec-only writes persist through generic `swagger_records`; **29/29** shape + relational-integrity checks (every stateful entity's full shape + every FK resolved to a real linked record)                                                                                                                                                                                                                      |
| `nango-providers-sim`      | **10 connections**, 90 days of dated records each. Four (xero, quickbooks, google-drive, onedrive) drive every provider-native `/proxy/*` path; the rest form a **cross-provider graph** — Slack/Gmail/Jira/Salesforce records link into Google Drive by file id + share URL, Jira links into GitHub PRs. **Each connection is independently verified** (resolves through the emulator, records are emulator-served, a live append round-trips back through `GET /records`, ≥75-day span), then a cross-provider integrity phase resolves **all 95** references to real linked records; **18/18** Nango routes                                                                          |
| `direct-sim`               | **No Nango layer at all** — 5 emulators (GitHub, Slack, Stripe, Resend, Vercel) each spoken to through their _own_ native API. A 90-day DevOps quarter: 12 weekly cycles of incident → deploy notice → invoice payment → customer mail → service ship, then a third of incidents resolved via PATCH. Every created entity is **round-tripped back through that provider's own GET**; **24/24** native route patterns across 5 providers, **11/11** assertion checks, 0 × non-2xx                                                                                                                                                                                                        |
| `business-streams`         | **Phase 2.1 — scenario-declared provider streams, zero simulator source edits.** Xero invoices, Jira issues, Salesforce opportunities, GitHub PRs and Slack messages streamed into a running Nango emulator purely from [`scenarios/business-streams.yaml`](./scenarios/business-streams.yaml) via the open generator registry; every stream's records asserted queryable through `GET /records` and each sync asserted to have fired a webhook delivery                                                                                                                                                                                                                                |
| `native-driver`            | **Phase 2.2 — native-provider activity driver, zero simulator source edits.** The simulator performs scheduled real API writes against native emulators (open GitHub issues, create Stripe payment intents) so each emulator's _own_ retry-backed webhook dispatch fires; a real downstream HTTP consumer asserts it received the full **6× `issues.opened` + 4× `payment_intent.created`** stream — declared only via the `kind: native` streams in the script's inline scenarios                                                                                                                                                                                                      |
| `xero-quickbooks-webhooks` | **Full create → provider → signed webhook → our destination chain**, no Nango envelope. Stands up a real listening socket, registers it via `POST /webhook-settings`, then for **Xero** and **QuickBooks**: OAuth2 token → create invoice through the native write API → the emulator POSTs our destination the provider's _own_ webhook shape (Xero `events[]` under `x-xero-signature`, QuickBooks `eventNotifications[]` under `intuit-signature`), each signed **base64-HMAC-SHA256 re-derived locally and compared byte-for-byte**, then follows the webhook's resource pointer back to GET the new invoice. **11/11** assertions; both deliveries logged in `/webhook-deliveries` |

Set `SIMPRO_SIM_EXPORT=/path/to/seed.json` when running `simpro-sim` to write a
bootable seed after the full Swagger crawl. Export mode skips destructive
DELETE calls so spec-only rows created by the crawler survive into
`simpro.swagger_records`.

```bash
pnpm --filter api-emulators-quickstart simpro-sim:90d
pnpm --filter api-emulators-quickstart simpro-sim:180d
pnpm --filter api-emulators-quickstart simpro-sim:1y-plus-6m

SIMPRO_SIM_EXPORT=./tmp/simpro-90d.seed.json pnpm --filter api-emulators-quickstart simpro-sim:90d
```

To run all three SimPro profiles side by side for app testing:

```bash
pnpm --filter api-emulators-quickstart simpro-profiles
```

The runner prints:

```bash
SIMPRO_90D_BASE_URL=http://localhost:4030
SIMPRO_180D_BASE_URL=http://localhost:4031
SIMPRO_1Y_PLUS_6M_BASE_URL=http://localhost:4032
```

It also smoke-tests OAuth and job counts against each endpoint. Use
`--seconds 30` for a bounded run.

To run the full core provider matrix across the same profile windows:

```bash
pnpm --filter api-emulators-quickstart core-profiles
```

The runner starts three Nango endpoints. Every provider gets the same
per-profile record count: 40 records for `90d`, 52 for `180d`, and 79 for
`1y-plus-6m`.

```bash
CORE_90D_NANGO_URL=http://localhost:4040
CORE_180D_NANGO_URL=http://localhost:4041
CORE_1Y_PLUS_6M_NANGO_URL=http://localhost:4042
```

Seeded connections:

```text
crm        salesforce-acme, hubspot-acme, pipedrive-acme, zoho-crm-acme
accounting freshbooks-acme, wave-acme
chat       slack-acme, discord-acme, microsoft-teams-acme
email      gmail-acme, outlook-mail-acme, mailchimp-acme, sendgrid-acme, klaviyo-acme
storage    google-drive-acme, onedrive-acme, dropbox-acme, box-acme
calendar   google-calendar-acme, outlook-calendar-acme
projects   jira-acme, linear-acme, asana-acme, notion-acme, clickup-acme, monday-acme, trello-acme
code       github-acme, gitlab-acme
support    zendesk-acme, intercom-acme
hr         bamboohr-acme, greenhouse-acme, lever-acme
commerce   shopify-acme
analytics  mixpanel-acme
forms      typeform-acme
database   airtable-acme
scheduling calendly-acme
```

Validate a running endpoint against Nango's record and webhook contracts:

```bash
pnpm --filter api-emulators-quickstart core-profiles:validate -- --base-url http://localhost:4040
```

Realtime Nango workflows are webhook-based. The provider sends a webhook to
Nango, Nango updates its cache or forwards the provider payload, then your app
reads changed records from `GET /records` using `_nango_metadata.cursor`.

Fetch real Nango data for comparison with:

```bash
curl -G "https://api.nango.dev/records" \
  -H "Authorization: Bearer $NANGO_SECRET_KEY" \
  -H "Connection-Id: $NANGO_CONNECTION_ID" \
  -H "Provider-Config-Key: $NANGO_PROVIDER_CONFIG_KEY" \
  --data-urlencode "model=$NANGO_MODEL" \
  --data-urlencode "limit=100"
```

The local Nango emulator covers the current sync workflow routes:
`/connections`, `/connections/metadata`, `/records`, `/records/prune`,
`/sync/start`, `/sync/pause`, `/sync/trigger`, `/sync/status`, and
`/sync/{name}/variant/{variant}`. Deprecated `/connection` aliases remain
available for older clients.

## Nango provider library

`../nango-seeds.yaml` is a 34-provider, SDK-aligned seed catalogue (Salesforce,
HubSpot, Jira, GitHub, Shopify, Zendesk, Slack, …). `nango-providers` loads it
whole and walks a representative provider per category; `nango-providers-sim`
drives a 10-connection cross-provider graph through a full 3-month simulation,
where Slack/Gmail/Jira/Salesforce records link into Google Drive files (images
and proposal/report docs) and Jira issues into resolving GitHub PRs — every
cross-reference is resolved against the target provider's real records.

## Realtime streaming

`realtime-stream` drives the published [`@emulators/simulator`](../../packages/@emulators/simulator/)
`Simulator` against an in-process Nango emulator (injected `fetch` →
`emu.app.request`, zero network), proving the _moving_ picture — new records
arriving over time exactly as a real connector feeds them. It is fully
config-driven by the scenario YAML in [`scenarios/`](./scenarios):

| Segment                      | Scenario            | Proves                                                                                                                                                                       |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — one, realtime**        | `single-gmail.yaml` | One Gmail inbox dripping under the **real wall clock**; each message printed as it lands, then `GET /records` confirms it's queryable                                        |
| **B — many, one run**        | `all-streams.yaml`  | All **6 providers at once** (5 `sync` + WhatsApp `forward`) under a virtual clock; every stream asserted to deliver exactly its cap and every record/webhook to resolve      |
| **C — different time frame** | `quarter-drip.yaml` | A slow drip whose injected clock advances **~a quarter**; the streamed records' own timestamps are asserted to span ≥ 60 days — the time window is configurable per scenario |

Each scenario also runs unchanged against a real deployment via the published
CLI: `agent-emulate-sim run scenarios/all-streams.yaml --base http://nango.localhost:1355`.

For the package's own example see `agent-emulate-sim` and `inbox-stream.yaml` in
[`../../packages/@emulators/simulator/`](../../packages/@emulators/simulator/).

## External-consumer proof — point your app at emulate

Every script above mounts the emulator **in-process** for zero-setup demos.
`external-consumer` is the opposite and the whole point of `emulate`: it spawns
the real **`@emulators/server`** binary as a **separate OS process**, talks to
it only over **real HTTP**, and proves a downstream app can treat emulate as a
drop-in stand-in for the real providers — auth included.

```bash
pnpm -w build   # external-consumer runs the built server
pnpm --filter api-emulators-quickstart external-consumer
```

It walks the exact path a production OpenID Connect client runs:

1. **OIDC discovery** — `GET /google/.well-known/openid-configuration` →
   `issuer`, `jwks_uri`, `RS256`.
2. **Authorization-code flow** over HTTP → code → `POST /oauth2/token` →
   `access_token` + `id_token` + `refresh_token`.
3. **id_token verification with `jose`** — `createRemoteJWKSet(jwks_uri)` +
   `jwtVerify(id_token, JWKS, { issuer, audience })`. These are the _same
   primitives Auth.js / openid-client use internally_, so if this passes a real
   auth library trusts emulate's tokens.
4. **Token realism** — the server runs with `EMULATE_GOOGLE_TOKEN_TTL=1`, so the
   access token expires in ~1s: a stale token gets a real **401**, and the
   standard `grant_type=refresh_token` mints a fresh one that works again.
5. **Provider proxy** — an authenticated `GET /github/user` through the _same_
   running server shows emulate proxying a different provider.

### Pointing a real Auth.js app at emulate

The server's Google issuer is `http://localhost:<port>/google`. With
[Auth.js](https://authjs.dev) you only override the issuer and credentials —
**no application code changes**:

```ts
// auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID, // any value in no-config mode
      clientSecret: process.env.GOOGLE_CLIENT_SECRET, // any value in no-config mode
      issuer: "http://localhost:4000/google", // ← emulate, not accounts.google.com
    }),
  ],
});
```

Run `pnpm --filter @emulators/server dev` (defaults to `:4000`), set the env
above, and the app's normal sign-in flow — discovery, code exchange, JWKS
verification, refresh — all resolve against emulate. Shorten the token lifetime
with `EMULATE_GOOGLE_TOKEN_TTL` to exercise refresh in tests; flip
`EMULATE_AUTH_LAX=1` to disable expiry when you don't care.

## Leave it running — `live-feed` (per-port, point your app at it)

`external-consumer` proves the wiring once and exits. `live-feed` is the
**keep-it-running** version: one command boots the **per-port** `emulate` CLI
(each provider on its **own origin** — the faithful topology, _not_ the
single-port `/provider` dispatcher), seeds the org's connections plus **~90
days of history**, and then runs `agent-emulate-sim` **unbounded** so new activity
keeps arriving until you Ctrl-C.

```bash
pnpm -w build   # builds the emulate + agent-emulate-sim binaries it spawns
pnpm --filter api-emulators-quickstart live-feed
# bounded sanity run instead of forever:
pnpm --filter api-emulators-quickstart live-feed -- --seconds 8
```

Why per-port and not the single-port dispatcher? Real SaaS APIs are **distinct
origins** (`api.workos.com`, `api.nango.dev`, …), differing by host, not path.
`emulate start` mirrors that — `createServer` + `serve` **once per service**,
`port = basePort + index` — so an SDK configured host-only appends its own
canonical paths (`/v1/...`, `/oauth2/...`) and they land correctly, with
per-origin cookies/CORS/OIDC issuer. (`emulate start --portless` goes further:
each provider gets a real hostname `https://<svc>.emulate.localhost` over 443.)

On boot it prints a paste-ready env block. Point **your own app** (e.g.
taskrs-convex) at it — host-only, no path prefix:

```bash
WORKOS_BASE_URL=http://localhost:4000   WORKOS_CLIENT_ID=client_app_01
GOOGLE_BASE_URL=http://localhost:4001
NANGO_HOST=http://localhost:4002
SIMPRO_BASE_URL=http://localhost:4003
```

Your app's existing flows then run unchanged against emulate:

- **Login** — redirect to `…:4000/user_management/authorize`, callback →
  `POST …:4000/user_management/authenticate` → `{ user, organization }`.
- **Connections** — `POST …:4002/connect/sessions` → link → `GET …:4002/connection`
  lists the org's linked providers (gm-acme/dr-acme/cal-acme, pre-seeded).
- **Proxied reads** — `GET …:4002/records?model=messages` (with `Connection-Id`
  / `Provider-Config-Key` headers) returns the quarter of history, and **keeps
  growing** as the unbounded simulator streams new records in. Watch the
  `[agent-emulate-sim] … #seq` lines in the terminal and re-poll from your app.

## Comprehensive seeded server — `seeded-server`

`live-feed` seeds a light SimPro fixture; `seeded-server` boots the same
per-port server and then **builds the full comprehensive 90-day quarter inside
it** for **both SimPro and Uptick** — every SimPro Swagger operation and every
Uptick endpoint, dated across the quarter,
including job → section → cost center → **line items** (catalog/labour/one-off/
prebuild), invoices → payments, quotes, recurring jobs/invoices, vendor orders,
leads, credit notes and the 79 `setup/*` collections.

```bash
pnpm -w build
pnpm --filter api-emulators-quickstart seeded-server          # or: -- --seconds 8
```

What it does, in order:

1. **Seed** — boots ONE per-port `emulate` server (a port per provider) with
   only the _roots_: WorkOS login, 90d of Nango Google history, and the
   SimPro/Uptick reference rows (oauth client, baseline customer/site/job,
   asset types, technicians). Nothing comprehensive yet.
2. **Build** — drives `simpro-sim` + `uptick-sim` in **REMOTE mode** against the
   running server over real HTTP (`SIMPRO_SIM_REMOTE` / `UPTICK_SIM_REMOTE`).
   They build the full linked quarter — and SimPro additionally crawls all
   1,435 Swagger operations plus local OAuth/inspector routes — writing every
   stateful row _into the long-lived server_. SimPro routes that are covered by
   the Swagger fallback, but do not have bespoke typed handlers yet, store their
   rows under `simpro.swagger_records` and export through `swagger_records`.
3. **Persist** — because the data was written into the running server (not an
   in-process store that exits), it stays there until you Ctrl-C. Nothing
   disappears when you read it.
4. **Stream** — layers the unbounded simulator on top, so the Nango feed keeps
   growing while the SimPro/Uptick quarter stays put.

Point your app at the printed env block and read the quarter like the real
providers (verified end-to-end — after the sims exit, the long-lived server
still serves SimPro standard OAuth auth-code → `GET
…:4003/api/v1.0/companies/0/jobs` (17 jobs; freshest carries 4 line items),
`…/customerPayments` `…/leads` `…/vendorOrders` `…/setup/teams` all return dated
rows; Uptick password grant → `GET …:4004/api/v2/defects/` returns 24 dated
defects; browse `…:4003/inspector/jobs` and `…:4004/?tab=defects`). The data
does **not** vanish between requests — it is a live in-memory store on a
long-lived server.

## How it works

Every emulator is a `ServicePlugin` registered onto a [Hono](https://hono.dev)
app backed by an in-memory `Store` via `@emulators/core`'s `createServer` —
exactly how `@emulators/server` mounts them, but in-process so the demos run
with zero setup. The shared `src/harness.ts` provides the bootstrap (`mount`,
which also wires the same CORS + auth + rate-limit middleware) and the
request/print helper (`call`).

## Project structure

```
src/
  harness.ts                Shared in-process mount + request/print helpers
  <provider>.ts             One quickstart per direct provider (16)
  nango-providers.ts        Nango 34-provider seed-library walkthrough
  crm.ts                    HubSpot CRM + Salesforce REST/SOQL end-to-end
  simpro.ts / uptick.ts     Deep narrated walkthroughs (+ round-trip)
  uptick-sim.ts             Uptick 3-month sim, 28/28 route coverage
  simpro-sim.ts             Simpro 3-month sim, Swagger route coverage
  simpro-routes.generated.ts  Auto-generated simpro route table (driver input)
  nango-providers-sim.ts    Nango 10-connection cross-provider 3-month sim
  direct-sim.ts             Direct (no-Nango) 5-provider native-API 3-month sim
  xero-quickbooks-webhooks.ts  Create invoice → Xero/QuickBooks → signed webhook → our destination
  realtime-stream.ts        Realtime streaming (one + many providers) via @emulators/simulator
  business-streams.ts       Phase 2.1 — Xero/Jira/Salesforce/GitHub/Slack streams, scenario-only
  external-consumer.ts      Separate-process OIDC + refresh + proxy proof over real HTTP
  workos-dashboard-live.ts  Composed story: WorkOS → connect Google+SimPro → unified reads → live webhook stream
  live-feed.ts              "Leave it running": per-port server + 90d seed + unbounded sim, env for your app
  seeded-server.ts          per-port server with the full SimPro+Uptick 90-day quarter built in via REMOTE crawl
scenarios/
  single-gmail.yaml         One stream, realtime cadence
  all-streams.yaml          All 6 inbox providers at once, capped + deterministic
  quarter-drip.yaml         Slow drip spanning a simulated quarter
  business-streams.yaml     5 business providers (Xero/Jira/Salesforce/GitHub/Slack)
  live-feed.yaml            Uncapped gmail/drive/calendar — runs until Ctrl-C
```
