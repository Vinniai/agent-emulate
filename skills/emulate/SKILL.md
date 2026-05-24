---
name: emulate
description: Local drop-in API emulator for Vercel, GitHub, Google, Slack, Apple, Microsoft, AWS, SimPro, Uptick, and other services. Use when the user needs to start emulated services, configure seed data, write tests against local APIs, set up CI without network access, or work with the emulate CLI or programmatic API. Triggers include "start the emulator", "emulate services", "mock API locally", "create emulator config", "test against local API", "npx agent-emulate", or any task requiring local service emulation.
allowed-tools: Bash(npx agent-emulate:*), Bash(agent-emulate:*)
---

# Service Emulation with agent-emulate

Local drop-in replacement services for CI and no-network sandboxes. Fully stateful, production-fidelity API emulation, not mocks.

## Quick Start

```bash
npx agent-emulate
```

All services start with sensible defaults:

| Service   | Default Port |
|-----------|-------------|
| Vercel    | 4000        |
| GitHub    | 4001        |
| Google    | 4002        |
| Slack     | 4003        |
| Apple     | 4004        |
| Microsoft | 4005        |
| AWS       | 4006        |
| SimPro    | auto        |
| Uptick    | auto        |

## CLI

```bash
# Start all services (zero-config)
npx agent-emulate

# Start specific services
npx agent-emulate --service vercel,github

# Custom base port (auto-increments per service)
npx agent-emulate --port 3000

# Use a seed config file
npx agent-emulate --seed config.yaml

# Generate a starter config
npx agent-emulate init

# Generate config for a specific service
npx agent-emulate init --service vercel

# List available services
npx agent-emulate list
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port` | `4000` | Base port (auto-increments per service) |
| `-s, --service` | all | Comma-separated services to enable |
| `--seed` | auto-detect | Path to seed config (YAML or JSON) |
| `--base-url` | none | Override advertised base URL (supports `{service}` template) |
| `--portless` | off | Serve over HTTPS via portless (auto-registers aliases) |

The port can also be set via `EMULATE_PORT` or `PORT` environment variables.

The advertised base URL (used in OAuth redirects, webhook URLs, etc.) can be overridden via `--base-url`, the `EMULATE_BASE_URL` env var (supports `{service}` template), or per-service `baseUrl` in the seed config. When running under portless, the `PORTLESS_URL` env var is also detected automatically.

## Programmatic API

```bash
npm install emulate
```

Each call to `createEmulator` starts a single service:

```typescript
import { createEmulator } from 'emulate'

const github = await createEmulator({ service: 'github', port: 4001 })
const vercel = await createEmulator({ service: 'vercel', port: 4002 })

github.url   // 'http://localhost:4001'
vercel.url   // 'http://localhost:4002'

await github.close()
await vercel.close()
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `service` | *(required)* | `'vercel'`, `'github'`, `'google'`, `'slack'`, `'apple'`, `'microsoft'`, or `'aws'` |
| `port` | `4000` | Port for the HTTP server |
| `seed` | none | Inline seed data (same shape as YAML config) |
| `baseUrl` | none | Override advertised base URL. Per-service `baseUrl` in seed config takes highest priority, then this option, then `EMULATE_BASE_URL` env var (supports `{service}`), then `PORTLESS_URL` (supports `{service}`, automatically set by the `portless` CLI wrapper), then `http://localhost:<port>`. |

### Instance Methods

| Method | Description |
|--------|-------------|
| `url` | Base URL of the running server |
| `reset()` | Wipe the store and replay seed data |
| `close()` | Shut down the HTTP server, returns a Promise |

## Vitest / Jest Setup

```typescript
import { createEmulator, type Emulator } from 'emulate'

let github: Emulator
let vercel: Emulator

beforeAll(async () => {
  ;[github, vercel] = await Promise.all([
    createEmulator({ service: 'github', port: 4001 }),
    createEmulator({ service: 'vercel', port: 4002 }),
  ])
  process.env.GITHUB_EMULATOR_URL = github.url
  process.env.VERCEL_EMULATOR_URL = vercel.url
})

afterEach(() => { github.reset(); vercel.reset() })
afterAll(() => Promise.all([github.close(), vercel.close()]))
```

## Configuration

Configuration is optional. The CLI auto-detects config files in this order:

1. `emulate.config.yaml` / `.yml`
2. `emulate.config.json`
3. `service-emulator.config.yaml` / `.yml`
4. `service-emulator.config.json`

Or pass `--seed <file>` explicitly. Run `npx agent-emulate init` to generate a starter file.

### Config Structure

```yaml
tokens:
  my_token:
    login: admin
    scopes: [repo, user]

vercel:
  users:
    - username: developer
      name: Developer
      email: dev@agent-emulate.dev
  teams:
    - slug: my-team
      name: My Team
  projects:
    - name: my-app
      team: my-team
      framework: nextjs
  integrations:
    - client_id: oac_abc123
      client_secret: secret_abc123
      name: My Vercel App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/vercel

github:
  users:
    - login: octocat
      name: The Octocat
      email: octocat@github.com
  orgs:
    - login: my-org
      name: My Organization
  repos:
    - owner: octocat
      name: hello-world
      language: JavaScript
      auto_init: true
  oauth_apps:
    - client_id: Iv1.abc123
      client_secret: secret_abc123
      name: My Web App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/github

google:
  users:
    - email: testuser@agent-emulate.dev
      name: Test User
  oauth_clients:
    - client_id: my-client-id.apps.googleusercontent.com
      client_secret: GOCSPX-secret
      redirect_uris:
        - http://localhost:3000/api/auth/callback/google

slack:
  team:
    name: My Workspace
    domain: my-workspace
  users:
    - name: developer
      real_name: Developer
      email: dev@agent-emulate.dev
  channels:
    - name: general
      topic: General discussion
  bots:
    - name: my-bot
  oauth_apps:
    - client_id: "12345.67890"
      client_secret: example_client_secret
      name: My Slack App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/slack

apple:
  users:
    - email: testuser@agent-emulate.dev
      name: Test User
  oauth_clients:
    - client_id: com.example.app
      team_id: TEAM001
      name: My Apple App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/apple

microsoft:
  users:
    - email: testuser@agent-emulate.dev
      name: Test User
  oauth_clients:
    - client_id: example-client-id
      client_secret: example-client-secret
      name: My Microsoft App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/microsoft-entra-id

aws:
  region: us-east-1
  s3:
    buckets:
      - name: my-app-bucket
  sqs:
    queues:
      - name: my-app-events
  iam:
    users:
      - user_name: developer
        create_access_key: true
    roles:
      - role_name: lambda-execution-role

simpro:
  swagger_records:
    /api/v1.0/companies/0/catalogGroups/:
      - ID: 77
        Name: Seeded catalog group
        DisplayOrder: 2
```

SimPro `swagger_records` seeds spec-only collections from the bundled Swagger
surface. Use the concrete API collection path as the key. Mutating spec-only
routes persist to this store and `storeToSeedConfig` exports them in the same
shape.

For realistic SimPro workflow mock testing, use the profile-driven quickstart
simulator:

```bash
pnpm --filter api-emulators-quickstart simpro-sim:90d
pnpm --filter api-emulators-quickstart simpro-sim:180d
pnpm --filter api-emulators-quickstart simpro-sim:1y-plus-6m
```

Each profile includes six months of future scheduled work and crawls all 1,435
vendored Swagger operations plus local OAuth and inspector routes. To write a
bootable seed file, set `SIMPRO_SIM_EXPORT`:

```bash
SIMPRO_SIM_EXPORT=./tmp/simpro-90d.seed.json pnpm --filter api-emulators-quickstart simpro-sim:90d
```

Exported seeds include linked workflow records and schema-complete
`simpro.swagger_records` generated from the vendored Swagger spec for
spec-only endpoints.

For app testing against all SimPro windows at the same time:

```bash
pnpm --filter api-emulators-quickstart simpro-profiles
```

This generates the `90d`, `180d`, and `1y-plus-6m` seeds, starts local SimPro
endpoints on ports 4030, 4031, and 4032, prints the `SIMPRO_*_BASE_URL`
environment variables, and smoke-tests OAuth plus job counts. Use `--seconds
30` for bounded runs.

Open `/inspector` on any SimPro endpoint to view the overview and left-sidebar
links for schedules, quotes, invoices, payments, vendor orders, assets,
inventory, recurring work, setup records and webhook activity.

For app testing across core integration categories:

```bash
pnpm --filter api-emulators-quickstart core-profiles
```

This starts three Nango endpoints on ports 4040, 4041, and 4042 for `90d`,
`180d`, and `1y-plus-6m`. Each endpoint includes the full core provider matrix,
and every provider gets the same per-profile record count: 40 records for
`90d`, 52 for `180d`, and 79 for `1y-plus-6m`.

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

Use Nango's regular `Connection-Id` and `Provider-Config-Key` headers to read
records from the endpoint for the target profile.

Validate a running profile endpoint against the Nango record and webhook
contracts:

```bash
pnpm --filter api-emulators-quickstart core-profiles:validate -- --base-url http://localhost:4040
```

Nango realtime workflows are webhook-based, not WebSocket-based. The provider
sends a webhook to Nango, Nango updates its records cache or forwards the
provider event, and the app reads changed records through `GET /records` using
`_nango_metadata.cursor`.

To fetch real Nango data for comparison:

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

### Source parity audits

Use `pnpm audit:sources` from the repo root to inspect
`documentation/emulator-source-map.json`. It reports whether each emulator is
backed by a vendored spec, official machine-readable docs, official human docs,
or seed-derived native paths. Uptick's public source of truth is its live
JSON:API endpoint index plus `OPTIONS` metadata, so the emulator exposes
`OPTIONS` for supported Uptick resources.

For an authorized Uptick tenant, run:

```bash
pnpm discover:uptick -- --base-url https://tenant.onuptick.com --token "$UPTICK_ACCESS_TOKEN" --out documentation/uptick-discovery.json
```

The script can also use `UPTICK_USERNAME`, `UPTICK_PASSWORD`,
`UPTICK_CLIENT_ID`, and `UPTICK_CLIENT_SECRET` to request a token.

For public GitHub hints, run:

```bash
GITHUB_TOKEN=ghp_... pnpm search:uptick-public-code -- --out documentation/uptick-public-code-search.json
```

Treat public-code results as hints only; tenant discovery is the authoritative
path when credentials are available.

### Auth

Tokens map to users. Pass them as `Authorization: Bearer <token>` or `Authorization: token <token>`. When no tokens are configured, a default `test_token_admin` is created for the `admin` user.

Each service also has a fallback user. If no token is provided, requests authenticate as the first seeded user.

## HTTPS with portless

[portless](https://github.com/vercel-labs/portless) gives emulators trusted HTTPS URLs with auto-generated certs. Use the `--portless` flag to auto-register each service as a portless alias:

```bash
npx agent-emulate start --portless
# github  https://github.emulate.localhost
# google  https://google.emulate.localhost
# ...
```

This requires the portless proxy to be running (`portless proxy start`). If portless is not installed, agent-emulate will prompt to install it.

The `--portless` flag overwrites any existing portless aliases matching `*.emulate`. Aliases are removed automatically when agent-emulate shuts down.

For a single service behind portless:

```bash
portless github.emulate agent-emulate start --service github
```

For a custom base URL without portless (any reverse proxy):

```bash
npx agent-emulate start --base-url "https://{service}.myproxy.test"
# or
EMULATE_BASE_URL="https://{service}.myproxy.test" npx agent-emulate start
```

The `PORTLESS_URL` env var is automatically set by the `portless` CLI wrapper when running a command through it (e.g. `portless github.emulate agent-emulate start`), typically to a value like `https://{service}.emulate.localhost`. It supports `{service}` interpolation, just like `--base-url` and `EMULATE_BASE_URL`. When no explicit `baseUrl` is provided, it is used as a fallback.

Per-service overrides in the seed config (these take highest priority over all other base URL sources):

```yaml
github:
  baseUrl: https://github.emulate.localhost
google:
  baseUrl: https://google.emulate.localhost
```

## Pointing Your App at the Emulator

Set environment variables to override real service URLs:

```bash
VERCEL_EMULATOR_URL=http://localhost:4000
GITHUB_EMULATOR_URL=http://localhost:4001
GOOGLE_EMULATOR_URL=http://localhost:4002
SLACK_EMULATOR_URL=http://localhost:4003
APPLE_EMULATOR_URL=http://localhost:4004
MICROSOFT_EMULATOR_URL=http://localhost:4005
AWS_EMULATOR_URL=http://localhost:4006
```

Then use these in your app to construct API and OAuth URLs. See each service's skill for SDK-specific override instructions.

## Next.js Integration (Embedded Mode)

The `@emulators/adapter-next` package embeds emulators directly into a Next.js app on the same origin. See the **next** skill (`skills/next/SKILL.md`) for full setup, Auth.js configuration, persistence, and font tracing details.

## Persistence

By default, all emulator state is in-memory. For persistence across process restarts and serverless cold starts, use a `PersistenceAdapter`.

### Built-in file persistence

```typescript
import { filePersistence } from '@emulators/core'

// CLI or local dev: persists to a JSON file
const adapter = filePersistence('.emulate/state.json')
```

### Custom adapters

```typescript
import type { PersistenceAdapter } from '@emulators/core'

const kvAdapter: PersistenceAdapter = {
  async load() { return await kv.get('emulate-state') },
  async save(data) { await kv.set('emulate-state', data) },
}
```

State is loaded on cold start and saved after every mutating request (POST, PUT, PATCH, DELETE). Saves are serialized to prevent race conditions.

## Architecture

```
packages/
  emulate/           # CLI entry point + programmatic API
  @emulators/
    core/            # HTTP server (Hono), Store, plugin interface, middleware
    adapter-next/    # Next.js App Router integration
    vercel/          # Vercel API service plugin
    github/          # GitHub API service plugin
    google/          # Google OAuth 2.0 / OIDC plugin
    slack/           # Slack Web API, OAuth, incoming webhooks plugin
    apple/           # Sign in with Apple / OIDC plugin
    microsoft/       # Microsoft Entra ID OAuth 2.0 / OIDC plugin
    aws/             # AWS S3, SQS, IAM, STS plugin
```

The core provides a generic `Store` with typed `Collection<T>` instances supporting CRUD, indexing, filtering, and pagination. Each service plugin registers routes on the shared Hono app and uses the store for state.
