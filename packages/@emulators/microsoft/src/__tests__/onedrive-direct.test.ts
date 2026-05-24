// Direct Microsoft Graph OneDrive (storage) tests — they drive
// `microsoftPlugin` in-process via a bare Hono app (no @emulators/nango /
// proxy / connection layer). The token map is seeded directly so we exercise
// the Graph drive surface without the OAuth dance. Each `describe` is one
// red-green TDD feature filling a real Graph /me/drive gap the emulator did
// not implement (root item, path addressing, folder-scoped create, copy,
// createLink, thumbnails, delta, drive-scoped addressing, recent, sharedWithMe).
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { Store, WebhookDispatcher, authMiddleware, type TokenMap } from "@emulators/core";
import { microsoftPlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:4000";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set("test-token", { login: "testuser@agent-emulate.dev", id: 1, scopes: ["Files.ReadWrite.All"] });

  const app = new Hono();
  app.use("*", authMiddleware(tokenMap));
  microsoftPlugin.register(app as any, store, webhooks, base, tokenMap);
  seedFromConfig(store, base, {
    users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
    drive_items: [
      { id: "folder-docs", name: "Documents", parent_id: "root" },
      {
        id: "file-report",
        name: "Report.docx",
        mime_type: "application/vnd.openxmlformats",
        parent_id: "folder-docs",
        size: 12,
      },
    ],
  });
  return { app, store };
}

const auth = (extra?: Record<string, string>) => ({ Authorization: "Bearer test-token", ...extra });
const jpost = (app: Hono, path: string, body: unknown) =>
  app.request(`${base}${path}`, {
    method: "POST",
    headers: auth({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

describe("OneDrive direct — Feature 1: GET /v1.0/me/drive/root", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns the root DriveItem (a folder)", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/root`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; folder?: unknown };
    expect(body.id).toBe("root");
    expect(body.folder).toBeTruthy();
  });
});

describe("OneDrive direct — Feature 2: GET /v1.0/me/drive/root:/{path}", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("resolves an item by its path", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/root:/Report.docx`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe("file-report");
    expect(body.name).toBe("Report.docx");
  });

  it("404s for an unknown path", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/root:/Nope.docx`, { headers: auth() });
    expect(res.status).toBe(404);
  });
});

describe("OneDrive direct — Feature 3: POST /v1.0/me/drive/items/:itemId/children", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("creates a child inside a specific folder", async () => {
    const res = await jpost(app, "/v1.0/me/drive/items/folder-docs/children", { name: "Sub", folder: {} });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; parentReference?: { id: string } };
    expect(body.name).toBe("Sub");
    expect(body.parentReference?.id).toBe("folder-docs");
  });
});

describe("OneDrive direct — Feature 4: POST /v1.0/me/drive/items/:itemId/copy", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns 202 with a Location monitor URL and the copy is discoverable", async () => {
    const res = await jpost(app, "/v1.0/me/drive/items/file-report/copy", { name: "Report (copy).docx" });
    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBeTruthy();

    const search = await app.request(`${base}/v1.0/me/drive/search?q=${encodeURIComponent("Report (copy)")}`, {
      headers: auth(),
    });
    const found = ((await search.json()) as { value: Array<{ name: string }> }).value;
    expect(found.some((f) => f.name === "Report (copy).docx")).toBe(true);
  });
});

describe("OneDrive direct — Feature 5: POST /v1.0/me/drive/items/:itemId/createLink", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns a sharing link permission", async () => {
    const res = await jpost(app, "/v1.0/me/drive/items/file-report/createLink", { type: "view", scope: "anonymous" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { link?: { webUrl?: string; type?: string; scope?: string } };
    expect(body.link?.webUrl).toBeTruthy();
    expect(body.link?.type).toBe("view");
    expect(body.link?.scope).toBe("anonymous");
  });
});

describe("OneDrive direct — Feature 6: GET /v1.0/me/drive/items/:itemId/thumbnails", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns a thumbnail set", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/items/file-report/thumbnails`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: Array<{ id: string; medium?: { url: string } }> };
    expect(body.value.length).toBeGreaterThan(0);
    expect(body.value[0].medium?.url).toBeTruthy();
  });
});

describe("OneDrive direct — Feature 7: GET /v1.0/me/drive/root/delta", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns all items plus a deltaLink", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/root/delta`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: unknown[]; "@odata.deltaLink"?: string };
    expect(body.value.length).toBeGreaterThanOrEqual(2);
    expect(body["@odata.deltaLink"]).toContain("token=");
  });
});

describe("OneDrive direct — Feature 8: GET /v1.0/drives/:driveId/items/:itemId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("resolves an item via drive-scoped addressing", async () => {
    const res = await app.request(`${base}/v1.0/drives/b!abc/items/file-report`, { headers: auth() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe("file-report");
  });

  it("404s for an unknown item", async () => {
    const res = await app.request(`${base}/v1.0/drives/b!abc/items/file-nope`, { headers: auth() });
    expect(res.status).toBe(404);
  });
});

describe("OneDrive direct — Feature 9: GET /v1.0/me/drive/recent", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("lists recent files", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/recent`, { headers: auth() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value: unknown[] }).value.length).toBeGreaterThan(0);
  });
});

describe("OneDrive direct — Feature 10: GET /v1.0/me/drive/sharedWithMe", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns a (possibly empty) shared-items collection", async () => {
    const res = await app.request(`${base}/v1.0/me/drive/sharedWithMe`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: unknown[] };
    expect(Array.isArray(body.value)).toBe(true);
  });
});
