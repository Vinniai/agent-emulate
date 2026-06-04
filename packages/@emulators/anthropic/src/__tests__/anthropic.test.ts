import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher, authMiddleware, type TokenMap } from "@emulators/core";
import { anthropicPlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:4000";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono();
  app.use("*", authMiddleware(tokenMap, undefined, { login: "dev@agent-emulate.dev", id: 1, scopes: [] }));
  anthropicPlugin.register(app as never, store, webhooks, base, tokenMap);
  anthropicPlugin.seed?.(store, base);
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

// Native Anthropic auth: x-api-key + anthropic-version.
const apiHeaders = {
  "x-api-key": "sk-ant-test",
  "anthropic-version": "2023-06-01",
  "Content-Type": "application/json",
};

describe("Anthropic emulator — API surface", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app as never;
  });

  it("rejects calls with no x-api-key and no bearer", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 16, messages: [] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("authentication_error");
  });

  it("GET /v1/models lists models", async () => {
    const res = await app.request(`${base}/v1/models`, { headers: apiHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[]; has_more: boolean };
    expect(body.has_more).toBe(false);
    expect(body.data.some((m) => m.id.startsWith("claude-"))).toBe(true);
  });

  it("POST /v1/messages returns a canned message (x-api-key auth)", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 64,
        messages: [{ role: "user", content: "ping anthropic" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      role: string;
      content: { type: string; text: string }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content[0].type).toBe("text");
    expect(body.content[0].text).toContain("ping anthropic");
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  });

  it("accepts content blocks and a system prompt", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 64,
        system: "You are terse.",
        messages: [{ role: "user", content: [{ type: "text", text: "blocks work" }] }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: { text: string }[] };
    expect(body.content[0].text).toContain("blocks work");
  });

  it("POST /v1/messages streams Anthropic SSE events when stream=true", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "stream please" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("event: message_stop");
  });

  it("POST /v1/messages/count_tokens returns input_tokens", async () => {
    const res = await app.request(`${base}/v1/messages/count_tokens`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "one two three" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { input_tokens: number };
    expect(body.input_tokens).toBeGreaterThanOrEqual(3);
  });
});

describe("Anthropic emulator — OAuth", () => {
  let app: Hono;
  let tokenMap: TokenMap;
  beforeEach(() => {
    const t = createTestApp();
    app = t.app as never;
    tokenMap = t.tokenMap;
  });

  it("runs the authorization-code flow end to end", async () => {
    const authorize = await app.request(
      `${base}/oauth/authorize?client_id=test-client&redirect_uri=${encodeURIComponent(
        "http://localhost:3000/callback",
      )}&scope=openid&state=xyz`,
    );
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("dev@agent-emulate.dev");

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
    const code = new URL(cb.headers.get("Location")!).searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tok = await app.request(`${base}/v1/oauth/token`, {
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
    expect(tokBody.access_token).toMatch(/^sk-ant-oat-/);
    expect(tokenMap.has(tokBody.access_token)).toBe(true);

    const info = await app.request(`${base}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokBody.access_token}` },
    });
    expect(info.status).toBe(200);
    expect(((await info.json()) as { email: string }).email).toBe("dev@agent-emulate.dev");
  });
});
