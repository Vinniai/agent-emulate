import { describe, it, expect } from "vitest";
import { createEmulator } from "../api.js";

describe("createEmulator", () => {
  it("starts github and returns a url", async () => {
    const github = await createEmulator({ service: "github", port: 14000 });

    expect(github.url).toBe("http://localhost:14000");

    const res = await fetch(`${github.url}/user`, {
      headers: { Authorization: "token test_token_admin" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { login: string };
    expect(body.login).toBe("admin");

    await github.close();
    // Cold start dynamically imports the plugin and binds a real port; the
    // default 5s timeout is tight on a fresh CI runner. Give it headroom.
  }, 20000);

  it("starts multiple services independently", async () => {
    const [github, vercel] = await Promise.all([
      createEmulator({ service: "github", port: 14010 }),
      createEmulator({ service: "vercel", port: 14011 }),
    ]);

    expect(github.url).toBe("http://localhost:14010");
    expect(vercel.url).toBe("http://localhost:14011");

    await Promise.all([github.close(), vercel.close()]);
  }, 20000);

  it("reset wipes and re-seeds stores", async () => {
    const github = await createEmulator({
      service: "github",
      port: 14020,
      seed: { github: { users: [{ login: "test-user" }] } },
    });

    const createRes = await fetch(`${github.url}/user/repos`, {
      method: "POST",
      headers: {
        Authorization: "token test_token_admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "my-repo", private: false }),
    });
    expect(createRes.status).toBe(201);

    github.reset();

    const listRes = await fetch(`${github.url}/user/repos`, {
      headers: { Authorization: "token test_token_admin" },
    });
    expect(listRes.status).toBe(200);
    const repos = (await listRes.json()) as unknown[];
    expect(repos).toHaveLength(0);

    await github.close();
  }, 20000);

  it("throws on unknown service", async () => {
    // @ts-expect-error testing invalid service name
    await expect(createEmulator({ service: "unknown-svc" })).rejects.toThrow("Unknown service");
  });

  it("starts openai and serves the chat completions API", async () => {
    const openai = await createEmulator({ service: "openai", port: 14030 });
    expect(openai.url).toBe("http://localhost:14030");

    const res = await fetch(`${openai.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; choices: { message: { content: string } }[] };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toContain("ping");

    await openai.close();
  }, 20000);

  it("starts anthropic and serves the messages API via x-api-key", async () => {
    const anthropic = await createEmulator({ service: "anthropic", port: 14031 });
    expect(anthropic.url).toBe("http://localhost:14031");

    const res = await fetch(`${anthropic.url}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 32,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; content: { text: string }[] };
    expect(body.type).toBe("message");
    expect(body.content[0].text).toContain("ping");

    await anthropic.close();
  }, 20000);
});
