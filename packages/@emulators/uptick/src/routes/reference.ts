import type { RouteContext } from "@emulators/core";
import { formatAssetType, formatUser } from "../formatters.js";
import { parseId, parseJsonApiBody, uptickError, uptickPaginate } from "../helpers.js";
import { getUptickStore } from "../store.js";

export function referenceRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  // Asset types
  app.get("/api/:ver/assettypes/", (c) => {
    return uptickPaginate(c, us().assetTypes.all(), formatAssetType, `/api/${c.req.param("ver")}/assettypes/`);
  });

  app.post("/api/:ver/assettypes/", async (c) => {
    const { attributes } = await parseJsonApiBody(c);
    const at = us().assetTypes.insert({
      name: (attributes.name as string) ?? "New Asset Type",
      description: (attributes.description as string) ?? "",
    });
    return c.json({ data: formatAssetType(at) }, 201);
  });

  app.get("/api/:ver/assettypes/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const at = us().assetTypes.get(id);
    if (!at) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatAssetType(at) });
  });

  // Users
  app.get("/api/:ver/users/", (c) => {
    return uptickPaginate(c, us().users.all(), formatUser, `/api/${c.req.param("ver")}/users/`);
  });

  app.post("/api/:ver/users/", async (c) => {
    const { attributes } = await parseJsonApiBody(c);
    const user = us().users.insert({
      username: (attributes.username as string) ?? "newuser",
      email: (attributes.email as string) ?? "",
      first_name: (attributes.first_name as string) ?? "",
      last_name: (attributes.last_name as string) ?? "",
      is_active: attributes.is_active !== false,
    });
    return c.json({ data: formatUser(user) }, 201);
  });

  app.get("/api/:ver/users/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const user = us().users.get(id);
    if (!user) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatUser(user) });
  });

  // API version info
  app.get("/api/version/", (c) => {
    return c.json({
      latest: "v2.15",
      deprecated: [],
      imminent_removal: [],
      removed: [],
    });
  });

  // Self-describing endpoint index (for any version)
  app.get("/api/:ver/", (c) => {
    const ver = c.req.param("ver");
    const base = `/api/${ver}`;
    return c.json({
      clients: `${base}/clients/`,
      properties: `${base}/properties/`,
      assets: `${base}/assets/`,
      defects: `${base}/defects/`,
      assettypes: `${base}/assettypes/`,
      users: `${base}/users/`,
    });
  });
}
