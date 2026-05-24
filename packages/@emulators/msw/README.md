# @emulators/msw

Run [agent-emulate](https://github.com/Vinniai/agent-emulate) provider emulators
**in-process** as [MSW](https://github.com/mswjs/msw) request handlers — no server,
no ports, no Service Worker round-trip to a backend. Every request to
`${baseUrl}/<service>/*` is dispatched straight through the provider's Hono app,
reusing the exact same logic the standalone server runs.

This is "Pattern C": the cleanest way to use agent-emulate inside unit/component
tests where spinning up a separate server process is overkill.

## Install

```bash
pnpm add -D @emulators/msw msw @emulators/google
```

`msw` is a peer dependency — you own the version and (in the browser) the Service
Worker. Bring whichever `@emulators/*` providers you need.

## Node (Vitest / Jest)

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { emulateHandlers } from "@emulators/msw";
import { googlePlugin } from "@emulators/google";
import { stripePlugin } from "@emulators/stripe";

const { handlers, services } = emulateHandlers({
  baseUrl: "http://localhost:4000",
  services: { google: googlePlugin, stripe: stripePlugin },
});

const server = setupServer(
  ...handlers,
  // App-level mocks / edge cases coexist with the emulators (Pattern A).
  http.get("https://api.myapp.com/me", () => HttpResponse.json({ id: "u_1" })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("reads provider data through the in-process emulator", async () => {
  const res = await fetch("http://localhost:4000/google/.well-known/openid-configuration");
  expect(res.ok).toBe(true);

  // Reach into the live store to seed or assert provider state directly.
  const snap = services.get("google")!.store.snapshot();
  expect(Object.keys(snap.collections).length).toBeGreaterThan(0);
});
```

Point your SDKs at the same `baseUrl` (`EMULATE_BASE_URL=http://localhost:4000`),
exactly as you would with the live `agent-emulate` server — switching a suite from
the server to in-process MSW needs no other change.

## Browser (Storybook / Playwright component tests)

```ts
import { setupWorker } from "msw/browser";
import { emulateHandlers } from "@emulators/msw";
import { googlePlugin } from "@emulators/google";

const { handlers } = emulateHandlers({ services: { google: googlePlugin } });
export const worker = setupWorker(...handlers);
await worker.start({ onUnhandledRequest: "bypass" });
```

## Per-test overrides

Because these are ordinary MSW handlers, `server.use(...)` overrides win for a
single test — force a `429`/`500`, an empty list, or a malformed payload on top
of the realistic emulator baseline:

```ts
server.use(
  http.get("http://localhost:4000/google/oauth2/v3/certs", () =>
    HttpResponse.json({ keys: [] }, { status: 503 }),
  ),
);
```

## API

### `emulateHandlers(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `services` | `Record<string, ServicePlugin>` | — | Service name → provider plugin. |
| `baseUrl` | `string` | `http://localhost:4000` | Origin (+ optional path) the SDKs target. |
| `serverOptions` | `Omit<ServerOptions, "baseUrl" \| "port">` | — | Per-service `createServer` options (tokens, `fallbackUser`, `multiTenant`…). |
| `seed` | `boolean` | `true` | Run each plugin's built-in seed on startup. |

Returns `{ handlers, services }` — `handlers` for `setupServer`/`setupWorker`, and
`services` (a `Map<string, EmulateService>`) exposing each emulator's `app`,
`store`, `webhooks`, and resolved `baseUrl`.

## When to use the live server instead

Interactive OAuth **login screens** (full-page redirects through a consent page)
have no separate origin to navigate to in-process, so they are not covered here.
Use the standalone `agent-emulate` server for redirect-login UX; use this adapter
for token exchange, userinfo, and provider data APIs.
