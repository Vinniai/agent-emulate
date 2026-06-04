# @emulators/anthropic

Local emulator for the **Anthropic (Claude) API** — OAuth login flow plus the
Messages API, token counting, and the legacy Text Completions endpoint. State is
in-memory; no real model is run — replies are deterministic, prompt-derived
canned text so tests can assert on stable output offline.

## Start

```bash
# Standalone (via the agent-emulate CLI)
npx agent-emulate --service anthropic        # http://localhost:4000

# Or programmatically
import { createEmulator } from "agent-emulate";
const anthropic = await createEmulator({ service: "anthropic", port: 4011 });
```

## Auth

Anthropic SDKs authenticate with the `x-api-key` header (plus `anthropic-version`).
Any non-empty key is accepted, or complete the OAuth flow to mint a token usable
as a bearer credential.

## API surface

| Method & path | Notes |
|---|---|
| `GET /v1/models`, `GET /v1/models/{model}` | Static model list |
| `POST /v1/messages` | Messages API; `stream: true` → Anthropic SSE (`message_start` … `message_stop`) |
| `POST /v1/messages/count_tokens` | Returns `{ input_tokens }` |
| `POST /v1/complete` | Legacy Text Completions |

### Point the Anthropic SDK at it

```ts
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: "sk-ant-emulate", baseURL: "http://localhost:4011" });
const msg = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 64,
  messages: [{ role: "user", content: "hello" }],
});
```

## OAuth (authorization code + PKCE)

| Path | Purpose |
|---|---|
| `GET /oauth/authorize` | Sign-in card listing seeded users |
| `POST /oauth/authorize/callback` | Issues an authorization `code` (302 to `redirect_uri`) |
| `POST /v1/oauth/token`, `POST /oauth/token` | Exchanges `code` (or `refresh_token`) → `sk-ant-oat-…` token |
| `GET /oauth/userinfo` | Current account for the bearer token |

Seed users / OAuth clients / API keys via `emulate.config.yaml` under the
`anthropic:` key (see the CLI `init` output).
