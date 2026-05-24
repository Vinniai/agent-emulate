import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { googlePlugin } from "@emulators/google";
import { emulateHandlers } from "../index.js";

const BASE = "http://localhost:4000";
const { handlers, services } = emulateHandlers({
  baseUrl: BASE,
  services: { google: googlePlugin },
});

// A non-emulate endpoint we mock separately, to prove the two layers coexist
// (Pattern A): emulate owns the provider, app-level mocks own everything else.
const server = setupServer(
  ...handlers,
  http.get("https://api.myapp.com/me", () => HttpResponse.json({ id: "u_1" })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() =>
  server.resetHandlers(
    ...handlers,
    http.get("https://api.myapp.com/me", () => HttpResponse.json({ id: "u_1" })),
  ),
);
afterAll(() => server.close());

describe("emulateHandlers — in-process provider routing", () => {
  it("routes GET to the provider app and threads the prefixed base URL through", async () => {
    const res = await fetch(`${BASE}/google/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { issuer: string; userinfo_endpoint: string; jwks_uri: string };
    // baseUrl handed to the emulator is `${BASE}/google`, so all advertised
    // endpoints must carry the `/google` prefix — proving the rewrite is correct.
    expect(doc.userinfo_endpoint).toBe(`${BASE}/google/oauth2/v2/userinfo`);
    expect(doc.jwks_uri).toBe(`${BASE}/google/oauth2/v3/certs`);
  });

  it("serves the JWKS through the same in-process app (no network, no port)", async () => {
    const res = await fetch(`${BASE}/google/oauth2/v3/certs`);
    expect(res.status).toBe(200);
    const jwks = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  it("exposes the live store so tests can seed or assert provider state", () => {
    const google = services.get("google");
    expect(google).toBeDefined();
    expect(google!.baseUrl).toBe(`${BASE}/google`);
    // Default seed ran, so at least one collection holds rows.
    const snap = google!.store.snapshot();
    const totalRows = Object.values(snap.collections).reduce((n, c) => n + c.items.length, 0);
    expect(totalRows).toBeGreaterThan(0);
  });

  it("coexists with ordinary MSW handlers for non-provider endpoints", async () => {
    const res = await fetch("https://api.myapp.com/me");
    expect(await res.json()).toEqual({ id: "u_1" });
  });

  it("lets per-test overrides win over the emulator for a specific route", async () => {
    server.use(
      http.get(`${BASE}/google/oauth2/v3/certs`, () => HttpResponse.json({ keys: [], _forced: true }, { status: 503 })),
    );
    const res = await fetch(`${BASE}/google/oauth2/v3/certs`);
    expect(res.status).toBe(503);
    expect((await res.json()) as { _forced: boolean }).toMatchObject({ _forced: true });
  });
});
