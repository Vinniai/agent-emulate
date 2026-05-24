import { describe, it, expect } from "vitest";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro companies (multi-company root)", () => {
  it("lists companies and resolves one by id", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const list = await app.request(`${BASE}/api/v1.0/companies/`, { headers: auth(token) });
    expect(list.status).toBe(200);
    const companies = (await list.json()) as Array<{ ID: number; Name: string }>;
    expect(companies).toEqual([{ ID: 0, Name: "Emulator Co" }]);

    const one = await app.request(`${BASE}/api/v1.0/companies/0`, { headers: auth(token) });
    expect(one.status).toBe(200);
    expect((await one.json()) as Record<string, unknown>).toEqual({ ID: 0, Name: "Emulator Co" });
  });

  it("unknown company id → Simpro 404 envelope", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/42`, { headers: auth(token) });
    expect(res.status).toBe(404);
    const err = (await res.json()) as { errors: Array<{ path: string | null; message: string; value: unknown }> };
    expect(err.errors).toEqual([{ path: null, message: "Invalid route.", value: null }]);
  });
});

describe("Simpro webhook subscriptions", () => {
  it("POST returns the signing Secret + 201; list/get omit the Secret", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const created = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ URL: "https://agent-emulate.dev/hook", Events: ["job.created", "job.updated"] }),
    });
    expect(created.status).toBe(201);
    const sub = (await created.json()) as {
      ID: number;
      URL: string;
      Events: string[];
      Secret: string;
      Active: boolean;
    };
    expect(sub).toMatchObject({
      URL: "https://agent-emulate.dev/hook",
      Events: ["job.created", "job.updated"],
      Active: true,
    });
    expect(typeof sub.Secret).toBe("string");
    expect(sub.Secret.length).toBeGreaterThan(0);

    const list = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/`, { headers: auth(token) });
    const items = (await list.json()) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ ID: sub.ID, URL: sub.URL, Events: sub.Events, Active: true });
    expect(items[0].Secret).toBeUndefined();

    const got = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/${sub.ID}`, { headers: auth(token) });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { ID: number }).ID).toBe(sub.ID);
  });

  it("POST without URL → 422 validation envelope", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Events: ["job.created"] }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { errors: Array<{ path: string }> }).errors[0].path).toBe("URL");
  });

  it("DELETE returns 204 and the subscription is gone", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const created = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ URL: "https://agent-emulate.dev/hook", Events: ["job.created"] }),
    });
    const { ID } = (await created.json()) as { ID: number };

    const del = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/${ID}`, {
      method: "DELETE",
      headers: auth(token),
    });
    expect(del.status).toBe(204);

    const after = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/${ID}`, { headers: auth(token) });
    expect(after.status).toBe(404);
  });

  it("_events debug endpoint returns the delivery log array", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/setup/webhooks/_events`, { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
