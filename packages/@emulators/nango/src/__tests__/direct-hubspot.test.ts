import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

// Direct HubSpot OAuth (mounted under the nango plugin) — HubSpot is one of
// the popular CRM integrations and is exercised without going through Nango.
describe("Direct HubSpot OAuth", () => {
  it("authorize → callback → token → introspection round-trip", async () => {
    const { app } = createTestApp();

    const consent = await app.request(
      `${BASE}/hubspot-emu/oauth/authorize?client_id=cid&redirect_uri=${encodeURIComponent(
        "https://app.test/cb",
      )}&scope=crm.objects.contacts.read&state=xyz`,
    );
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("HubSpot");

    const callback = await app.request(`${BASE}/hubspot-emu/oauth/authorize/callback`, {
      ...form({
        client_id: "cid",
        redirect_uri: "https://app.test/cb",
        scope: "crm.objects.contacts.read",
        state: "xyz",
      }),
      redirect: "manual",
    });
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://app.test/cb");
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tokenRes = await app.request(
      `${BASE}/hubspot-emu/oauth/v1/token`,
      form({ grant_type: "authorization_code", code, redirect_uri: "https://app.test/cb", client_id: "cid" }),
    );
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };
    expect(tokens.access_token).toMatch(/^hat_/);
    expect(tokens.refresh_token).toMatch(/^hrt_/);
    expect(tokens).toMatchObject({ expires_in: 3600, token_type: "bearer", scope: "crm.objects.contacts.read" });

    const introspect = await app.request(`${BASE}/hubspot-emu/oauth/v1/access-tokens/${tokens.access_token}`);
    expect(introspect.status).toBe(200);
    expect((await introspect.json()) as Record<string, unknown>).toMatchObject({
      hub_id: "12345678",
      hub_domain: "emulator-hub.hubspot.com",
      token_type: "access",
      scopes: ["crm.objects.contacts.read"],
    });

    // refresh_token grant mints a fresh pair.
    const refreshed = await app.request(
      `${BASE}/hubspot-emu/oauth/v1/token`,
      form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    expect(next.access_token).toMatch(/^hat_/);
    expect(next.access_token).not.toBe(tokens.access_token);
  });

  it("invalid code / grant_type / token surface the documented error codes", async () => {
    const { app } = createTestApp();

    const badCode = await app.request(
      `${BASE}/hubspot-emu/oauth/v1/token`,
      form({ grant_type: "authorization_code", code: "nope" }),
    );
    expect(badCode.status).toBe(400);
    expect((await badCode.json()) as { status: string }).toMatchObject({ status: "BAD_AUTH_CODE" });

    const badGrant = await app.request(
      `${BASE}/hubspot-emu/oauth/v1/token`,
      form({ grant_type: "client_credentials" }),
    );
    expect(badGrant.status).toBe(400);
    expect((await badGrant.json()) as { status: string }).toMatchObject({ status: "BAD_GRANT_TYPE" });

    const badToken = await app.request(`${BASE}/hubspot-emu/oauth/v1/access-tokens/unknown`);
    expect(badToken.status).toBe(404);
    expect((await badToken.json()) as { status: string }).toMatchObject({ status: "BAD_AUTH_TOKEN" });
  });
});
