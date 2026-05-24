# @emulators/core

HTTP server, in-memory store, plugin interface, and middleware for agent-emulate service plugins.

Part of [agent-emulate](https://github.com/Vinniai/agent-emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/core
```

## Overview

The core provides the shared infrastructure that every `@emulators/*` service plugin builds on:

- **Store** — a generic in-memory store with typed `Collection<T>` instances supporting CRUD, indexing, filtering, and pagination
- **Server** — Hono-based HTTP server with automatic port management
- **Middleware** — bearer token auth, error handling, CORS
- **UI** — shared authorization/consent page rendering with bundled fonts
- **Persistence** — pluggable save/load adapters for state durability

## Auth & isolation helpers

All opt-in and non-breaking — the defaults leave existing behaviour unchanged.

| Export | Purpose |
| --- | --- |
| `requireAuth()` | 401 unless an authenticated user is on the context. |
| `requireScope(...scopes)` | 403 `insufficient_scope` (RFC 6750) unless the token holds every scope; `*` satisfies any. Bypassed by `EMULATE_AUTH_LAX=1`. |
| `requireAuthWhen(...flags)` | Pass-through **unless** one of the named env flags is on (e.g. `EMULATE_STRIPE_REQUIRE_AUTH`, `EMULATE_REQUIRE_AUTH`); then behaves like `requireAuth()`. Lets a provider reject unauthenticated calls on demand. |
| `authFlagEnabled(...flags)` | The `"1"`/`"true"` flag check behind `requireAuthWhen`. |
| `buildIntrospectionResponse(tokenMap, token, opts?)` | RFC 7662 token-introspection body; unknown/empty/expired → `{ active: false }`. |
| `TenantStore`, `withTenant(id, fn)`, `currentTenant()`, `DEFAULT_TENANT` | Per-tenant store isolation. Enable via `createServer(plugin, { multiTenant: true })` (or `EMULATE_MULTI_TENANT=1`); each request is scoped by the `X-Emulate-Tenant` header. |

## Persistence

### File persistence

For local development, use the built-in file adapter:

```typescript
import { filePersistence } from '@emulators/core'

persistence: filePersistence('.emulate/state.json')
```

### Custom adapter

Any object with `load` and `save` methods works:

```typescript
const kvAdapter = {
  async load() { return await kv.get('emulate-state') },
  async save(data: string) { await kv.set('emulate-state', data) },
}
```

The persistence adapter is called on cold start (load) and after every mutating request (save). Saves are serialized via an internal queue to prevent race conditions.

## Links

- [Full documentation](https://github.com/Vinniai/agent-emulate)
- [GitHub](https://github.com/Vinniai/agent-emulate)
