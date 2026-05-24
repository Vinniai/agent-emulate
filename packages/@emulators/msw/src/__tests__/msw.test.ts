import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { googlePlugin } from "@emulators/google";
import { stripePlugin } from "@emulators/stripe";
import { emulateHandlers } from "../index.js";

// Two services, default base port 4000 → google on :4000, stripe on :4001 —
// each provider owns its own origin, exactly like `agent-emulate start`.
const { handlers, services } = emulateHandlers({
  services: { google: googlePlugin, stripe: stripePlugin },
});
const GOOGLE = services.get("google")!.baseUrl;

// A non-emulate endpoint we mock separately, to prove the two layers coexist
// (Pattern A): emulate owns the provider, app-level mocks own everything else.
const appMock = () => http.get("https://api.myapp.com/me", () => HttpResponse.json({ id: "u_1" }));

const server = setupServer(...handlers, appMock());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...handlers, appMock()));
afterAll(() => server.close());

describe("emulateHandlers — in-process provider routing", () => {
  it("gives each service its own origin on the base port (google :4000, stripe :4001)", () => {
    expect(services.get("google")!.baseUrl).toBe("http://localhost:4000");
    expect(services.get("stripe")!.baseUrl).toBe("http://localhost:4001");
  });

  it("routes GET to the provider app and advertises that origin (no path prefix)", async () => {
    const res = await fetch(`${GOOGLE}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { issuer: string; userinfo_endpoint: string; jwks_uri: string };
    // The emulator was handed `http://localhost:4000` as its base URL, so every
    // advertised endpoint hangs off that origin directly — no `/google` prefix.
    expect(doc.userinfo_endpoint).toBe(`${GOOGLE}/oauth2/v2/userinfo`);
    expect(doc.jwks_uri).toBe(`${GOOGLE}/oauth2/v3/certs`);
  });

  it("serves the JWKS through the same in-process app (no network, no port)", async () => {
    const res = await fetch(`${GOOGLE}/oauth2/v3/certs`);
    expect(res.status).toBe(200);
    const jwks = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThan(0);
  });

  it("exposes the live store so tests can seed or assert provider state", () => {
    const google = services.get("google");
    expect(google).toBeDefined();
    expect(google!.baseUrl).toBe("http://localhost:4000");
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
      http.get(`${GOOGLE}/oauth2/v3/certs`, () => HttpResponse.json({ keys: [], _forced: true }, { status: 503 })),
    );
    const res = await fetch(`${GOOGLE}/oauth2/v3/certs`);
    expect(res.status).toBe(503);
    expect((await res.json()) as { _forced: boolean }).toMatchObject({ _forced: true });
  });
});

describe("emulateHandlers — portless subdomains", () => {
  const { handlers: plHandlers, services: plServices } = emulateHandlers({
    portless: true,
    services: { google: googlePlugin },
  });
  const plServer = setupServer(...plHandlers);

  beforeAll(() => plServer.listen({ onUnhandledRequest: "error" }));
  afterAll(() => plServer.close());

  it("mounts each service at https://<name>.emulate.localhost", async () => {
    const base = plServices.get("google")!.baseUrl;
    expect(base).toBe("https://google.emulate.localhost");
    const res = await fetch(`${base}/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { userinfo_endpoint: string };
    expect(doc.userinfo_endpoint).toBe(`${base}/oauth2/v2/userinfo`);
  });
});
