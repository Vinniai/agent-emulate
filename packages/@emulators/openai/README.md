# @emulators/openai

Local emulator for the **OpenAI API** — OAuth login flow plus the Chat
Completions, Responses, Completions and Embeddings surfaces. State is in-memory;
no real model is run — completions are deterministic, prompt-derived canned text
so tests can assert on stable output offline.

## Start

```bash
# Standalone (via the agent-emulate CLI)
npx agent-emulate --service openai          # http://localhost:4000

# Or programmatically
import { createEmulator } from "agent-emulate";
const openai = await createEmulator({ service: "openai", port: 4010 });
```

## Auth

OpenAI uses `Authorization: Bearer sk-...`. The standalone server accepts any
non-empty key (it maps to the seeded fallback user), or you can complete the
OAuth flow to mint a real token.

## API surface

| Method & path | Notes |
|---|---|
| `GET /v1/models`, `GET /v1/models/{model}` | Static model list |
| `POST /v1/chat/completions` | Chat Completions; `stream: true` → SSE chunks + `[DONE]` |
| `POST /v1/responses` | Responses API (Codex surface); `stream: true` → typed `response.*` events |
| `POST /v1/completions` | Legacy text completions |
| `POST /v1/embeddings` | Deterministic pseudo-vectors; honors `dimensions` and `encoding_format` (`float`/`base64`) |

### Point the OpenAI SDK at it

```ts
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: "sk-emulate-openai", baseURL: "http://localhost:4010/v1" });
const res = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hello" }],
});
```

## OAuth (authorization code + PKCE)

| Path | Purpose |
|---|---|
| `GET /oauth/authorize` | Sign-in card listing seeded users |
| `POST /oauth/authorize/callback` | Issues an authorization `code` (302 to `redirect_uri`) |
| `POST /oauth/token` | Exchanges `code` (or `refresh_token`) → `sk-oat-…` access token |
| `GET /oauth/userinfo` | Current account for the bearer token |

Seed users / OAuth clients / API keys via `emulate.config.yaml` under the
`openai:` key (see the CLI `init` output).
