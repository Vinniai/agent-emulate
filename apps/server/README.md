# `@emulators/server` — deployable emulate service

Single Hono app that multiplexes all 16 emulators behind one port. Drop it on a
server, point your dev/staging app at it, and run real OAuth flows against
fake providers.

```
http://emulate.yourdomain.com/google/...      → Google emulator
http://emulate.yourdomain.com/workos/...      → WorkOS emulator
http://emulate.yourdomain.com/simpro/...      → Simpro emulator
http://emulate.yourdomain.com/_admin/...      → seed / reset / list users
...
```

---

## Run it

### Docker compose (default — port 4000)

```bash
cp emulate.config.example.yaml emulate.config.yaml   # edit users/data
docker compose up -d --build
curl http://localhost:4000/_admin/health
```

### Bare node

```bash
PORT=4000 \
EMULATE_BASE_URL=http://localhost:4000 \
EMULATE_CONFIG_PATH=$PWD/emulate.config.yaml \
node apps/server/dist/index.js
```

### Env vars

| Var | Purpose | Default |
|---|---|---|
| `PORT` | Listen port | `4000` |
| `EMULATE_BASE_URL` | Public URL emitted in OIDC issuers / redirects | `http://localhost:4000` |
| `EMULATE_CONFIG_PATH` | YAML config path | auto-discover |
| `EMULATE_CONFIG_URL` | Fetch config over HTTP at boot | — |
| `EMULATE_ADMIN_TOKEN` | Bearer required on `/_admin/*` (except `/health`) | unset = open |
| `EMULATE_SNAPSHOT_PATH` | Persist all service state to this file; restore it on boot (CLI `--snapshot-file <path>` wins) | unset = in-memory only |
| `EMULATE_SNAPSHOT_INTERVAL_SEC` | When persistence is on, also flush every N seconds (besides on `SIGTERM`/`SIGINT`) | unset = save on exit only |

### Persistence (survive a restart)

By default the server is in-memory: every restart starts from the seed
config. Point it at a snapshot file and connections, OAuth tokens and records
survive a restart:

```bash
node apps/server/dist/index.js --snapshot-file ./.emulate-state.json
# or: EMULATE_SNAPSHOT_PATH=./.emulate-state.json node apps/server/dist/index.js
```

On boot the stores are seeded as usual, then the snapshot is restored *over*
that (persisted state is newer than fixtures). On `SIGTERM`/`SIGINT` — and, if
`EMULATE_SNAPSHOT_INTERVAL_SEC` is set, periodically — the full state is
written back. A missing, stale, or malformed snapshot is ignored (the server
still boots from seed), so it is safe to delete the file to reset.

---

## Pointing an SDK at the server

Every emulator is path-routed at `/<service>/*`, so the canonical base URL is
`http://localhost:4000/<service>`. That works for any SDK whose client lets you
set a full base URL **including a path** (Google, Microsoft, GitHub, Slack,
Okta, Clerk, …):

```
WORKOS_API_HOSTNAME=localhost:4000/workos
GITHUB_API_URL=http://localhost:4000/github
```

Some vendor SDKs only accept a **host** (no path component) — Stripe's
`apiBase`, Salesforce's instance URL, Xero's `https://api.xero.com`,
QuickBooks' Intuit hosts, WorkOS' `https://api.workos.com`. Pointed at a bare
origin (`http://localhost:4000`) these hit absolute root paths. The server
recognises those well-known root paths and forwards them to the owning service
unchanged (no prefix rewrite — the caller is treating the server as the vendor
root). The routing table + matcher live in `@emulators/core`
(`matchRootFallback`, unit-tested) and resolve by longest path prefix.

### Base-URL matrix

| SDK | Configure base as | Root paths auto-forwarded when pointed at bare origin |
|---|---|---|
| Path-routed (Google, GitHub, Slack, Okta, Clerk, …) | `http://localhost:4000/<service>` | — (use the prefix) |
| **Stripe** | `http://localhost:4000` (`apiBase`) | `/v1/*`, `/checkout/*` |
| **WorkOS** | `http://localhost:4000` or `…/workos` | `/user_management`, `/sso`, `/organizations`, `/directory`, `/directory_users`, `/directory_groups`, `/audit_logs`, `/events`, `/portal` |
| **Xero** | `http://localhost:4000` | `/api.xro/2.0/*`, `/connections`, `/connect/token` |
| **QuickBooks** | `http://localhost:4000` | `/v3/company/*`, `/oauth2/v1/*` |
| **Salesforce** | `http://localhost:4000` (instance URL) | `/services/data/*`, `/services/oauth2/*` |

Path routing always works too — `/<service>/v1/...` is unambiguous and never
depends on the fallback. The fallback only fires when the first path segment
is not a known service name.

---

## Admin API

```bash
GET  /_admin/health               # liveness, lists mounted services
GET  /_admin/users                # unified roster + minted bearer tokens
GET  /_admin/config               # current config snapshot
POST /_admin/reset                # wipe all stores (keeps default seed)
POST /_admin/seed     {body: EmulateConfig}              # full reseed (wipe + apply)
POST /_admin/seed?mode=merge  {body: EmulateConfig}      # additive upsert (no wipe)
GET  /_admin/export   [?service=&format=yaml|json&includeCredentials=true]
```

When `EMULATE_ADMIN_TOKEN` is set, all routes except `/health` require
`Authorization: Bearer <token>`.

### Seed: replace vs. merge

`emulate` is a primitive — the consuming project pushes *its own* seed and
owns that data. Pushing config for a service **suppresses that service's
built-in defaults** (e.g. no `testuser@agent-emulate.dev`); services with no pushed
config keep their defaults.

- **`POST /_admin/seed`** (default, `mode=replace`) — wipe and reapply. Live
  OAuth credentials issued during connect flows are preserved across the
  reseed so connected integrations don't have to re-authorise.
- **`POST /_admin/seed?mode=merge`** — additive upsert onto the running store.
  No wipe, no auth reset. Only the services present in the body are touched.
  Idempotency depends on each plugin's upsert: `simpro` / `nango` are fully
  upsert-safe; `google` calendars/events and `uptick` defects duplicate on
  repeat; `microsoft` Graph arrays are replaced wholesale.

### Export (portable, re-seedable)

`GET /_admin/export` captures live store state back into an
`EmulateConfig`-shaped payload that `POST /_admin/seed` accepts **verbatim**
(round-trip invariant) — mutate through the normal API, then export the result
as the seed for another emulator instance.

- `?service=<name>` — single service (default: all mounted)
- `?format=yaml|json` — default `json`; `yaml` is human-editable
- `?includeCredentials=true` — emit nango access/refresh tokens (default:
  stripped and re-synthesised on re-seed). `oauth_clients.client_secret` is
  always retained (static config needed to replay OAuth); the internal OAuth
  token/code collections are never exported.

State exporters exist for **`nango`, `uptick`, `google`, `simpro`, and
`microsoft`** — these round-trip exactly. Services without an exporter are
listed under `_meta.export_notes`; that envelope is inert on re-seed, so the
payload stays directly re-seedable (re-seed those services from their original
config).

```bash
BASE=http://localhost:4000 bash apps/server/scripts/test-export-roundtrip.sh
```

### Nango proxy fidelity (Google / Microsoft)

Real Nango's `/proxy` forwards verbatim to the provider's own API, so callers
see the provider's native JSON. The emulator mirrors that for the common
providers — it infers the resource from the real-API path and wraps the
seeded records in the provider's native envelope:

| Provider | Path (after `/proxy/`) | Response shape |
|---|---|---|
| `google-mail` | `gmail/v1/users/me/messages[/{id}]` | `{ messages: [{id,threadId}], resultSizeEstimate }`; `/{id}` → full message |
| `google-drive` | `drive/v3/files[/{id}]` | `{ kind:"drive#fileList", files:[…] }`; `/{id}` → file |
| `google-calendar` | `calendar/v3/calendars/{cal}/events[/{id}]` | `{ kind:"calendar#events", items:[…] }`; `/{id}` → event |
| Microsoft Graph | `v1.0/me/{messages\|events\|contacts\|drive…\|joinedTeams}[/{id}]` | `{ "@odata.context", value:[…] }`; `/{id}` → entity |
| Xero / QuickBooks / MYOB | `api.xro/…`, `v3/company/{realm}/query`, `api.myob.com/…` | native Xero / QBO / MYOB envelope |

Records are returned exactly as seeded — only routing and the envelope are
synthesised. Model lookup is tolerant: a Drive request resolves records seeded
under `files`, `DriveFile`, or `GoogleDriveFile` (likewise per resource), so
align seed model names with your real Nango sync where it matters. Providers
outside this list fall back to `{ records: [...], path }`.

#### Pagination (matches each provider's real mechanics)

List endpoints paginate exactly like the live APIs, so an SDK that follows
cursors works unmodified:

| Provider | Page param | Default / max | Cursor returned | Caller resubmits as |
|---|---|---|---|---|
| `google-mail` | `maxResults` | 100 / 500 | `nextPageToken` (omitted on last page) | `pageToken` |
| `google-drive` | `pageSize` | 100 / 1000 | `nextPageToken` (omitted on last page) | `pageToken` |
| `google-calendar` | `maxResults` | 250 / 2500 | `nextPageToken`; final page → `nextSyncToken` | `pageToken` |
| Microsoft Graph | `$top` | 100 / 999 | `@odata.nextLink` (absolute URL, omitted on last page) | follow the link verbatim |

- Tokens are opaque (base64url-encoded offsets) — treat them as blobs, exactly
  as you would the real provider tokens.
- Gmail `resultSizeEstimate` is the **total** estimate, not the page size.
- Graph `@odata.count` is emitted only with `$count=true`; `@odata.nextLink` is
  an absolute URL through this server (`…/nango/proxy/…`) so a Graph SDK
  follows it straight back to the emulator with no rewrite.
- Seed sets smaller than the default page size return a single page with no
  cursor — identical to the real APIs.

The full E2E test in `scripts/test-admin-seed.sh` exercises:
1. POST `/_admin/seed` with custom users + seed data
2. WorkOS platform login as the seeded user
3. Independent Gmail OAuth → fetch the seeded message
4. Independent Simpro OAuth → fetch the seeded customer + staff
5. Refresh-token rotation

```bash
BASE=http://localhost:4000 bash apps/server/scripts/test-admin-seed.sh
```

### Nango webhooks (sync / forward)

Real Nango POSTs your app two webhook types; the emulator emits both with the
same envelopes and signature so your existing handler runs unmodified. This is
how a consumer tests "new calendar events / Teams messages / Gmail arrived"
and inbound provider events (WhatsApp messages, Graph change notifications)
without polling or a live provider.

**Register the callback** — push it in the seed (primitive-aligned) or at
runtime:

```bash
# seed:  nango.webhook_url + nango.webhook_secret
curl -X POST http://localhost:4000/nango/webhook-settings \
  -H 'content-type: application/json' \
  -d '{ "url": "https://app.test/api/nango/webhook", "secret": "whsec_…" }'
```

Every delivery is signed: header
`X-Nango-Signature: <hex HMAC-SHA256(rawBody, secret)>` (Nango's scheme) plus
`X-Nango-Webhook-Type: sync|forward`.

| Trigger | Request | Webhook delivered |
|---|---|---|
| **sync** | `POST /nango/sync/trigger` `{ provider_config_key, connection_id, syncs? }` | `{ type:"sync", connectionId, providerConfigKey, syncName, model, responseResults:{added,updated,deleted}, syncType, modifiedAfter, queryTimeStamp, success }` — one per synced model, `added` = current record count |
| **forward** | provider POSTs `POST /nango/webhook/{envUuid}/{providerConfigKey}` (raw provider body) | `{ from:<provider>, type:"forward", connectionId, providerConfigKey, payload:<raw body> }` — relayed verbatim; the inbound call always 200s the provider |

`GET /nango/webhook-deliveries` returns the delivery log (status, signature,
payload) for assertions. A trigger with no callback configured still succeeds
and simply delivers nothing — exactly as real Nango behaves.

Round-trips: `GET /_admin/export` re-emits `nango.webhook_url` /
`nango.webhook_secret`, so a captured environment re-seeds with its webhook
wiring intact.

**Appending live records.** Seeding replaces a model wholesale; to drip a
single new record onto an already-seeded connection (an email landing, a
message arriving) use:

```bash
curl -X POST http://localhost:4000/nango/connections/gm-acme/records/messages \
  -H 'content-type: application/json' \
  -d '{ "records": [ { "id": "m-new", "snippet": "just landed" } ] }'
# → { "model": "messages", "appended": 1, "total": 13 }
```

`POST /nango/sync/trigger` accepts an explicit `{ "added": 1 }` (plus optional
`updated` / `deleted` and a `model` filter) so a per-record tick reports
`added:1` instead of the whole model length.

---

## Simulating live activity (`agent-emulate-sim`)

`@emulators/simulator` is an external CLI that streams new records/events into
a **running** emulator over time — emails into an inbox, Teams messages,
WhatsApp inbound, Drive files, Calendar events — exercising the append +
webhook surface above. It is a pure HTTP client (imports nothing from the
emulator), so it drives any deployment, and is primitive-aligned: the
consuming project owns the scenario and the data it pushes.

A scenario is human-editable YAML (or JSON):

```yaml
base: http://nango.localhost:1355
durationSec: 600
streams:
  - name: gmail-inbox            # sync: append a record, fire a "sync" webhook
    kind: sync
    provider: gmail              # gmail | graph-mail | teams | drive | calendar
    connectionId: gm-acme
    providerConfigKey: google-mail
    model: messages
    ratePerMinute: 12
    jitter: 0.4                  # ± fractional jitter on the interval
    # maxCount: 50               # optional per-stream cap
  - name: whatsapp-inbound       # forward: wrap+relay a provider webhook
    kind: forward
    provider: whatsapp
    connectionId: wa-acme
    providerConfigKey: whatsapp
    environmentUuid: env-1
    ratePerMinute: 8
```

Each `sync` tick appends one provider-shaped record then triggers a signed
`type:"sync"` webhook with `added:1`. Each `forward` tick POSTs the provider's
inbound URL with a Meta-shaped payload, relayed as a `type:"forward"` webhook.

```bash
pnpm --filter @emulators/simulator build

# continuous daemon (Ctrl-C stops gracefully)
node packages/@emulators/simulator/dist/cli.js run \
  packages/@emulators/simulator/examples/inbox-stream.yaml \
  --base http://localhost:4000/nango

node …/cli.js run scenario.yaml --base <url> --once       # one tick per stream
node …/cli.js run scenario.yaml --base <url> --dry-run    # generate + log, no HTTP
node …/cli.js run scenario.yaml --base <url> --duration 60
```

`connectionId` / `providerConfigKey` must match Nango connections the emulator
is already seeded with. Combined with `GET /_admin/export`, a stream of
simulated activity can be captured and replayed as the seed for another
emulator instance.

---

## Wiring a Next.js dashboard to the emulated WorkOS

The emulator implements the WorkOS User Management endpoints under
`/workos/user_management/...` and signs JWTs that match the real shape.
Point the WorkOS SDK at it and your normal sign-in flow runs unmodified.

### 1. Env vars

```bash
# .env.local
WORKOS_API_KEY=sk_test_anything                         # not validated
WORKOS_CLIENT_ID=client_test                            # any string
WORKOS_API_HOSTNAME=localhost:4000/workos               # ← override
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
WORKOS_COOKIE_PASSWORD=at-least-32-random-chars-required
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

### 2. SDK init (with `fetch` rewrite — works on plain HTTP)

```ts
// lib/workos.ts
import { WorkOS } from "@workos-inc/node";

export const workos = new WorkOS(process.env.WORKOS_API_KEY!, {
  // The SDK builds https://api.workos.com/... URLs. Rewrite at fetch level
  // so we can run the emulator on plain HTTP without TLS.
  fetchFn: (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const rewritten = url.replace(
      /^https:\/\/api\.workos\.com/,
      "http://localhost:4000/workos",
    );
    return fetch(rewritten, init);
  },
});
```

### 3. AuthKit users — set up Caddy for HTTPS

`@workos-inc/authkit-nextjs` enforces HTTPS. Front the emulator with Caddy:

```caddy
# Caddyfile
emulate.localhost {
  reverse_proxy localhost:4000
  tls internal
}
```

```bash
caddy run --config Caddyfile
# then in .env.local:
WORKOS_API_HOSTNAME=emulate.localhost/workos
```

Caddy installs its own root CA on macOS — `curl https://emulate.localhost/_admin/health`
will work without `-k`.

### 4. Seed users

```bash
curl -X POST http://localhost:4000/_admin/seed \
  -H 'content-type: application/json' \
  -d '{
    "users": [
      { "id": "alice", "role": "admin", "email": "alice@agent-emulate.dev", "name": "Alice Admin",
        "providers": { "workos": true, "google": { "gmail": true }, "simpro": { "staff": true, "admin": true } } }
    ]
  }'
```

Each user gets default password `Password123!` and membership in
`org_emulate-org` so password login + authorization-code flow both work.

---

## Cookie pitfalls (and how this setup avoids them)

We hit a wall here last time. Notes for next time:

### Symptom: "session cookie is set but request to `/api/auth/me` shows
`undefined`" / login loop / cookie doesn't appear in dev tools.

### Cause matrix

| Cause | Why it bit us | How to avoid with the emulator |
|---|---|---|
| **`Secure` cookie on plain HTTP** | AuthKit sets `Secure: true` by default. Browsers silently drop `Secure` cookies on `http://` origins. | Either run the dashboard on HTTPS too (`mkcert localhost` or Caddy `tls internal`), **or** force `cookieOptions.secure = false` in dev. |
| **Cross-port `SameSite=Lax`** | Dashboard on `:3000`, emulator on `:4000`. The auth code lands on `:3000`, which is fine for `SameSite=Lax`, **but** if any iframe/`fetch` from `:4000` writes a cookie back, the browser blocks it. | Keep cookies set by the **dashboard** only — never by the emulator. The emulator's job is to redirect with `?code=...`; the dashboard exchanges the code and writes its own session cookie on its own origin. |
| **`SameSite=None` without `Secure`** | If you flip to `SameSite=None` to support cross-origin, browsers require `Secure`, which requires HTTPS, which back to row 1. | Don't use `SameSite=None`. Stay on `Lax` and keep all session cookies on the dashboard origin. |
| **Cookie domain mismatch** | `domain=.yourdomain.com` cookies don't apply on `localhost`. | Omit `domain` entirely in dev — defaults to the request host. |
| **Subdomain split (`app.localhost` ↔ `emulate.localhost`)** | Different eTLD+1 entries — cookies don't share. | Same as above: only the **dashboard** writes the session cookie. |
| **Stale `wos-session` after a reseed** | Seeded user IDs change → cookie references a user that no longer exists → AuthKit silently 401s. | After `POST /_admin/seed`, clear cookies for the dashboard origin (or use a pinned `id` in the config so user IDs are stable). |
| **`__Host-` prefix** | `__Host-foo` cookies require `Secure` + `Path=/` + no `domain` — fail on plain HTTP. | If a library uses `__Host-` cookies, you **must** run dev on HTTPS. AuthKit's session cookie isn't `__Host-` prefixed by default. |

### Recommended local layout

The combination that worked end-to-end without cookie weirdness:

```
http://localhost:3000          ← Next.js dashboard (writes session cookies)
http://localhost:4000          ← emulate-server (no cookies, just redirects + JSON)
```

Why it works:
- Auth callback (`/api/auth/callback?code=...`) is a `Lax` top-level
  navigation back to the dashboard origin — cookies set in that response
  are accepted.
- All subsequent dashboard ↔ emulator calls are server-to-server (Next.js
  route handlers using `fetch`) and don't involve the browser's cookie jar.
- The emulator never sets cookies the browser needs to keep — it returns
  302s with `?code=...` plus JSON token bodies.

### If you must use HTTPS everywhere

1. `caddy run` with the Caddyfile above.
2. Set `WORKOS_API_HOSTNAME=emulate.localhost/workos`.
3. Run the dashboard on `https://app.localhost` (Caddy can proxy `:3000`
   too).
4. Cookies now work with default `Secure` + `SameSite=Lax`. No SDK
   changes needed.

### Debugging checklist when cookies vanish

```bash
# 1. Confirm the dashboard set the cookie:
curl -i -c /tmp/jar.txt http://localhost:3000/api/auth/callback?code=...
grep -i set-cookie /tmp/jar.txt

# 2. Confirm the emulator's redirect didn't try to set cookies:
curl -i "http://localhost:4000/workos/user_management/authorize?client_id=client_test&redirect_uri=http://localhost:3000/cb"
# should be a 302 only — no Set-Cookie

# 3. Confirm the user still exists post-reseed:
curl -s http://localhost:4000/_admin/users | jq '.users[].email'
```
