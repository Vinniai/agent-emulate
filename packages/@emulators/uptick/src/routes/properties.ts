import type { RouteContext } from "@emulators/core";
import { formatProperty } from "../formatters.js";
import { parseId, parseJsonApiBody, relId, uptickError, uptickPaginate } from "../helpers.js";
import { getUptickStore } from "../store.js";

export function propertyRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  app.get("/api/:ver/properties/", (c) => {
    const s = us();
    let properties = s.properties.all();

    const clientFilter = c.req.query("client");
    if (clientFilter) {
      const cid = parseInt(clientFilter, 10);
      if (!isNaN(cid)) properties = properties.filter((p) => p.client_id === cid);
    }

    const isActive = c.req.query("is_active");
    if (isActive !== undefined) {
      const active = isActive !== "false";
      properties = properties.filter((p) => p.is_active === active);
    }

    const search = c.req.query("search")?.toLowerCase();
    if (search) {
      properties = properties.filter((p) => p.name.toLowerCase().includes(search));
    }

    return uptickPaginate(c, properties, (p) => formatProperty(p, s), `/api/${c.req.param("ver")}/properties/`);
  });

  app.post("/api/:ver/properties/", async (c) => {
    const s = us();
    const { attributes, relationships } = await parseJsonApiBody(c);
    const clientId = relId(relationships.client as Record<string, unknown>) ?? 0;
    const addr = (attributes.address as Record<string, unknown>) ?? {};

    const property = s.properties.insert({
      name: (attributes.name as string) ?? "New Property",
      client_id: clientId,
      is_active: attributes.is_active !== false,
      address_display: (addr.display as string) ?? "",
      address_streetline: (addr.streetline as string) ?? "",
      address_city: (addr.city as string) ?? "",
      address_state: (addr.state as string) ?? "",
      address_postal_code: (addr.postal_code as string) ?? "",
      address_country: (addr.country as string) ?? "AU",
    });
    return c.json({ data: formatProperty(property, s) }, 201);
  });

  app.get("/api/:ver/properties/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const property = s.properties.get(id);
    if (!property) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatProperty(property, s) });
  });

  app.patch("/api/:ver/properties/:id", async (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const existing = s.properties.get(id);
    if (!existing) return uptickError(c, 404, "Not Found");

    const { attributes, relationships } = await parseJsonApiBody(c);
    const addr = (attributes.address as Record<string, unknown>) ?? {};
    const clientId = relId(relationships.client as Record<string, unknown>);

    const updated = s.properties.update(id, {
      name: (attributes.name as string) ?? existing.name,
      client_id: clientId ?? existing.client_id,
      is_active: attributes.is_active !== undefined ? (attributes.is_active as boolean) : existing.is_active,
      address_display: (addr.display as string) ?? existing.address_display,
      address_streetline: (addr.streetline as string) ?? existing.address_streetline,
      address_city: (addr.city as string) ?? existing.address_city,
      address_state: (addr.state as string) ?? existing.address_state,
      address_postal_code: (addr.postal_code as string) ?? existing.address_postal_code,
      address_country: (addr.country as string) ?? existing.address_country,
    });
    return c.json({ data: formatProperty(updated!, s) });
  });

  app.delete("/api/:ver/properties/:id", (c) => {
    const s = us();
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    if (!s.properties.get(id)) return uptickError(c, 404, "Not Found");
    s.properties.delete(id);
    return c.body(null, 204);
  });
}
