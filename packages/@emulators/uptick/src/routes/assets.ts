import type { RouteContext } from "@emulators/core";
import { formatAsset, formatDefect } from "../formatters.js";
import { parseId, parseJsonApiBody, relId, uptickError, uptickPaginate } from "../helpers.js";
import { getUptickStore } from "../store.js";

export function assetRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  app.get("/api/:ver/assets/", (c) => {
    const s = us();
    let assets = s.assets.all();

    const propertyFilter = c.req.query("property");
    if (propertyFilter) {
      const pid = parseInt(propertyFilter, 10);
      if (!isNaN(pid)) assets = assets.filter((a) => a.property_id === pid);
    }

    const clientFilter = c.req.query("client");
    if (clientFilter) {
      const cid = parseInt(clientFilter, 10);
      if (!isNaN(cid)) assets = assets.filter((a) => a.client_id === cid);
    }

    const isActive = c.req.query("is_active");
    if (isActive !== undefined) {
      const active = isActive !== "false";
      assets = assets.filter((a) => a.is_active === active);
    }

    const search = c.req.query("search")?.toLowerCase();
    if (search) {
      assets = assets.filter(
        (a) => a.name.toLowerCase().includes(search) || a.asset_number.toLowerCase().includes(search),
      );
    }

    return uptickPaginate(c, assets, (a) => formatAsset(a, s), `/api/${c.req.param("ver")}/assets/`);
  });

  app.post("/api/:ver/assets/", async (c) => {
    const s = us();
    const { attributes, relationships } = await parseJsonApiBody(c);
    const propertyId = relId(relationships.property as Record<string, unknown>);
    const clientId = relId(relationships.client as Record<string, unknown>);
    const assetTypeId = relId(relationships.asset_type as Record<string, unknown>);

    // Resolve asset_type_name from id if available
    const assetType = assetTypeId ? s.assetTypes.get(assetTypeId) : null;

    const asset = s.assets.insert({
      name: (attributes.name as string) ?? "New Asset",
      asset_number: (attributes.asset_number as string) ?? "",
      is_active: attributes.is_active !== false,
      standard_maintenance: (attributes.standard_maintenance as string) ?? "",
      property_id: propertyId ?? null,
      client_id: clientId ?? null,
      asset_type_id: assetTypeId ?? null,
      asset_type_name: assetType?.name ?? (attributes.asset_type_name as string) ?? "",
    });
    return c.json({ data: formatAsset(asset, s) }, 201);
  });

  // Nested sub-resource: defects belonging to an asset
  app.get("/api/:ver/assets/:id/defects/", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    if (!s.assets.get(id)) return uptickError(c, 404, "Not Found");
    const defects = s.defects.all().filter((d) => d.asset_id === id);
    return uptickPaginate(c, defects, (d) => formatDefect(d, s), `/api/${c.req.param("ver")}/assets/${id}/defects/`);
  });

  app.get("/api/:ver/assets/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const asset = s.assets.get(id);
    if (!asset) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatAsset(asset, s) });
  });

  app.patch("/api/:ver/assets/:id", async (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const existing = s.assets.get(id);
    if (!existing) return uptickError(c, 404, "Not Found");

    const { attributes, relationships } = await parseJsonApiBody(c);
    const propertyId = relId(relationships.property as Record<string, unknown>);
    const clientId = relId(relationships.client as Record<string, unknown>);
    const assetTypeId = relId(relationships.asset_type as Record<string, unknown>);
    const assetType = assetTypeId ? s.assetTypes.get(assetTypeId) : null;

    const updated = s.assets.update(id, {
      name: (attributes.name as string) ?? existing.name,
      asset_number: (attributes.asset_number as string) ?? existing.asset_number,
      is_active: attributes.is_active !== undefined ? (attributes.is_active as boolean) : existing.is_active,
      standard_maintenance: (attributes.standard_maintenance as string) ?? existing.standard_maintenance,
      property_id: propertyId ?? existing.property_id,
      client_id: clientId ?? existing.client_id,
      asset_type_id: assetTypeId ?? existing.asset_type_id,
      asset_type_name: assetType?.name ?? (attributes.asset_type_name as string) ?? existing.asset_type_name,
    });
    return c.json({ data: formatAsset(updated!, s) });
  });

  app.delete("/api/:ver/assets/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    if (!s.assets.get(id)) return uptickError(c, 404, "Not Found");
    s.assets.delete(id);
    return c.body(null, 204);
  });
}
