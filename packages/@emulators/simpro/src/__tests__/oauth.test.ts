import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro OAuth", () => {
  it("authorize -> token exchange -> refresh", async () => {
    const { app } = createTestApp();

    // authorize (redirect with code)
    const authorizeRes = await app.request(
      `${BASE}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=abc`,
      { redirect: "manual" },
    );
    expect(authorizeRes.status).toBe(302);
    const loc = authorizeRes.headers.get("Location")!;
    expect(loc).toContain("code=");
    expect(loc).toContain("state=abc");

    // token exchange
    const code = new URL(loc).searchParams.get("code")!;
    const tokenRes = await app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: "taskr_dev" }),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toMatch(/^acc_/);
    expect(tokens.refresh_token).toMatch(/^ref_/);
    expect(tokens.expires_in).toBe(3600);

    // single-use code: second exchange should fail
    const replay = await app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    expect(replay.status).toBe(400);

    // refresh token works and rotates the pair
    const refreshRes = await app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    // old refresh token revoked
    const replayRefresh = await app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    });
    expect(replayRefresh.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { errors: Array<{ message: string }> };
    expect(body.errors[0].message).toMatch(/Authentication required/);
  });

  it("accepts valid bearer token", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);
    const res = await app.request(`${BASE}/api/v1.0/companies/0/jobs/`, { headers: auth(token) });
    expect(res.status).toBe(200);
  });
});
