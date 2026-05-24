import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fillSimproSwaggerRecordsFromSpec, seedFromConfig, storeToSeedConfig } from "../index.js";
import { BASE, auth, createTestApp, getAccessToken } from "./helpers.js";

describe("Simpro Swagger fallback", () => {
  it("serves documented routes that do not have hand-written stateful handlers yet", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/accounts/journals/?page=1&pageSize=10`, {
      headers: auth(token),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Result-Total")).toBe("0");
    expect(res.headers.get("Result-Pages")).toBe("1");
    expect(res.headers.get("Result-Count")).toBe("0");
    expect(await res.json()).toEqual([]);
  });

  it("returns schema-shaped detail responses for documented fallback routes", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/accounts/payable/contacts/123?columns=ID,Name`, {
      headers: auth(token),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ID: "CON123|VEN123", Name: "" });
  });

  it("persists spec-only collection writes in the generic Swagger seed store", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const create = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ Name: "Seeded catalog group" }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { ID: number; Name: string };
    expect(created.ID).toBe(1);

    const list = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/?columns=ID,Name`, {
      headers: auth(token),
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([{ ID: 1, Name: "Seeded catalog group" }]);

    const update = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/${created.ID}`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ Name: "Renamed catalog group" }),
    });
    expect(update.status).toBe(204);

    const detail = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/${created.ID}?columns=ID,Name`, {
      headers: auth(token),
    });
    expect(await detail.json()).toEqual({ ID: 1, Name: "Renamed catalog group" });

    const remove = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/${created.ID}`, {
      method: "DELETE",
      headers: auth(token),
    });
    expect(remove.status).toBe(204);

    const afterDelete = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/`, { headers: auth(token) });
    expect(await afterDelete.json()).toEqual([]);
  });

  it("round-trips generic Swagger records through seed import and export", async () => {
    const { app, store } = createTestApp({ seed: false });
    seedFromConfig(store, BASE, {
      swagger_records: {
        "/api/v1.0/companies/0/catalogGroups/": [{ ID: 77, Name: "Seed file group", DisplayOrder: 2 }],
      },
    });
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/?columns=ID,Name`, {
      headers: auth(token),
    });
    expect(await res.json()).toEqual([{ ID: 77, Name: "Seed file group" }]);

    expect(storeToSeedConfig(store, BASE).swagger_records).toEqual({
      "/api/v1.0/companies/0/catalogGroups/": [{ ID: 77, Name: "Seed file group", DisplayOrder: 2 }],
    });
  });

  it("can generate schema-complete Swagger records for profile seed exports", async () => {
    const { app, store } = createTestApp({ seed: false });
    fillSimproSwaggerRecordsFromSpec(store, {
      baseDate: "2026-05-20",
      pastDays: 14,
      futureDays: 14,
      frequencyDays: 7,
    });
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/catalogGroups/?columns=ID,Name`, {
      headers: auth(token),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Result-Total")).toBe("5");
    const rows = (await res.json()) as Array<{ ID?: number; Name?: string }>;
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => typeof row.ID === "number" && typeof row.Name === "string")).toBe(true);
    expect(storeToSeedConfig(store, BASE).swagger_records?.["/api/v1.0/companies/0/catalogGroups/"]).toHaveLength(5);
  });

  it("keeps undocumented routes as 404s", async () => {
    const { app } = createTestApp();
    const token = await getAccessToken(app);

    const res = await app.request(`${BASE}/api/v1.0/companies/0/notInTheSimproSpec/`, { headers: auth(token) });

    expect(res.status).toBe(404);
  });

  it("loads the full captured Simpro Swagger operation surface", () => {
    const specPath = resolve(process.cwd(), "../../../documentation/simpro-swagger.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const operations = Object.values(spec.paths).reduce(
      (count, pathItem) => count + Object.keys(pathItem).filter((key) => key !== "parameters").length,
      0,
    );

    expect(operations).toBe(1435);
  });
});
