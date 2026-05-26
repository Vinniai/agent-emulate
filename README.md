# agent-emulate

Local drop-in replacement services for CI and no-network sandboxes. Fully stateful, production-fidelity API emulation. Not mocks.

## The three pillars

agent-emulate is built around one idea: **emulate the auth, simulate the activity, and act as a proxy for the providers** — so your downstream app can talk to one local deployment instead of dozens of real SaaS APIs.

1. **Emulate auth.** Real OAuth 2.0 / OIDC flows: authorize → code exchange → RS256 ID tokens signed by a published JWKS, access-token expiry, and the standard refresh round-trip. Your app's sign-in code runs unmodified. For a runnable, separate-process proof — OIDC discovery, code exchange, `jose` JWKS verification, expiry → refresh, and a cross-provider authenticated read — run `pnpm --filter api-emulators-quickstart external-consumer` ([source](./examples/api-emulators-quickstart/)).

2. **Simulate activity.** Static fixtures become *living* ones. [`agent-emulate-sim`](./packages/@emulators/simulator/) is an external driver that streams new records and events into a running deployment over time — emails into an inbox, Teams/WhatsApp messages, Drive files, Calendar events — and can drive native emulators directly so each emulator's own webhook dispatch fires on a schedule.

3. **Proxy for providers.** One deployable server ([`apps/server`](./apps/server/)) multiplexes every emulator behind a single origin. Point a real vendor SDK at it — path-routed (`/<service>/*`) or, for prefix-less SDKs (Stripe, Salesforce, Xero, QuickBooks, WorkOS), at the bare origin — and it forwards transparently. State [survives a restart](./apps/server/README.md#persistence-survive-a-restart) via a snapshot file.

**Examples as the spine:** [`examples/oauth`](./examples/oauth/) (raw OAuth flow), [`examples/nextjs-embedded`](./examples/nextjs-embedded/) (embedded in a Next.js app), [`examples/api-emulators-quickstart`](./examples/api-emulators-quickstart/) (the external-consumer proof + narrated per-provider walkthroughs).

## Quick Start

```bash
npx agent-emulate
```

All services start with sensible defaults. No config file needed:

- **Vercel** on `http://localhost:4000`
- **GitHub** on `http://localhost:4001`
- **Google** on `http://localhost:4002`
- **Slack** on `http://localhost:4003`
- **Apple** on `http://localhost:4004`
- **Microsoft** on `http://localhost:4005`
- **AWS** on `http://localhost:4006`

## CLI

```bash
# Start all services (zero-config)
npx agent-emulate

# Start specific services
npx agent-emulate --service vercel,github

# Custom port
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

## HTTPS with portless

[portless](https://github.com/vercel-labs/portless) gives emulators trusted HTTPS URLs with auto-generated certs and no browser warnings.

```bash
# Start the portless proxy (first time only)
portless proxy start

# Start agent-emulate with portless integration
npx agent-emulate start --portless
```

Each service registers as a portless alias and gets a named HTTPS URL:

```
github  https://github.emulate.localhost
google  https://google.emulate.localhost
slack   https://slack.emulate.localhost
```

If portless is not installed, agent-emulate will prompt to install it (`npm i -g portless`).

The `--portless` flag overwrites any existing portless aliases matching `*.emulate`. Aliases are removed automatically when agent-emulate shuts down.

For a custom base URL without portless (any reverse proxy), use `--base-url` or the `EMULATE_BASE_URL` env var:

```bash
npx agent-emulate start --base-url "https://{service}.myproxy.test"
```

The `PORTLESS_URL` env var is automatically set by the `portless` CLI wrapper when running a command through it (e.g. `portless github.emulate agent-emulate start`), typically to a value like `https://{service}.emulate.localhost`. It supports `{service}` interpolation, just like `--base-url` and `EMULATE_BASE_URL`. When no explicit `baseUrl` is provided, it is used as a fallback.

Per-service overrides are also supported in the seed config (these take highest priority over all other base URL sources):

```yaml
github:
  baseUrl: https://github.emulate.localhost
```

## Programmatic API

```bash
npm install agent-emulate
```

Each call to `createEmulator` starts a single service:

```typescript
import { createEmulator } from 'agent-emulate'

const github = await createEmulator({ service: 'github', port: 4001 })
const vercel = await createEmulator({ service: 'vercel', port: 4002 })

github.url   // 'http://localhost:4001'
vercel.url   // 'http://localhost:4002'

await github.close()
await vercel.close()
```

### Vitest / Jest setup

```typescript
// vitest.setup.ts
import { createEmulator, type Emulator } from 'agent-emulate'

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

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `service` | *(required)* | Service name: `'vercel'`, `'github'`, `'google'`, `'slack'`, `'apple'`, `'microsoft'`, or `'aws'` |
| `port` | `4000` | Port for the HTTP server |
| `seed` | none | Inline seed data (same shape as YAML config) |
| `baseUrl` | none | Override advertised base URL. Per-service `baseUrl` in seed config takes highest priority, then this option, then `EMULATE_BASE_URL` env var (supports `{service}`), then `PORTLESS_URL` (supports `{service}`, automatically set by the `portless` CLI wrapper), then `http://localhost:<port>`. |

### Instance methods

| Method | Description |
|--------|-------------|
| `url` | Base URL of the running server |
| `reset()` | Wipe the store and replay seed data |
| `close()` | Shut down the HTTP server, returns a Promise |

### In-process mocking with MSW (no server, no ports)

For unit/component tests where a separate server process is overkill,
[`@emulators/msw`](./packages/@emulators/msw/) turns any provider plugin into
[Mock Service Worker](https://github.com/mswjs/msw) request handlers that run the
emulators **in-process**. Each provider gets **its own origin** — its own port
(`http://localhost:4000`, `:4001`, …) or, with `portless`, its own subdomain
(`https://google.emulate.localhost`) — the exact addressing `agent-emulate start`
uses. Point your SDKs at the same URL as the live server; nothing else changes:

```typescript
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { emulateHandlers } from '@emulators/msw'
import { googlePlugin } from '@emulators/google'
import { stripePlugin } from '@emulators/stripe'

// google → http://localhost:4000, stripe → http://localhost:4001 (base port + index).
const { handlers, services } = emulateHandlers({
  services: { google: googlePlugin, stripe: stripePlugin },
})
const google = services.get('google')!.baseUrl // 'http://localhost:4000'

// emulate owns the providers; ordinary MSW handlers own everything else.
const server = setupServer(
  ...handlers,
  http.get('https://api.myapp.com/me', () => HttpResponse.json({ id: 'u_1' })),
)
server.listen({ onUnhandledRequest: 'bypass' })

// Per-test overrides still win — force a 500, an empty list, a malformed payload:
server.use(http.get(`${google}/oauth2/v3/certs`,
  () => HttpResponse.json({ keys: [] }, { status: 503 })))
```

Prefer portless subdomains instead of ports? Pass `portless: true` and each
service mounts at `https://<name>.emulate.localhost`. Override any single
service's origin with `baseUrls: { google: 'http://localhost:9000' }`.

agent-emulate and MSW compose at different layers — let emulate own the stateful
OAuth dance + provider data, and use MSW for per-test edge cases and your own API.
Interactive redirect-login screens still need the live server (no separate origin
to navigate to in-process). See the [`@emulators/msw` README](./packages/@emulators/msw/README.md)
for browser (`setupWorker`) usage and the full option reference.

## Configuration

Configuration is optional. The CLI auto-detects config files in this order: `emulate.config.yaml` / `.yml`, `emulate.config.json`, `service-emulator.config.yaml` / `.yml`, `service-emulator.config.json`. Or pass `--seed <file>` explicitly. Run `npx agent-emulate init` to generate a starter file.

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

google:
  users:
    - email: testuser@agent-emulate.dev
      name: Test User
    - email: admin@agent-emulate.dev
      name: Admin
      hd: agent-emulate.dev
  oauth_clients:
    - client_id: my-client-id.apps.googleusercontent.com
      client_secret: GOCSPX-secret
      redirect_uris:
        - http://localhost:3000/api/auth/callback/google
  labels:
    - id: Label_ops
      user_email: testuser@agent-emulate.dev
      name: Ops/Review
      color_background: "#DDEEFF"
      color_text: "#111111"
  messages:
    - id: msg_welcome
      user_email: testuser@agent-emulate.dev
      from: welcome@agent-emulate.dev
      to: testuser@agent-emulate.dev
      subject: Welcome to the Gmail emulator
      body_text: You can now test Gmail, Calendar, and Drive flows locally.
      label_ids: [INBOX, UNREAD, CATEGORY_UPDATES]
  calendars:
    - id: primary
      user_email: testuser@agent-emulate.dev
      summary: testuser@agent-emulate.dev
      primary: true
      selected: true
      time_zone: UTC
  calendar_events:
    - id: evt_kickoff
      user_email: testuser@agent-emulate.dev
      calendar_id: primary
      summary: Project Kickoff
      start_date_time: 2025-01-10T09:00:00.000Z
      end_date_time: 2025-01-10T09:30:00.000Z
  drive_items:
    - id: drv_docs
      user_email: testuser@agent-emulate.dev
      name: Docs
      mime_type: application/vnd.google-apps.folder
      parent_ids: [root]

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
    - name: random
      topic: Random stuff
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
      - name: my-app-uploads
  sqs:
    queues:
      - name: my-app-events
      - name: my-app-dlq
  iam:
    users:
      - user_name: developer
        create_access_key: true
    roles:
      - role_name: lambda-execution-role
        description: Role for Lambda function execution

simpro:
  swagger_records:
    /api/v1.0/companies/0/catalogGroups/:
      - ID: 77
        Name: Seeded catalog group
        DisplayOrder: 2
```

SimPro `swagger_records` seeds any spec-only collection covered by the bundled
Swagger file. Use the concrete API collection path as the key, including parent
ids, and the emulator will serve those rows from list and detail routes. Writes
to spec-only routes are exported back into the same shape by `storeToSeedConfig`.

### Source parity audits

Provider source tracking lives in
[`documentation/emulator-source-map.json`](./documentation/emulator-source-map.json).
Run `pnpm audit:sources` to see which emulators are backed by a vendored spec,
official machine-readable docs, official human docs, or seed-derived native
paths. SimPro is currently the only full vendored Swagger fallback. Uptick is
checked against the official v2 JSON:API docs and now exposes self-describing
`OPTIONS` metadata for its supported resources.

For Uptick, the exact endpoint catalogue must come from an authorized tenant
because their public docs say the live API root and `OPTIONS` metadata are the
documentation. Use:

```bash
pnpm discover:uptick -- --base-url https://tenant.onuptick.com --token "$UPTICK_ACCESS_TOKEN" --out documentation/uptick-discovery.json
```

or set `UPTICK_USERNAME`, `UPTICK_PASSWORD`, `UPTICK_CLIENT_ID`, and
`UPTICK_CLIENT_SECRET` to have the script request a token first. Only run this
against a tenant you are authorized to access.

Public GitHub code can provide hints, but it is not authoritative. With a
GitHub token, run:

```bash
GITHUB_TOKEN=ghp_... pnpm search:uptick-public-code -- --out documentation/uptick-public-code-search.json
```

## OAuth & Integrations

The emulator supports configurable OAuth apps and integrations with strict client validation.

### Vercel Integrations

```yaml
vercel:
  integrations:
    - client_id: "oac_abc123"
      client_secret: "secret_abc123"
      name: "My Vercel App"
      redirect_uris:
        - "http://localhost:3000/api/auth/callback/vercel"
```

### GitHub OAuth Apps

```yaml
github:
  oauth_apps:
    - client_id: "Iv1.abc123"
      client_secret: "secret_abc123"
      name: "My Web App"
      redirect_uris:
        - "http://localhost:3000/api/auth/callback/github"
```

If no `oauth_apps` are configured, the emulator accepts any `client_id` (backward-compatible). With apps configured, strict validation is enforced.

### GitHub Apps

Full GitHub App support with JWT authentication and installation access tokens:

```yaml
github:
  apps:
    - app_id: 12345
      slug: "my-github-app"
      name: "My GitHub App"
      private_key: |
        -----BEGIN RSA PRIVATE KEY-----
        ...your PEM key...
        -----END RSA PRIVATE KEY-----
      permissions:
        contents: read
        issues: write
      events: [push, pull_request]
      webhook_url: "http://localhost:3000/webhooks/github"
      webhook_secret: "my-secret"
      installations:
        - installation_id: 100
          account: my-org
          repository_selection: all
```

JWT authentication: sign a JWT with `{ iss: "<app_id>" }` using the app's private key (RS256). The emulator verifies the signature and resolves the app.

**App webhook delivery**: When events occur on repos where a GitHub App is installed, the emulator mirrors real GitHub behavior:
- All webhook payloads (including repo and org hooks) include an `installation` field with `{ id, node_id }`.
- If the app has a `webhook_url`, the emulator delivers the event there with the `installation` field and (if configured) an `X-Hub-Signature-256` header signed with `webhook_secret`.

### Slack OAuth Apps

```yaml
slack:
  oauth_apps:
    - client_id: "12345.67890"
      client_secret: "example_client_secret"
      name: "My Slack App"
      redirect_uris:
        - "http://localhost:3000/api/auth/callback/slack"
```

### Apple OAuth Clients

```yaml
apple:
  oauth_clients:
    - client_id: "com.example.app"
      team_id: "TEAM001"
      name: "My Apple App"
      redirect_uris:
        - "http://localhost:3000/api/auth/callback/apple"
```

### Microsoft OAuth Clients

```yaml
microsoft:
  oauth_clients:
    - client_id: "example-client-id"
      client_secret: "example-client-secret"
      name: "My Microsoft App"
      redirect_uris:
        - "http://localhost:3000/api/auth/callback/microsoft-entra-id"
```

## Vercel API

Every endpoint below is fully stateful with Vercel-style JSON responses and cursor-based pagination.

### User & Teams
- `GET /v2/user` - authenticated user
- `PATCH /v2/user` - update user
- `GET /v2/teams` - list teams (cursor paginated)
- `GET /v2/teams/:teamId` - get team (by ID or slug)
- `POST /v2/teams` - create team
- `PATCH /v2/teams/:teamId` - update team
- `GET /v2/teams/:teamId/members` - list members
- `POST /v2/teams/:teamId/members` - add member

### Projects
- `POST /v11/projects` - create project (with optional env vars and git integration)
- `GET /v10/projects` - list projects (search, cursor pagination)
- `GET /v9/projects/:idOrName` - get project (includes env vars)
- `PATCH /v9/projects/:idOrName` - update project
- `DELETE /v9/projects/:idOrName` - delete project (cascades)
- `GET /v1/projects/:projectId/promote/aliases` - promote aliases status
- `PATCH /v1/projects/:idOrName/protection-bypass` - manage bypass secrets

### Deployments
- `POST /v13/deployments` - create deployment (auto-transitions to READY)
- `GET /v13/deployments/:idOrUrl` - get deployment (by ID or URL)
- `GET /v6/deployments` - list deployments (filter by project, target, state)
- `DELETE /v13/deployments/:id` - delete deployment (cascades)
- `PATCH /v12/deployments/:id/cancel` - cancel building deployment
- `GET /v2/deployments/:id/aliases` - list deployment aliases
- `GET /v3/deployments/:idOrUrl/events` - get build events/logs
- `GET /v6/deployments/:id/files` - list deployment files
- `POST /v2/files` - upload file (by SHA digest)

### Domains
- `POST /v10/projects/:idOrName/domains` - add domain (with verification challenge)
- `GET /v9/projects/:idOrName/domains` - list domains
- `GET /v9/projects/:idOrName/domains/:domain` - get domain
- `PATCH /v9/projects/:idOrName/domains/:domain` - update domain
- `DELETE /v9/projects/:idOrName/domains/:domain` - remove domain
- `POST /v9/projects/:idOrName/domains/:domain/verify` - verify domain

### Environment Variables
- `GET /v10/projects/:idOrName/env` - list env vars (with decrypt option)
- `POST /v10/projects/:idOrName/env` - create env vars (single, batch, upsert)
- `GET /v10/projects/:idOrName/env/:id` - get env var
- `PATCH /v9/projects/:idOrName/env/:id` - update env var
- `DELETE /v9/projects/:idOrName/env/:id` - delete env var

## GitHub API

Every endpoint below is fully stateful. Creates, updates, and deletes persist in memory and affect related entities.

### Users
- `GET /user` - authenticated user
- `PATCH /user` - update profile
- `GET /users/:username` - get user
- `GET /users` - list users
- `GET /users/:username/repos` - list user repos
- `GET /users/:username/orgs` - list user orgs
- `GET /users/:username/followers` - list followers
- `GET /users/:username/following` - list following

### Repositories
- `GET /repos/:owner/:repo` - get repo
- `POST /user/repos` - create user repo
- `POST /orgs/:org/repos` - create org repo
- `PATCH /repos/:owner/:repo` - update repo
- `DELETE /repos/:owner/:repo` - delete repo (cascades)
- `GET/PUT /repos/:owner/:repo/topics` - get/replace topics
- `GET /repos/:owner/:repo/languages` - languages
- `GET /repos/:owner/:repo/contributors` - contributors
- `GET /repos/:owner/:repo/forks` - list forks
- `POST /repos/:owner/:repo/forks` - create fork
- `GET/PUT/DELETE /repos/:owner/:repo/collaborators/:username` - collaborators
- `GET /repos/:owner/:repo/collaborators/:username/permission`
- `POST /repos/:owner/:repo/transfer` - transfer repo
- `GET /repos/:owner/:repo/tags` - list tags

### Issues
- `GET /repos/:owner/:repo/issues` - list (filter by state, labels, assignee, milestone, creator, since)
- `POST /repos/:owner/:repo/issues` - create
- `GET /repos/:owner/:repo/issues/:number` - get
- `PATCH /repos/:owner/:repo/issues/:number` - update (state transitions, events)
- `PUT/DELETE /repos/:owner/:repo/issues/:number/lock` - lock/unlock
- `GET /repos/:owner/:repo/issues/:number/timeline` - timeline events
- `GET /repos/:owner/:repo/issues/:number/events` - events
- `POST/DELETE /repos/:owner/:repo/issues/:number/assignees` - manage assignees

### Pull Requests
- `GET /repos/:owner/:repo/pulls` - list (filter by state, head, base)
- `POST /repos/:owner/:repo/pulls` - create
- `GET /repos/:owner/:repo/pulls/:number` - get
- `PATCH /repos/:owner/:repo/pulls/:number` - update
- `PUT /repos/:owner/:repo/pulls/:number/merge` - merge (with branch protection enforcement)
- `GET /repos/:owner/:repo/pulls/:number/commits` - list commits
- `GET /repos/:owner/:repo/pulls/:number/files` - list files
- `POST/DELETE /repos/:owner/:repo/pulls/:number/requested_reviewers` - manage reviewers
- `PUT /repos/:owner/:repo/pulls/:number/update-branch` - update branch

### Comments
- Issue comments: full CRUD on `/repos/:owner/:repo/issues/:number/comments`
- Review comments: full CRUD on `/repos/:owner/:repo/pulls/:number/comments`
- Commit comments: full CRUD on `/repos/:owner/:repo/commits/:sha/comments`
- Repo-wide listings for each type

### Reviews
- `GET /repos/:owner/:repo/pulls/:number/reviews` - list
- `POST /repos/:owner/:repo/pulls/:number/reviews` - create (with inline comments)
- `GET/PUT /repos/:owner/:repo/pulls/:number/reviews/:id` - get/update
- `POST /repos/:owner/:repo/pulls/:number/reviews/:id/events` - submit
- `PUT /repos/:owner/:repo/pulls/:number/reviews/:id/dismissals` - dismiss

### Labels & Milestones
- Labels: full CRUD, add/remove from issues, replace all
- Milestones: full CRUD, state transitions, issue counts

### Branches & Git Data
- Branches: list, get, protection CRUD (status checks, PR reviews, enforce admins)
- Refs: get, match, create, update, delete
- Commits: get, create
- Trees: get (with recursive), create (with inline content)
- Blobs: get, create
- Tags: get, create

### Organizations & Teams
- Orgs: get, update, list
- Org members: list, check, remove, get/set membership
- Teams: full CRUD, members, repos

### Releases
- Releases: full CRUD, latest, by tag
- Release assets: full CRUD, upload
- Generate release notes

### Webhooks
- Repo webhooks: full CRUD, ping, test, deliveries
- Org webhooks: full CRUD, ping
- Real HTTP delivery to registered URLs on all state changes

### Search
- `GET /search/repositories` - full query syntax (user, org, language, topic, stars, forks, etc.)
- `GET /search/issues` - issues + PRs (repo, is, author, label, milestone, state, etc.)
- `GET /search/users` - users + orgs
- `GET /search/code` - blob content search
- `GET /search/commits` - commit message search
- `GET /search/topics` - topic search
- `GET /search/labels` - label search

### Actions
- Workflows: list, get, enable/disable, dispatch
- Workflow runs: list, get, cancel, rerun, delete, logs
- Jobs: list, get, logs
- Artifacts: list, get, delete
- Secrets: repo + org CRUD

### Checks
- Check runs: create, update, get, annotations, rerequest, list by ref/suite
- Check suites: create, get, preferences, rerequest, list by ref
- Automatic suite status rollup from check run results

### Misc
- `GET /rate_limit` - rate limit status
- `GET /meta` - server metadata
- `GET /octocat` - ASCII art
- `GET /emojis` - emoji URLs
- `GET /zen` - random zen phrase
- `GET /versions` - API versions

## Google OAuth + Gmail, Calendar, and Drive APIs

OAuth 2.0, OpenID Connect, and mutable Google Workspace-style surfaces for local inbox, calendar, and drive flows.

- `GET /o/oauth2/v2/auth` - authorization endpoint
- `POST /oauth2/token` - token exchange
- `GET /oauth2/v2/userinfo` - get user info
- `GET /.well-known/openid-configuration` - OIDC discovery document
- `GET /oauth2/v3/certs` - JSON Web Key Set (JWKS)
- `GET /gmail/v1/users/:userId/messages` - list messages with `q`, `labelIds`, `maxResults`, and `pageToken`
- `GET /gmail/v1/users/:userId/messages/:id` - fetch a Gmail-style message payload in `full`, `metadata`, `minimal`, or `raw` formats
- `GET /gmail/v1/users/:userId/messages/:messageId/attachments/:id` - fetch attachment bodies
- `POST /gmail/v1/users/:userId/messages/send` - create sent mail from `raw` MIME or structured fields
- `POST /gmail/v1/users/:userId/messages/import` - import inbox mail
- `POST /gmail/v1/users/:userId/messages` - insert a message directly
- `POST /gmail/v1/users/:userId/messages/:id/modify` - add/remove labels on one message
- `POST /gmail/v1/users/:userId/messages/batchModify` - add/remove labels across many messages
- `POST /gmail/v1/users/:userId/messages/:id/trash` and `POST /gmail/v1/users/:userId/messages/:id/untrash`
- `GET /gmail/v1/users/:userId/drafts`, `POST /gmail/v1/users/:userId/drafts`, `GET /gmail/v1/users/:userId/drafts/:id`, `PUT /gmail/v1/users/:userId/drafts/:id`, `POST /gmail/v1/users/:userId/drafts/:id/send`, `DELETE /gmail/v1/users/:userId/drafts/:id`
- `POST /gmail/v1/users/:userId/threads/:id/modify` - add/remove labels across a thread
- `GET /gmail/v1/users/:userId/threads` and `GET /gmail/v1/users/:userId/threads/:id`
- `GET /gmail/v1/users/:userId/labels`, `POST /gmail/v1/users/:userId/labels`, `PATCH /gmail/v1/users/:userId/labels/:id`, `DELETE /gmail/v1/users/:userId/labels/:id`
- `GET /gmail/v1/users/:userId/history`, `POST /gmail/v1/users/:userId/watch`, `POST /gmail/v1/users/:userId/stop`
- `GET /gmail/v1/users/:userId/settings/filters`, `POST /gmail/v1/users/:userId/settings/filters`, `DELETE /gmail/v1/users/:userId/settings/filters/:id`
- `GET /gmail/v1/users/:userId/settings/forwardingAddresses`, `GET /gmail/v1/users/:userId/settings/sendAs`
- `GET /calendar/v3/users/:userId/calendarList`, `GET /calendar/v3/calendars/:calendarId/events`, `POST /calendar/v3/calendars/:calendarId/events`, `DELETE /calendar/v3/calendars/:calendarId/events/:eventId`, `POST /calendar/v3/freeBusy`
- `GET /drive/v3/files`, `GET /drive/v3/files/:fileId`, `POST /drive/v3/files`, `PATCH /drive/v3/files/:fileId`, `PUT /drive/v3/files/:fileId`, `POST /upload/drive/v3/files`

## Slack API

Fully stateful Slack Web API emulation with channels, messages, threads, reactions, OAuth v2, and incoming webhooks.

### Auth & Chat
- `POST /api/auth.test` - test authentication
- `POST /api/chat.postMessage` - post message (supports threads via `thread_ts`)
- `POST /api/chat.update` - update message
- `POST /api/chat.delete` - delete message
- `POST /api/chat.meMessage` - /me message

### Conversations
- `POST /api/conversations.list` - list channels (cursor pagination)
- `POST /api/conversations.info` - get channel info
- `POST /api/conversations.create` - create channel
- `POST /api/conversations.history` - channel history
- `POST /api/conversations.replies` - thread replies
- `POST /api/conversations.join` / `conversations.leave` - join/leave
- `POST /api/conversations.members` - list members

### Users & Reactions
- `POST /api/users.list` - list users (cursor pagination)
- `POST /api/users.info` - get user info
- `POST /api/users.lookupByEmail` - lookup by email
- `POST /api/reactions.add` / `reactions.remove` / `reactions.get` - manage reactions

### Team, Bots & Webhooks
- `POST /api/team.info` - workspace info
- `POST /api/bots.info` - bot info
- `POST /services/:teamId/:botId/:webhookId` - incoming webhook

### OAuth
- `GET /oauth/v2/authorize` - authorization (shows user picker)
- `POST /api/oauth.v2.access` - token exchange

## Apple Sign In

Sign in with Apple emulation with authorization code flow, PKCE support, RS256 ID tokens, and OIDC discovery.

- `GET /.well-known/openid-configuration` - OIDC discovery document
- `GET /auth/keys` - JSON Web Key Set (JWKS)
- `GET /auth/authorize` - authorization endpoint (shows user picker)
- `POST /auth/token` - token exchange (authorization code and refresh token grants)
- `POST /auth/revoke` - token revocation

## Microsoft Entra ID

Microsoft Entra ID (Azure AD) v2.0 OAuth 2.0 and OpenID Connect emulation with authorization code flow, PKCE, client credentials, RS256 ID tokens, and OIDC discovery.

- `GET /.well-known/openid-configuration` - OIDC discovery document
- `GET /:tenant/v2.0/.well-known/openid-configuration` - tenant-scoped OIDC discovery
- `GET /discovery/v2.0/keys` - JSON Web Key Set (JWKS)
- `GET /oauth2/v2.0/authorize` - authorization endpoint (shows user picker)
- `POST /oauth2/v2.0/token` - token exchange (authorization code, refresh token, client credentials)
- `GET /oidc/userinfo` - OpenID Connect user info
- `GET /v1.0/me` - Microsoft Graph user profile
- `GET /oauth2/v2.0/logout` - end session / logout
- `POST /oauth2/v2.0/revoke` - token revocation

## WorkOS

WorkOS AuthKit and User Management emulation — SSO/OAuth sign-in, organizations, users, memberships, invitations and sessions, plus org and user lifecycle webhook events for keeping a downstream tenant model in sync. WorkOS SDKs are prefix-less, so point them at the bare origin (or `/workos/*` through the proxy server).

### Authentication & SSO

- `GET /.well-known/openid-configuration` - OIDC discovery document
- `GET /sso/jwks/:clientId` - JSON Web Key Set (JWKS)
- `GET /user_management/authorize` - AuthKit authorization endpoint (shows user picker)
- `POST /user_management/authenticate` - authenticate with a grant
- `POST /user_management/authenticate/code` - exchange an authorization code
- `POST /user_management/authenticate/password` - password grant
- `POST /user_management/authenticate/refresh` - refresh-token grant
- `POST /user_management/authenticate/organization_selection` - complete organization selection
- `POST /user_management/authorize/callback` - authorization callback

### Organizations, users & memberships

- `GET` / `POST /user_management/organizations`, `GET /user_management/organizations/:id` - organizations
- `GET` / `POST /user_management/users`, `GET` / `PUT` / `DELETE /user_management/users/:id` - users
- `GET` / `POST /user_management/organization_memberships`, `GET` / `DELETE /user_management/organization_memberships/:id` - memberships
- `GET /user_management/users/:userId/organization_memberships` - a user's memberships
- `GET` / `POST /user_management/invitations`, `DELETE /user_management/invitations/:id` - invitations
- `GET` / `DELETE /user_management/sessions/:id` - sessions

Management routes are open by default. Set `EMULATE_WORKOS_REQUIRE_AUTH=1` (or `EMULATE_REQUIRE_AUTH=1`) to reject tokenless calls with a real `401`, while `authorize` / `authenticate`, discovery, JWKS and health stay open so a token can still be obtained.

### Lifecycle webhook events

Creating, updating, or deleting through the management API emits a WorkOS-shaped webhook event, so a downstream sync (for example a Convex tenant model) can subscribe and stay in step:

- `organization.created`
- `user.created`, `user.updated`, `user.deleted`
- `organization_membership.created`, `organization_membership.deleted`

Each event uses the real WorkOS envelope — `{ id, event, data, created_at }` — and is delivered through the emulator's webhook dispatch. Delivery is best-effort and fire-and-forget: a missing subscriber never breaks the API call that triggered the event.

- `POST /webhooks/test` - deliver a signed test event to a `target` URL (HMAC-signed `workos-signature` header)

## AWS

S3, SQS, IAM, and STS emulation with AWS SDK-compatible S3 paths and query-style SQS/IAM/STS endpoints. All responses use AWS-compatible XML.

### S3

S3 routes use root paths matching the real AWS S3 wire format, so the official AWS SDK works out of the box with `forcePathStyle: true`. Legacy `/s3/` prefixed paths are also supported for backward compatibility.

- `GET /` - list all buckets
- `PUT /:bucket` - create bucket
- `DELETE /:bucket` - delete bucket
- `HEAD /:bucket` - check existence
- `GET /:bucket` - list objects (prefix, delimiter, max-keys, continuation-token, start-after)
- `POST /:bucket` - presigned POST upload (browser-style multipart form with policy validation)
- `PUT /:bucket/:key` - put object (supports copy via `x-amz-copy-source`)
- `GET /:bucket/:key` - get object
- `HEAD /:bucket/:key` - head object
- `DELETE /:bucket/:key` - delete object

### SQS
All operations via `POST /sqs/` with `Action` parameter:
- `CreateQueue`, `ListQueues`, `GetQueueUrl`, `GetQueueAttributes`
- `SendMessage`, `ReceiveMessage`, `DeleteMessage`
- `PurgeQueue`, `DeleteQueue`

### IAM
All operations via `POST /iam/` with `Action` parameter:
- `CreateUser`, `GetUser`, `ListUsers`, `DeleteUser`
- `CreateAccessKey`, `ListAccessKeys`, `DeleteAccessKey`
- `CreateRole`, `GetRole`, `ListRoles`, `DeleteRole`

### STS
All operations via `POST /sts/` with `Action` parameter:
- `GetCallerIdentity`, `AssumeRole`

## Next.js Integration

Embed emulators directly in your Next.js app so they run on the same origin. This solves the Vercel preview deployment problem where OAuth callback URLs change with every deployment.

### Install

```bash
npm install @emulators/adapter-next @emulators/github @emulators/google
```

Only install the emulators you need. Each `@emulators/*` package is published independently.

### Route handler

Create a catch-all route that serves emulator traffic:

```typescript
// app/emulate/[...path]/route.ts
import { createEmulateHandler } from '@emulators/adapter-next'
import * as github from '@emulators/github'
import * as google from '@emulators/google'

export const { GET, POST, PUT, PATCH, DELETE } = createEmulateHandler({
  services: {
    github: {
      emulator: github,
      seed: {
        users: [{ login: 'octocat', name: 'The Octocat' }],
        repos: [{ owner: 'octocat', name: 'hello-world', auto_init: true }],
      },
    },
    google: {
      emulator: google,
      seed: {
        users: [{ email: 'test@agent-emulate.dev', name: 'Test User' }],
      },
    },
  },
})
```

### Auth.js / NextAuth configuration

Point your provider at the emulator paths on the same origin:

```typescript
import GitHub from 'next-auth/providers/github'

const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000'

GitHub({
  clientId: 'any-value',
  clientSecret: 'any-value',
  authorization: { url: `${baseUrl}/emulate/github/login/oauth/authorize` },
  token: { url: `${baseUrl}/emulate/github/login/oauth/access_token` },
  userinfo: { url: `${baseUrl}/emulate/github/user` },
})
```

No `oauth_apps` need to be seeded. When none are configured, the emulator skips `client_id`, `client_secret`, and `redirect_uri` validation.

For OpenID Connect providers (Google, Okta, …) you only override the `issuer` — agent-emulate serves a real discovery document, an RS256-signed `id_token`, and a live JWKS, so Auth.js / openid-client verify it exactly as they would the real provider:

```typescript
import Google from 'next-auth/providers/google'

Google({
  clientId: 'any-value',
  clientSecret: 'any-value',
  issuer: 'http://localhost:4000/google', // ← agent-emulate, not accounts.google.com
})
```

Access tokens expire (`EMULATE_GOOGLE_TOKEN_TTL`, default 1h) and drive the standard refresh flow; set `EMULATE_AUTH_LAX=1` to disable expiry in tests. For a runnable, separate-process proof of this whole path — OIDC discovery, code exchange, `jose` JWKS verification, token expiry → refresh, and a cross-provider authenticated read — run `pnpm --filter api-emulators-quickstart external-consumer` (see [`examples/api-emulators-quickstart`](./examples/api-emulators-quickstart/#external-consumer-proof--point-your-app-at-emulate)).

### Production-like hardening (opt-in)

By default the emulators are permissive so zero-setup demos and CI smoke tests just work. Three opt-in switches make them behave like production when you want to exercise an app's failure paths — all **off by default** (no behaviour change unless you set them) and overridden globally by `EMULATE_AUTH_LAX=1`:

| Switch | Effect |
| --- | --- |
| `EMULATE_<PROVIDER>_REQUIRE_AUTH=1` | The provider's data routes reject unauthenticated calls with a real `401` (drives your auth/refresh path). Wired for `STRIPE`, `RESEND`, `UPTICK`, `AWS`, `WORKOS`. OAuth/token, discovery, JWKS, health and inspector stay open. |
| `EMULATE_REQUIRE_AUTH=1` | Umbrella — enables the above for every wired provider at once. |
| `EMULATE_MULTI_TENANT=1` | Each request is isolated by the `X-Emulate-Tenant` header — every tenant gets its own backing store, so two orgs hitting the same emulator never see each other's data. Absent header → the `default` tenant (single-tenant behaviour). |

```bash
# Reject tokenless Stripe calls; isolate data per tenant
EMULATE_STRIPE_REQUIRE_AUTH=1 EMULATE_MULTI_TENANT=1 npx agent-emulate start
curl -H 'X-Emulate-Tenant: acme'   .../v1/customers   # acme's data only
```

Programmatically the same is available via `createServer(plugin, { multiTenant: true })` and the `requireAuthWhen(...flags)` / `requireScope(...scopes)` middleware exported from `@emulators/core`.

For the whole picture end to end — WorkOS sign-in → connect Google + SimPro via Nango → unified proxied reads → live events streamed to a webhook sink — run the composed walkthrough:

```bash
pnpm --filter api-emulators-quickstart workos-dashboard-live
```

To **leave a server running** and point your own app at it, use `live-feed`: it
boots the **per-port** CLI (each provider its own origin — the faithful
topology), seeds the org's connections plus ~90 days of history, prints a
paste-ready host-only env block, and streams new activity **unbounded** until
Ctrl-C.

```bash
pnpm -w build
pnpm --filter api-emulators-quickstart live-feed          # or: -- --seconds 8
```

For the **full comprehensive SimPro + Uptick workflow dataset** (all 1,435
SimPro Swagger operations plus local OAuth/inspector routes, including line
items, payments, leads, vendor orders and the 79 `setup/*` collections) on the same long-lived per-port server, use
`seeded-server` — it boots the per-port server with roots only, then drives
`simpro-sim`/`uptick-sim` in REMOTE mode to build the quarter _inside the
running server_ so your app reads a real quarter that persists until Ctrl-C.
Spec-only SimPro endpoints use the generic `swagger_records` seed/export store,
so the comprehensive crawl can retain data for routes that do not have bespoke
typed handlers yet:

```bash
pnpm --filter api-emulators-quickstart seeded-server      # or: -- --seconds 8
```

For an in-process, bootable SimPro seed file, run `simpro-sim` with
`SIMPRO_SIM_EXPORT=/path/to/seed.json`. The export is written after the full
Swagger crawl and includes generic spec-only rows under `simpro.swagger_records`.

SimPro workflow seed profiles:

```bash
pnpm --filter api-emulators-quickstart simpro-sim:90d
pnpm --filter api-emulators-quickstart simpro-sim:180d
pnpm --filter api-emulators-quickstart simpro-sim:1y-plus-6m

SIMPRO_SIM_EXPORT=./tmp/simpro-90d.seed.json pnpm --filter api-emulators-quickstart simpro-sim:90d
```

The `90d`, `180d`, and `1y-plus-6m` profiles all include six months of future
scheduled work. In export mode, SimPro also fills generic Swagger-backed
collections from the vendored spec so seed files contain schema-complete
records for spec-only endpoints as well as the linked workflow graph.

To test one app against all three SimPro datasets side by side, run:

```bash
pnpm --filter api-emulators-quickstart simpro-profiles
```

It exports the three profile seeds, starts three local SimPro endpoints, and
prints environment variables:

```bash
SIMPRO_90D_BASE_URL=http://localhost:4030
SIMPRO_180D_BASE_URL=http://localhost:4031
SIMPRO_1Y_PLUS_6M_BASE_URL=http://localhost:4032
```

The SimPro inspector at `/inspector` shows an overview plus a left sidebar for
every seeded endpoint group, including schedules, quotes, invoices, payments,
vendor orders, assets, inventory, recurring work, setup records and webhook
activity.

Use `--seconds 30` for a bounded smoke run, or `--base-port 4100` if those ports
are already in use.

To test the same profile windows across the core provider matrix, run:

```bash
pnpm --filter api-emulators-quickstart core-profiles
```

This starts Nango endpoints for 39 providers. Every provider gets the same
per-profile record count: 40 records for `90d`, 52 for `180d`, and 79 for
`1y-plus-6m`.

```bash
CORE_90D_NANGO_URL=http://localhost:4040
CORE_180D_NANGO_URL=http://localhost:4041
CORE_1Y_PLUS_6M_NANGO_URL=http://localhost:4042
```

Seeded connection IDs:

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

Use those connection IDs with the usual Nango headers:

```bash
curl -H "Connection-Id: gmail-acme" \
  -H "Provider-Config-Key: gmail" \
  "$CORE_90D_NANGO_URL/records?model=Message"
```

Validate the Nango record, cursor, ids/filter, sync webhook, and forwarded
webhook contracts against any running profile endpoint:

```bash
pnpm --filter api-emulators-quickstart core-profiles:validate -- --base-url http://localhost:4040
pnpm --filter api-emulators-quickstart core-profiles:validate -- --base-url http://localhost:4041
pnpm --filter api-emulators-quickstart core-profiles:validate -- --base-url http://localhost:4042
```

Nango realtime data flow is webhook-driven, not WebSocket-driven. Providers
send webhooks to Nango, Nango updates its records cache or forwards the raw
provider event, and your app reads changed records from `GET /records` with
the cursor in `_nango_metadata.cursor`.

To compare a real Nango connection against the emulator, fetch the underlying
records with the same endpoint shape:

```bash
curl -G "https://api.nango.dev/records" \
  -H "Authorization: Bearer $NANGO_SECRET_KEY" \
  -H "Connection-Id: $NANGO_CONNECTION_ID" \
  -H "Provider-Config-Key: $NANGO_PROVIDER_CONFIG_KEY" \
  --data-urlencode "model=$NANGO_MODEL" \
  --data-urlencode "limit=100"
```

The validator can run against one real Nango connection too:

```bash
NANGO_SECRET_KEY=... pnpm --filter api-emulators-quickstart core-profiles:validate -- \
  --base-url https://api.nango.dev \
  --connection-id "$NANGO_CONNECTION_ID" \
  --provider-config-key "$NANGO_PROVIDER_CONFIG_KEY" \
  --model "$NANGO_MODEL"
```

The Nango emulator tracks the current backend API routes used by sync
workflows:

```text
GET/POST /connections
GET/PATCH/DELETE /connections/{connectionId}
POST/PATCH /connections/metadata
GET /records
PATCH /records/prune
POST /sync/start
POST /sync/pause
POST /sync/trigger
GET /sync/status
POST/DELETE /sync/{name}/variant/{variant}
```

Deprecated `/connection` aliases are kept for older clients.

### Font files in serverless

Emulator UI pages use bundled fonts. Wrap your Next.js config to include them in the serverless trace:

```typescript
// next.config.mjs
import { withEmulate } from '@emulators/adapter-next'

export default withEmulate({
  // your normal Next.js config
})
```

If you mount the catch-all at a custom path, pass the matching prefix:

```typescript
export default withEmulate(nextConfig, { routePrefix: '/api/emulate' })
```

### Persistence

By default, emulator state is in-memory and resets on every cold start. To persist state across restarts, pass a `persistence` adapter:

```typescript
import { createEmulateHandler } from '@emulators/adapter-next'
import * as github from '@emulators/github'

const kvAdapter = {
  async load() { return await kv.get('emulate-state') },
  async save(data: string) { await kv.set('emulate-state', data) },
}

export const { GET, POST, PUT, PATCH, DELETE } = createEmulateHandler({
  services: { github: { emulator: github } },
  persistence: kvAdapter,
})
```

For local development, `@emulators/core` ships `filePersistence`:

```typescript
import { filePersistence } from '@emulators/core'

// ...
persistence: filePersistence('.emulate/state.json'),
```

The persistence adapter is called on cold start (load) and after every mutating request (save). Saves are serialized via an internal queue to prevent race conditions.

## Nango — multi-provider integration emulator

`@emulators/nango` stands in for a hosted Nango deployment: one emulator manages every linked SaaS account in your tests. It implements the connection management API (`GET /connections/:id`, `GET /connection`, `POST /connection`, metadata PUT/PATCH), the sync records API (`GET /records?model=<Model>`), the hosted connect-session handshake, and a proxy surface with first-class shaping for QuickBooks, Xero, and MYOB (other providers fall through a generic record passthrough).

```yaml
nango:
  connections:
    - id: salesforce-acme
      provider: salesforce
      provider_config_key: salesforce
      connection_config:
        instance_url: https://acme.my.salesforce.com
      metadata:
        organizationId: org_acme
      records:
        Account:
          - { Id: 0011x00000ABCDEAA1, Name: Acme Corp, Industry: Technology }
```

```bash
curl -H "Connection-Id: salesforce-acme" \
     -H "Provider-Config-Key: salesforce" \
     "http://localhost:4030/records?model=Account"
```

### Seed library for popular providers

`examples/nango-seeds.yaml` is a drop-in library of seeds for 34 popular providers spanning CRM (Salesforce, Pipedrive, Zoho), accounting (FreshBooks, Wave, plus the built-in Xero/QuickBooks shaping), comms (Discord, Microsoft Teams), email/marketing (Mailchimp, SendGrid, Klaviyo, Gmail), storage (Dropbox, Box), calendar (Google Calendar, Outlook), project tracking (Jira, Linear, Asana, Notion, ClickUp, Monday, Trello), code hosts (GitHub, GitLab), support (Zendesk, Intercom), HR/ATS (BambooHR, Greenhouse, Lever), e-commerce (Shopify), analytics (Mixpanel), and data/forms (Typeform, Airtable, Calendly).

Each entry uses each provider's real API field shapes so client code transfers cleanly from the emulator to production. Copy the connections you need under your `nango:` key in `emulate.config.yaml`.

For a runnable narrated walkthrough (list connections, fetch credentials, merge sync state, pull records, proxy a provider-native call, run the hosted connect-session handshake), see [`examples/api-emulators-quickstart`](./examples/api-emulators-quickstart/).

### Organization-scoped connections (tags)

Connections carry a `tags` map that mirrors the org and end-user identity supplied during the connect-session handshake. When a connection is linked through `POST /connect/sessions`, the emulator stamps the resulting connection with `tags.organization_id` (from `end_user.tags.organizationId`) and `tags.end_user_id` (from `end_user.id`), so multi-tenant callers can scope the connection list to a single org server-side:

```bash
# All connections for one WorkOS organization
curl "http://localhost:4030/connections?tags[organization_id]=org_acme"
```

Tag keys are normalized to lowercase, and every `tags[<key>]=<value>` query param must match exactly (AND semantics). The same keys are searchable through `?search=`. `metadata` keeps its original camelCase shape (`organizationId`, `userId`) for backward compatibility; `tags` is the canonical, filterable surface.

## Simulating live activity (`agent-emulate-sim`)

A static emulator answers whatever you seeded. Real systems also *change over time* — new emails arrive, issues get opened, payments settle. [`@emulators/simulator`](./packages/@emulators/simulator/) is a standalone driver that turns a running deployment into a living one. It imports nothing from the emulator — a pure HTTP client that pushes new records/events on a schedule and lets each emulator's own webhook dispatch fire:

```bash
agent-emulate-sim run scenario.yaml --base http://localhost:4000
  --once              # one tick per stream, then exit
  --dry-run           # generate + log, no HTTP calls
  --duration <sec>    # stop after N seconds
```

A scenario is YAML/JSON describing streams (inbox emails, Teams/WhatsApp messages, Drive files, Calendar events, or native actions like opening GitHub issues / creating Stripe payment intents). See [`examples/inbox-stream.yaml`](./packages/@emulators/simulator/examples/inbox-stream.yaml) and the [simulator README](./packages/@emulators/simulator/README.md).

## Live activity stream (SSE)

The deployable server publishes one event per forwarded request to an aggregate
[Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream, so you can watch emulated traffic in real time — every query and response
across every provider, including records the simulator pushes in:

```bash
# Recent events as JSON (newest first); filter to one provider with ?service=
curl 'http://localhost:4000/_activity/recent.json?limit=50'
curl 'http://localhost:4000/_activity/recent.json?service=google'

# Live tail (text/event-stream, `: ping` heartbeat every 15s)
curl -N 'http://localhost:4000/_activity/stream'
curl -N 'http://localhost:4000/_activity/stream?service=stripe'
```

Each event is `{ ts, service, action, entity, id }` — HTTP method, prefix-stripped
resource path, and status code. In the browser, subscribe with `EventSource`:

```js
const es = new EventSource('http://localhost:4000/_activity/stream')
es.onmessage = (e) => console.log(JSON.parse(e.data))
```

The [inspector](http://localhost:4000/_inspector) renders this as a live-updating
"Live Activity" card at the top of the provider browser. The endpoints are also
available to embedders via `registerActivityRoutes(app)` and `renderActivityCard()`
from [`@emulators/core`](./packages/@emulators/core/).

## Deployable server

[`apps/server`](./apps/server/) is a single Hono app that multiplexes every emulator behind one port — drop it on a server, point dev/staging at it, run real OAuth against fake providers. It adds two production conveniences over the per-service CLI:

- **Persistence** — `--snapshot-file ./state.json` (or `EMULATE_SNAPSHOT_PATH`) restores connections, OAuth tokens and records on boot and flushes on `SIGTERM`/`SIGINT`. See [Persistence](./apps/server/README.md#persistence-survive-a-restart).
- **Base-URL ergonomics** — prefix-less SDKs (Stripe `apiBase`, Salesforce instance URL, Xero/QuickBooks/WorkOS hosts) work pointed at the bare origin; everything else is path-routed at `/<service>/*`. See the [base-URL matrix](./apps/server/README.md#pointing-an-sdk-at-the-server).

Multi-tenant note: a deployment is a single shared state space today. For isolated tenants, run separate deployments (or separate snapshot files) per tenant until per-request tenant isolation lands.

## Architecture

```
packages/
  emulate/          # CLI entry point (commander) + upstream service registry
  @emulators/
    core/           # HTTP server, store, plugin interface, middleware,
                    #   persistence, root-fallback routing
    adapter-next/   # Next.js App Router integration
    native-kit/     # spec-driven engine for ~30 SDK-aligned REST emulators
    nango/          # multi-provider integration emulator (proxy + records)
    simulator/      # agent-emulate-sim — external live-activity driver
    msw/            # run any provider in-process as MSW request handlers
    vercel/ github/ google/ slack/ apple/ microsoft/ okta/ aws/ resend/
    stripe/ clerk/ workos/ mongoatlas/ ...  # first-class provider services
    salesforce/ xero/ quickbooks/ hubspot/ simpro/ uptick/ + ~30 more
                    #   direct-to-source emulators (native REST, no proxy)
apps/
  server/           # deployable multiplexer: all emulators behind one port
  web/              # documentation site (Next.js)
```

The core provides a generic `Store` with typed `Collection<T>` instances supporting CRUD, indexing, filtering, and pagination. Each service plugin registers its routes on the shared Hono app and uses the store for state. `native-kit` generates SDK-aligned emulators from the same provider seed shapes used by the Nango library, so coverage scales without hand-writing every route.

## Auth

Tokens are configured in the seed config and map to users. Pass them as `Authorization: Bearer <token>` or `Authorization: token <token>`.

**Vercel**: All endpoints accept `teamId` or `slug` query params for team scoping. Pagination uses cursor-based `limit`/`since`/`until` with `pagination` response objects.

**GitHub**: Public repo endpoints work without auth. Private repos and write operations require a valid token. Pagination uses `page`/`per_page` with `Link` headers.

**Google**: Standard OAuth 2.0 authorization code flow. Configure clients in the seed config.

**Slack**: All Web API endpoints require `Authorization: Bearer <token>`. OAuth v2 flow with user picker UI.

**Apple**: OIDC authorization code flow with RS256 ID tokens. On first auth per user/client pair, a `user` JSON blob is included.

**Microsoft**: OIDC authorization code flow with PKCE support. Also supports client credentials grants. Microsoft Graph `/v1.0/me` available.

**AWS**: Bearer tokens or IAM access key credentials. Default key pair always seeded: `AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`.
