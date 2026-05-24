// Direct Google Drive (storage) tests — they drive `googlePlugin` in-process
// via a bare Hono app (no @emulators/nango / proxy / connection layer). Each
// `describe` is one red-green TDD feature filling a real Drive v3 API gap the
// emulator did not implement (delete, trash, copy, generateIds, emptyTrash,
// permissions, export, webContentLink, non-downloadable Docs).
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  Store,
  WebhookDispatcher,
  authMiddleware,
  createApiErrorHandler,
  createErrorHandler,
  type TokenMap,
} from "@emulators/core";
import { googlePlugin, seedFromConfig } from "../index.js";

const base = "http://localhost:4000";
const DOC_MIME = "application/vnd.google-apps.document";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set("test-token", { login: "testuser@agent-emulate.dev", id: 1, scopes: ["openid", "email", "profile"] });

  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  googlePlugin.register(app as any, store, webhooks, base, tokenMap);
  seedFromConfig(store, base, {
    users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
    drive_items: [
      {
        id: "drv_folder",
        user_email: "testuser@agent-emulate.dev",
        name: "Folder",
        mime_type: "application/vnd.google-apps.folder",
        parent_ids: ["root"],
      },
      {
        id: "drv_pdf",
        user_email: "testuser@agent-emulate.dev",
        name: "Report.pdf",
        mime_type: "application/pdf",
        parent_ids: ["drv_folder"],
        data: "report-bytes",
      },
      {
        id: "drv_doc",
        user_email: "testuser@agent-emulate.dev",
        name: "Proposal",
        mime_type: DOC_MIME,
        parent_ids: ["drv_folder"],
      },
    ],
  });
  return { app };
}

const auth = (extra?: Record<string, string>) => ({ Authorization: "Bearer test-token", ...extra });
const jreq = (app: Hono, path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: auth({ "Content-Type": "application/json" }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("Drive direct — Feature 1: DELETE /drive/v3/files/:fileId", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("hard-deletes a file (204) then GET 404s", async () => {
    const del = await app.request(`${base}/drive/v3/files/drv_pdf`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(204);
    const get = await app.request(`${base}/drive/v3/files/drv_pdf`, { headers: auth() });
    expect(get.status).toBe(404);
  });

  it("404s when deleting an unknown file", async () => {
    const del = await app.request(`${base}/drive/v3/files/drv_nope`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(404);
  });
});

describe("Drive direct — Feature 2: PATCH { trashed: true }", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("marks trashed, hides it from a `trashed = false` listing, GET still returns it", async () => {
    const patch = await jreq(app, "/drive/v3/files/drv_pdf", { method: "PATCH", body: { trashed: true } });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { trashed?: boolean }).trashed).toBe(true);

    const list = await app.request(`${base}/drive/v3/files?q=${encodeURIComponent("trashed = false")}`, {
      headers: auth(),
    });
    const ids = ((await list.json()) as { files: Array<{ id: string }> }).files.map((f) => f.id);
    expect(ids).not.toContain("drv_pdf");

    const get = await app.request(`${base}/drive/v3/files/drv_pdf`, { headers: auth() });
    expect(((await get.json()) as { trashed?: boolean }).trashed).toBe(true);
  });
});

describe("Drive direct — Feature 3: POST /drive/v3/files/:fileId/copy", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("copies content under a new id with an overridable name", async () => {
    const res = await jreq(app, "/drive/v3/files/drv_pdf/copy", {
      method: "POST",
      body: { name: "Report (copy).pdf" },
    });
    expect(res.status).toBe(200);
    const copy = (await res.json()) as { id: string; name: string; mimeType: string };
    expect(copy.id).not.toBe("drv_pdf");
    expect(copy.name).toBe("Report (copy).pdf");
    expect(copy.mimeType).toBe("application/pdf");

    const media = await app.request(`${base}/drive/v3/files/${copy.id}?alt=media`, { headers: auth() });
    expect(await media.text()).toBe("report-bytes");
  });
});

describe("Drive direct — Feature 4: POST /drive/v3/files/generateIds", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns the requested number of ids", async () => {
    const res = await app.request(`${base}/drive/v3/files/generateIds?count=3`, { method: "POST", headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; space: string; ids: string[] };
    expect(body.kind).toBe("drive#generatedIds");
    expect(body.space).toBe("drive");
    expect(body.ids).toHaveLength(3);
  });
});

describe("Drive direct — Feature 5: DELETE /drive/v3/files/trash (emptyTrash)", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("permanently removes only trashed files", async () => {
    await jreq(app, "/drive/v3/files/drv_pdf", { method: "PATCH", body: { trashed: true } });
    const empty = await app.request(`${base}/drive/v3/files/trash`, { method: "DELETE", headers: auth() });
    expect(empty.status).toBe(204);

    const gone = await app.request(`${base}/drive/v3/files/drv_pdf`, { headers: auth() });
    expect(gone.status).toBe(404);
    const kept = await app.request(`${base}/drive/v3/files/drv_doc`, { headers: auth() });
    expect(kept.status).toBe(200);
  });
});

describe("Drive direct — Feature 6: POST /drive/v3/files/:fileId/permissions", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("creates an anyone-reader permission", async () => {
    const res = await jreq(app, "/drive/v3/files/drv_pdf/permissions", {
      method: "POST",
      body: { role: "reader", type: "anyone" },
    });
    expect(res.status).toBe(200);
    const perm = (await res.json()) as { id: string; kind: string; type: string; role: string };
    expect(perm).toMatchObject({ kind: "drive#permission", type: "anyone", role: "reader" });
    expect(perm.id).toBeTruthy();
  });
});

describe("Drive direct — Feature 7: GET /drive/v3/files/:fileId/permissions", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("lists permissions including a newly granted one", async () => {
    await jreq(app, "/drive/v3/files/drv_pdf/permissions", {
      method: "POST",
      body: { role: "reader", type: "anyone" },
    });
    const res = await app.request(`${base}/drive/v3/files/drv_pdf/permissions`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; permissions: Array<{ type: string; role: string }> };
    expect(body.kind).toBe("drive#permissionList");
    expect(body.permissions.some((p) => p.type === "anyone" && p.role === "reader")).toBe(true);
  });
});

describe("Drive direct — Feature 8: GET /drive/v3/files/:fileId/export", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("exports a Google-Apps doc to the requested mime type", async () => {
    const res = await app.request(`${base}/drive/v3/files/drv_doc/export?mimeType=application/pdf`, {
      headers: auth(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

describe("Drive direct — Feature 9: webContentLink on binary files", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("exposes a download link that references the file id", async () => {
    const res = await app.request(`${base}/drive/v3/files/drv_pdf`, { headers: auth() });
    const file = (await res.json()) as { webContentLink?: string };
    expect(file.webContentLink).toBeTruthy();
    expect(file.webContentLink).toContain("drv_pdf");
  });
});

describe("Drive direct — Feature 10: alt=media on a Google-Apps Doc is 403", () => {
  let app: Hono;
  beforeEach(() => {
    app = createTestApp().app;
  });

  it("refuses to download a Doc (must export instead)", async () => {
    const res = await app.request(`${base}/drive/v3/files/drv_doc?alt=media`, { headers: auth() });
    expect(res.status).toBe(403);
  });
});
