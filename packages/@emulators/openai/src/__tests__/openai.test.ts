import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher, authMiddleware, type TokenMap } from "@emulators/core";
import { openaiPlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:4000";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set("sk-test", { login: "dev@agent-emulate.dev", id: 1, scopes: [] });

  const app = new Hono();
  // Standalone server accepts any non-empty bearer via a fallback; mirror that.
  app.use("*", authMiddleware(tokenMap, undefined, { login: "dev@agent-emulate.dev", id: 1, scopes: [] }));
  openaiPlugin.register(app as never, store, webhooks, base, tokenMap);
  openaiPlugin.seed?.(store, base);
  seedFromConfig(store, base, {
    oauth_clients: [
      {
        client_id: "test-client",
        client_secret: "test-secret",
        name: "Test App",
        redirect_uris: ["http://localhost:3000/callback"],
      },
    ],
  });
  return { app, store, tokenMap };
}

const authHeaders = { Authorization: "Bearer sk-test", "Content-Type": "application/json" };

describe("OpenAI emulator — API surface", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as never;
  });

  it("rejects unauthenticated calls", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /v1/models lists models", async () => {
    const res = await app.request(`${base}/v1/models`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: { id: string }[] };
    expect(body.object).toBe("list");
    expect(body.data.some((m) => m.id === "gpt-4o-mini")).toBe(true);
  });

  it("POST /v1/chat/completions returns a canned completion", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      choices: { message: { role: string; content: string } }[];
      usage: { total_tokens: number };
    };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toContain("ping");
    expect(body.usage.total_tokens).toBeGreaterThan(0);
  });

  it("POST /v1/chat/completions streams SSE when stream=true", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("data: [DONE]");
  });

  it("POST /v1/responses returns a Responses-API object", async () => {
    const res = await app.request(`${base}/v1/responses`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "gpt-4o-mini", input: "hello codex" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      status: string;
      output_text: string;
      output: { content: { type: string; text: string }[] }[];
    };
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.output_text).toContain("hello codex");
    expect(body.output[0].content[0].type).toBe("output_text");
  });

  it("POST /v1/responses streams typed events when stream=true", async () => {
    const res = await app.request(`${base}/v1/responses`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "gpt-4o-mini", input: "stream me", stream: true }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("response.created");
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("response.completed");
  });

  it("POST /v1/embeddings returns a vector", async () => {
    const res = await app.request(`${base}/v1/embeddings`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model: "text-embedding-3-small", input: "embed me", dimensions: 8 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    expect(body.data[0].embedding).toHaveLength(8);
  });
});

describe("OpenAI emulator — OAuth", () => {
  let app: Hono;
  let tokenMap: TokenMap;
  beforeEach(() => {
    const t = createTestApp();
    app = t.app as never;
    tokenMap = t.tokenMap;
  });

  it("runs the authorization-code flow end to end", async () => {
    // 1. authorize page renders
    const authorize = await app.request(
      `${base}/oauth/authorize?client_id=test-client&redirect_uri=${encodeURIComponent(
        "http://localhost:3000/callback",
      )}&scope=openid&state=xyz`,
    );
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("dev@agent-emulate.dev");

    // 2. callback issues a code
    const cb = await app.request(`${base}/oauth/authorize/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "dev@agent-emulate.dev",
        redirect_uri: "http://localhost:3000/callback",
        scope: "openid",
        state: "xyz",
        client_id: "test-client",
      }).toString(),
      redirect: "manual",
    });
    expect(cb.status).toBe(302);
    const location = cb.headers.get("Location")!;
    const code = new URL(location).searchParams.get("code")!;
    expect(code).toBeTruthy();

    // 3. token exchange
    const tok = await app.request(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost:3000/callback",
        client_id: "test-client",
        client_secret: "test-secret",
      }).toString(),
    });
    expect(tok.status).toBe(200);
    const tokBody = (await tok.json()) as { access_token: string; token_type: string };
    expect(tokBody.token_type).toBe("Bearer");
    expect(tokBody.access_token).toMatch(/^sk-oat-/);
    expect(tokenMap.has(tokBody.access_token)).toBe(true);

    // 4. userinfo with the issued token
    const info = await app.request(`${base}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokBody.access_token}` },
    });
    expect(info.status).toBe(200);
    const infoBody = (await info.json()) as { email: string };
    expect(infoBody.email).toBe("dev@agent-emulate.dev");
  });
});
