// Direct Salesforce REST/SOQL tests — stateful sObject API mounted under the
// nango plugin (no proxy / connection layer). Each `describe` is one red-green
// TDD feature covering the Salesforce surface a real integration exercises:
// OAuth (web-server + username-password), sObject CRUD, SOQL query, sObject
// describe, the composite/sobjects collection API, and auth enforcement. The
// pre-existing nango proxy only did read-only record passthrough for
// Salesforce, so every endpoint below is a genuine missing surface.
import { describe, it, expect } from "vitest";
import { BASE, createTestApp } from "./helpers.js";

const SF = `${BASE}/salesforce-emu`;
const V = "v60.0";
const authH = { Authorization: "Bearer sf_test", "Content-Type": "application/json" };

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: authH,
  body: JSON.stringify(body),
});

interface SfCreate {
  id: string;
  success: boolean;
  errors: unknown[];
}
interface SfRecord {
  attributes: { type: string; url: string };
  Id: string;
  [k: string]: unknown;
}

describe("Salesforce — Feature 1: GET /services/oauth2/authorize (consent page)", () => {
  it("renders an HTML consent screen", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${SF}/services/oauth2/authorize?response_type=code&client_id=cid&redirect_uri=https://app.test/cb&state=xyz`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Salesforce");
  });
});

describe("Salesforce — Feature 2: password grant token", () => {
  it("POST /services/oauth2/token grant_type=password → access_token + instance_url", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${SF}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "cid",
        client_secret: "secret",
        username: "user@agent-emulate.dev",
        password: "pw",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      access_token: string;
      instance_url: string;
      token_type: string;
      id: string;
    };
    expect(body.access_token).toMatch(/^00D/);
    expect(body.instance_url).toContain("salesforce-emu");
    expect(body.token_type.toLowerCase()).toBe("bearer");
  });
});

describe("Salesforce — Feature 3: web-server flow (authorize → code → token)", () => {
  it("callback mints a code that exchanges for tokens", async () => {
    const { app } = createTestApp();
    const cb = await app.request(`${SF}/services/oauth2/authorize/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "cid",
        redirect_uri: "https://app.test/cb",
        state: "st",
      }).toString(),
      redirect: "manual",
    });
    expect(cb.status).toBe(302);
    const loc = new URL(cb.headers.get("location") as string);
    const code = loc.searchParams.get("code") as string;
    expect(code).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("st");

    const tok = await app.request(`${SF}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: "cid",
        redirect_uri: "https://app.test/cb",
      }).toString(),
    });
    expect(tok.status).toBe(200);
    const body = (await tok.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });
});

describe("Salesforce — Feature 4: POST sobjects/:type (create)", () => {
  it("creates an Account and returns 201 { id, success:true }", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${SF}/services/data/${V}/sobjects/Account`,
      post({ Name: "Acme Corp", Industry: "Technology" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as SfCreate;
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^001/);
    expect(body.errors).toEqual([]);
  });
});

describe("Salesforce — Feature 5: GET sobjects/:type/:id (read)", () => {
  it("returns the record with attributes envelope", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(`${SF}/services/data/${V}/sobjects/Contact`, post({ LastName: "Lovelace" }))
    ).json()) as SfCreate;
    const res = await app.request(`${SF}/services/data/${V}/sobjects/Contact/${created.id}`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SfRecord;
    expect(body.Id).toBe(created.id);
    expect(body.LastName).toBe("Lovelace");
    expect(body.attributes.type).toBe("Contact");
  });
});

describe("Salesforce — Feature 6: PATCH sobjects/:type/:id (update)", () => {
  it("updates fields (204) and a GET reflects it", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(`${SF}/services/data/${V}/sobjects/Account`, post({ Name: "Old", Industry: "Retail" }))
    ).json()) as SfCreate;
    const patch = await app.request(`${SF}/services/data/${V}/sobjects/Account/${created.id}`, {
      method: "PATCH",
      headers: authH,
      body: JSON.stringify({ Name: "New" }),
    });
    expect(patch.status).toBe(204);
    const got = (await (
      await app.request(`${SF}/services/data/${V}/sobjects/Account/${created.id}`, { headers: authH })
    ).json()) as SfRecord;
    expect(got.Name).toBe("New");
    expect(got.Industry).toBe("Retail");
  });
});

describe("Salesforce — Feature 7: DELETE sobjects/:type/:id", () => {
  it("deletes (204) and a later GET 404s", async () => {
    const { app } = createTestApp();
    const created = (await (
      await app.request(`${SF}/services/data/${V}/sobjects/Lead`, post({ LastName: "Temp", Company: "X" }))
    ).json()) as SfCreate;
    const del = await app.request(`${SF}/services/data/${V}/sobjects/Lead/${created.id}`, {
      method: "DELETE",
      headers: authH,
    });
    expect(del.status).toBe(204);
    const get = await app.request(`${SF}/services/data/${V}/sobjects/Lead/${created.id}`, { headers: authH });
    expect(get.status).toBe(404);
  });
});

describe("Salesforce — Feature 8: SOQL query", () => {
  it("GET query?q=SELECT ... WHERE returns { totalSize, done, records }", async () => {
    const { app } = createTestApp();
    await app.request(`${SF}/services/data/${V}/sobjects/Account`, post({ Name: "Globex", Industry: "Energy" }));
    await app.request(`${SF}/services/data/${V}/sobjects/Account`, post({ Name: "Initech", Industry: "Energy" }));
    await app.request(`${SF}/services/data/${V}/sobjects/Account`, post({ Name: "Umbrella", Industry: "Pharma" }));
    const q = encodeURIComponent("SELECT Id, Name FROM Account WHERE Industry = 'Energy'");
    const res = await app.request(`${SF}/services/data/${V}/query?q=${q}`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalSize: number; done: boolean; records: SfRecord[] };
    expect(body.done).toBe(true);
    expect(body.totalSize).toBe(2);
    expect(body.records.map((r) => r.Name).sort()).toEqual(["Globex", "Initech"]);
    expect(body.records[0].attributes.type).toBe("Account");
  });
});

describe("Salesforce — Feature 9: sObject describe", () => {
  it("GET sobjects/:type/describe returns { name, fields }", async () => {
    const { app } = createTestApp();
    await app.request(
      `${SF}/services/data/${V}/sobjects/Account`,
      post({ Name: "Acme", Website: "agent-emulate.dev" }),
    );
    const res = await app.request(`${SF}/services/data/${V}/sobjects/Account/describe`, { headers: authH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; fields: Array<{ name: string }> };
    expect(body.name).toBe("Account");
    const names = body.fields.map((f) => f.name);
    expect(names).toContain("Id");
    expect(names).toContain("Name");
    expect(names).toContain("Website");
  });
});

describe("Salesforce — Feature 10: composite/sobjects collection create + auth", () => {
  it("creates multiple records in one call", async () => {
    const { app } = createTestApp();
    const res = await app.request(
      `${SF}/services/data/${V}/composite/sobjects`,
      post({
        allOrNone: false,
        records: [
          { attributes: { type: "Account" }, Name: "Batch A" },
          { attributes: { type: "Account" }, Name: "Batch B" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SfCreate[];
    expect(body).toHaveLength(2);
    expect(body.every((r) => r.success)).toBe(true);
  });

  it("rejects a missing Authorization header with 401 INVALID_SESSION_ID", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${SF}/services/data/${V}/sobjects/Account/001x`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Array<{ errorCode: string }>;
    expect(body[0].errorCode).toBe("INVALID_SESSION_ID");
  });
});
