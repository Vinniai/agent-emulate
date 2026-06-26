import { describe, it, expect } from "vitest";
import { BASE, createTestApp, json, ORG_SEED } from "./helpers.js";

// The `@nangohq/frontend` SDK opens the Connect UI as an iframe at
// `<baseURL>/?apiURL=...` and drives a postMessage handshake. The emulator
// serves the handshake page at `/` when `apiURL` is present, and the
// data-viewer inspector otherwise.
describe("Nango Connect-UI (postMessage handshake)", () => {
  it("GET /?apiURL=... serves the handshake page, not the inspector", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const res = await app.request(`${BASE}/?apiURL=https://api.nango.dev`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Fires `ready`, listens for `session_token`, sends `connect` + `close`.
    expect(html).toContain('{ type: "ready" }');
    expect(html).toContain('"session_token"');
    expect(html).toContain('type: "connect"');
    expect(html).toContain('type: "close"');
    expect(html).toContain("/connect/session-info");
    expect(html).toContain("/connect/complete");
    // It is the Connect UI, not the data viewer.
    expect(html).not.toContain("Nango Inspector");
  });

  it("GET / (no apiURL) still serves the data-viewer inspector", async () => {
    const { app } = createTestApp({ seed: ORG_SEED });

    const res = await app.request(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // The inspector lists connections and does NOT run the iframe handshake.
    expect(html).not.toContain('{ type: "ready" }');
    expect(html).toContain("quickbooks-acme");
  });

  it("GET /connect/session-info resolves provider + label for a live session", async () => {
    const { app } = createTestApp();
    const created = await app.request(
      `${BASE}/connect/sessions`,
      json({ end_user: { id: "u" }, allowed_integrations: ["quickbooks"] }),
    );
    const { data } = (await created.json()) as { data: { token: string } };

    const res = await app.request(`${BASE}/connect/session-info?token=${data.token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      provider: "quickbooks",
      providerLabel: "QuickBooks",
      integrationId: "quickbooks",
    });

    const bogus = await app.request(`${BASE}/connect/session-info?token=nope`);
    expect(bogus.status).toBe(404);
  });

  it("POST /connect/complete returns integrationId + provider for the connect payload", async () => {
    const { app } = createTestApp();
    const created = await app.request(
      `${BASE}/connect/sessions`,
      json({ end_user: { id: "u" }, allowed_integrations: ["xero"] }),
    );
    const { data } = (await created.json()) as { data: { token: string } };

    const done = await app.request(`${BASE}/connect/complete`, json({ token: data.token }));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      ok: true,
      provider: "xero",
      integrationId: "xero",
    });
  });
});
