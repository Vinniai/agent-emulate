import type { RouteContext } from "@emulators/core";
import type { Context } from "hono";
import {
  createDriveItemRecord,
  formatDriveItemResource,
  getDriveItemById,
  listDriveItems,
  parseDriveMultipartUpload,
  updateDriveItemRecord,
} from "../drive-helpers.js";
import { generateUid, googleApiError } from "../helpers.js";
import {
  getRecord,
  getString,
  parseDriveItemInputFromBody,
  parseGoogleBody,
  requireGoogleAuth,
} from "../route-helpers.js";
import { getGoogleStore } from "../store.js";

export function driveRoutes({ app, store }: RouteContext): void {
  const gs = getGoogleStore(store);

  const createHandler = async (c: Context) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const contentType = c.req.header("Content-Type") ?? "";
    let requestBody: Record<string, unknown> = {};
    let media: { mimeType: string; body: Buffer } | undefined;

    if (contentType.includes("multipart/related")) {
      const rawBody = Buffer.from(await c.req.raw.arrayBuffer());
      const parsed = parseDriveMultipartUpload(contentType, rawBody);
      requestBody = parsed.requestBody;
      media = parsed.media;
    } else {
      const body = await parseGoogleBody(c);
      requestBody = getRecord(body, "requestBody") ?? body;
    }

    const item = createDriveItemRecord(gs, {
      user_email: authEmail,
      ...parseDriveItemInputFromBody(requestBody, {
        mimeType: media?.mimeType,
      }),
      size: media ? media.body.length : null,
      data: media ? media.body.toString("base64url") : null,
    });
    return c.json(formatDriveItemResource(item));
  };

  // GET /drive/v3/about — used by getConnectionIdentity in Google Drive provider
  app.get("/drive/v3/about", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const user = gs.users.findOneBy("email", authEmail);
    return c.json({
      kind: "drive#about",
      user: {
        displayName: user?.name ?? authEmail.split("@")[0],
        emailAddress: authEmail,
        photoLink: `https://lh3.googleusercontent.com/a/default`,
        me: true,
        permissionId: user?.id?.toString() ?? "1",
      },
      storageQuota: {
        limit: "16106127360",
        usage: "52428800",
        usageInDrive: "52428800",
        usageInDriveTrash: "0",
      },
    });
  });

  app.get("/drive/v3/files", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const url = new URL(c.req.url);
    const response = listDriveItems(gs, authEmail, {
      q: url.searchParams.get("q"),
      pageSize: url.searchParams.get("pageSize"),
      pageToken: url.searchParams.get("pageToken"),
      orderBy: url.searchParams.get("orderBy"),
    });

    return c.json({
      kind: "drive#fileList",
      files: response.files.map((item) => formatDriveItemResource(item)),
      nextPageToken: response.nextPageToken,
    });
  });

  app.post("/drive/v3/files", createHandler);
  app.post("/upload/drive/v3/files", createHandler);

  app.get("/drive/v3/files/:fileId", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const item = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const url = new URL(c.req.url);
    if (url.searchParams.get("alt") === "media") {
      if (item.mime_type.startsWith("application/vnd.google-apps.")) {
        return googleApiError(
          c,
          403,
          "Only files with binary content can be downloaded. Use Export with Docs Editors files.",
          "fileNotDownloadable",
          "PERMISSION_DENIED",
        );
      }
      return new Response(item.data ? Buffer.from(item.data, "base64url") : Buffer.alloc(0), {
        status: 200,
        headers: {
          "Content-Type": item.mime_type,
        },
      });
    }

    return c.json(formatDriveItemResource(item));
  });

  const updateHandler = async (c: Context) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;

    const item = getDriveItemById(gs, authEmail, c.req.param("fileId")!);
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }

    const url = new URL(c.req.url);
    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const addParents = (url.searchParams.get("addParents") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const removeParents = (url.searchParams.get("removeParents") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const updated = updateDriveItemRecord(gs, item, {
      addParents,
      removeParents,
      name: getString(requestBody, "name"),
      trashed: typeof requestBody.trashed === "boolean" ? requestBody.trashed : undefined,
    });

    return c.json(formatDriveItemResource(updated));
  };

  app.patch("/drive/v3/files/:fileId", updateHandler);
  app.put("/drive/v3/files/:fileId", updateHandler);

  // POST /drive/v3/files/generateIds — pre-allocate file ids
  app.post("/drive/v3/files/generateIds", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const url = new URL(c.req.url);
    const count = Math.min(Math.max(Number(url.searchParams.get("count") ?? "10") || 10, 1), 1000);
    const space = url.searchParams.get("space") ?? "drive";
    return c.json({
      kind: "drive#generatedIds",
      space,
      ids: Array.from({ length: count }, () => generateUid("drv")),
    });
  });

  // DELETE /drive/v3/files/trash — empty trash (registered before :fileId)
  app.delete("/drive/v3/files/trash", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    for (const item of gs.driveItems.findBy("user_email", authEmail)) {
      if (item.trashed) gs.driveItems.delete(item.id);
    }
    return c.body(null, 204);
  });

  // DELETE /drive/v3/files/:fileId — permanent delete
  app.delete("/drive/v3/files/:fileId", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const item = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    for (const perm of gs.drivePermissions.findBy("file_google_id", item.google_id)) {
      gs.drivePermissions.delete(perm.id);
    }
    gs.driveItems.delete(item.id);
    return c.body(null, 204);
  });

  // POST /drive/v3/files/:fileId/copy
  app.post("/drive/v3/files/:fileId/copy", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const source = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!source) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const copy = createDriveItemRecord(gs, {
      user_email: authEmail,
      name: getString(requestBody, "name") ?? `Copy of ${source.name}`,
      mime_type: source.mime_type,
      parent_google_ids: source.parent_google_ids,
      size: source.size,
      data: source.data,
    });
    return c.json(formatDriveItemResource(copy));
  });

  // GET /drive/v3/files/:fileId/export — export a Docs-Editors file
  app.get("/drive/v3/files/:fileId/export", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const item = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    const mimeType = new URL(c.req.url).searchParams.get("mimeType");
    if (!mimeType) {
      return googleApiError(c, 400, "The 'mimeType' parameter is required.", "badRequest", "INVALID_ARGUMENT");
    }
    const payload = item.data
      ? Buffer.from(item.data, "base64url")
      : Buffer.from(`Exported "${item.name}" as ${mimeType}`, "utf-8");
    return new Response(payload, { status: 200, headers: { "Content-Type": mimeType } });
  });

  // POST /drive/v3/files/:fileId/permissions — grant access
  app.post("/drive/v3/files/:fileId/permissions", async (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const item = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    const body = await parseGoogleBody(c);
    const requestBody = getRecord(body, "requestBody") ?? body;
    const perm = gs.drivePermissions.insert({
      google_id: generateUid("perm"),
      file_google_id: item.google_id,
      user_email: authEmail,
      type: getString(requestBody, "type") ?? "user",
      role: getString(requestBody, "role") ?? "reader",
      email_address: getString(requestBody, "emailAddress") ?? null,
    });
    return c.json({
      kind: "drive#permission",
      id: perm.google_id,
      type: perm.type,
      role: perm.role,
      emailAddress: perm.email_address ?? undefined,
    });
  });

  // GET /drive/v3/files/:fileId/permissions — list access (incl. implicit owner)
  app.get("/drive/v3/files/:fileId/permissions", (c) => {
    const authEmail = requireGoogleAuth(c);
    if (authEmail instanceof Response) return authEmail;
    const item = getDriveItemById(gs, authEmail, c.req.param("fileId"));
    if (!item) {
      return googleApiError(c, 404, "Requested entity was not found.", "notFound", "NOT_FOUND");
    }
    const owner = {
      kind: "drive#permission",
      id: `owner-${item.user_email}`,
      type: "user",
      role: "owner",
      emailAddress: item.user_email,
    };
    const granted = gs.drivePermissions.findBy("file_google_id", item.google_id).map((p) => ({
      kind: "drive#permission",
      id: p.google_id,
      type: p.type,
      role: p.role,
      emailAddress: p.email_address ?? undefined,
    }));
    return c.json({ kind: "drive#permissionList", permissions: [owner, ...granted] });
  });
}
