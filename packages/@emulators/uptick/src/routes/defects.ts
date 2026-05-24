import type { RouteContext } from "@emulators/core";
import { formatAsset, formatDefect } from "../formatters.js";
import { paginateItems, parseId, parseJsonApiBody, relId, uptickError, uptickPaginate } from "../helpers.js";
import { getUptickStore } from "../store.js";

export function defectRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  app.get("/api/:ver/defects/", (c) => {
    const s = us();
    let defects = s.defects.all();

    const assetFilter = c.req.query("asset");
    if (assetFilter) {
      const aid = parseInt(assetFilter, 10);
      if (!isNaN(aid)) defects = defects.filter((d) => d.asset_id === aid);
    }

    const propertyFilter = c.req.query("property");
    if (propertyFilter) {
      const pid = parseInt(propertyFilter, 10);
      if (!isNaN(pid)) defects = defects.filter((d) => d.property_id === pid);
    }

    const clientFilter = c.req.query("client");
    if (clientFilter) {
      const cid = parseInt(clientFilter, 10);
      if (!isNaN(cid)) defects = defects.filter((d) => d.client_id === cid);
    }

    // Accept both the bare `status` filter and JSON:API `filter[status]`.
    const statusFilter = c.req.query("status") ?? c.req.query("filter[status]");
    if (statusFilter) {
      defects = defects.filter((d) => d.status === statusFilter);
    }

    const severityFilter = c.req.query("severity") ?? c.req.query("filter[severity]");
    if (severityFilter) {
      defects = defects.filter((d) => d.severity === severityFilter);
    }

    const resourcePath = `/api/${c.req.param("ver")}/defects/`;

    // Compound document: ?include=asset attaches the related assets in a
    // top-level `included` array (JSON:API spec).
    const include = (c.req.query("include") ?? "").split(",").map((s) => s.trim());
    if (include.includes("asset")) {
      const { items, nextUrl, prevUrl } = paginateItems(c, defects, resourcePath);
      const assetIds = [...new Set(items.map((d) => d.asset_id).filter((id): id is number => id != null))];
      const included = assetIds
        .map((id) => s.assets.get(id))
        .filter((a) => a != null)
        .map((a) => formatAsset(a!, s));
      return c.json({
        data: items.map((d) => formatDefect(d, s)),
        included,
        links: { next: nextUrl, prev: prevUrl },
      });
    }

    return uptickPaginate(c, defects, (d) => formatDefect(d, s), resourcePath);
  });

  app.post("/api/:ver/defects/", async (c) => {
    const s = us();
    const { attributes, relationships } = await parseJsonApiBody(c);
    const assetId = relId(relationships.asset as Record<string, unknown>);
    const propertyId = relId(relationships.property as Record<string, unknown>);
    const clientId = relId(relationships.client as Record<string, unknown>);

    // Auto-resolve property and client from asset if not provided
    let resolvedPropertyId = propertyId;
    let resolvedClientId = clientId;
    if (assetId && !resolvedPropertyId) {
      const asset = s.assets.get(assetId);
      if (asset) {
        resolvedPropertyId = asset.property_id ?? null;
        resolvedClientId = resolvedClientId ?? asset.client_id ?? null;
      }
    }

    const defect = s.defects.insert({
      description: (attributes.description as string) ?? "",
      notes: (attributes.notes as string) ?? "",
      severity: (attributes.severity as string) ?? "",
      status: (attributes.status as string) ?? "open",
      asset_id: assetId ?? null,
      property_id: resolvedPropertyId ?? null,
      client_id: resolvedClientId ?? null,
    });
    return c.json({ data: formatDefect(defect, s) }, 201);
  });

  app.get("/api/:ver/defects/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const defect = s.defects.get(id);
    if (!defect) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatDefect(defect, s) });
  });

  app.patch("/api/:ver/defects/:id", async (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const existing = s.defects.get(id);
    if (!existing) return uptickError(c, 404, "Not Found");

    const { attributes, relationships } = await parseJsonApiBody(c);
    const assetId = relId(relationships.asset as Record<string, unknown>);
    const propertyId = relId(relationships.property as Record<string, unknown>);
    const clientId = relId(relationships.client as Record<string, unknown>);

    const updated = s.defects.update(id, {
      description: (attributes.description as string) ?? existing.description,
      notes: (attributes.notes as string) ?? existing.notes,
      severity: (attributes.severity as string) ?? existing.severity,
      status: (attributes.status as string) ?? existing.status,
      asset_id: assetId ?? existing.asset_id,
      property_id: propertyId ?? existing.property_id,
      client_id: clientId ?? existing.client_id,
    });
    return c.json({ data: formatDefect(updated!, s) });
  });

  app.delete("/api/:ver/defects/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    if (!s.defects.get(id)) return uptickError(c, 404, "Not Found");
    s.defects.delete(id);
    return c.body(null, 204);
  });
}
