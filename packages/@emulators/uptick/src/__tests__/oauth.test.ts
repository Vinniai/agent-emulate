import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";

// Mirrors the "Get Access Token" / "Get Refresh Token" steps in Uptick's
// sample Postman collection: POST /api/oauth2/token/ with a form body,
// client credentials supplied via HTTP Basic.
describe("Uptick OAuth2 token endpoint", () => {
  it("password grant returns a Bearer token pair (urlencoded body)", async () => {
    const { app } = createTestApp({ seed: false });

    const res = await app.request(`${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from("cid:secret").toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: "tech@agent-emulate.dev",
        password: "hunter2",
      }).toString(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write",
    });
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(body.access_token).not.toBe(body.refresh_token);
  });

  it("password grant accepts multipart/form-data", async () => {
    const { app } = createTestApp({ seed: false });
    const form = new FormData();
    form.set("grant_type", "password");
    form.set("username", "tech@agent-emulate.dev");
    form.set("password", "hunter2");

    const res = await app.request(`${BASE}/api/oauth2/token/`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { access_token: string }).access_token).toBeTruthy();
  });

  it("refresh_token grant issues a fresh token", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "whatever" }).toString(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token_type: string }).token_type).toBe("Bearer");
  });

  it("missing grant_type → 400 invalid_request", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "invalid_request" });
  });

  it("unsupported grant_type → 400 unsupported_grant_type", async () => {
    const { app } = createTestApp({ seed: false });
    const res = await app.request(`${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: "unsupported_grant_type" });
  });
});
