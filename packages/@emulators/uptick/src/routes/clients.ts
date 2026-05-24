import type { RouteContext } from "@emulators/core";
import { formatClient } from "../formatters.js";
import { parseId, parseJsonApiBody, uptickError, uptickPaginate } from "../helpers.js";
import { getUptickStore } from "../store.js";

export function clientRoutes({ app, store }: RouteContext): void {
  const us = () => getUptickStore(store);

  // List clients
  app.get("/api/:ver/clients/", (c) => {
    let clients = us().clients.all();

    const isActive = c.req.query("is_active");
    if (isActive !== undefined) {
      const active = isActive !== "false";
      clients = clients.filter((cl) => cl.is_active === active);
    }

    const search = c.req.query("search")?.toLowerCase();
    if (search) {
      clients = clients.filter(
        (cl) =>
          cl.name.toLowerCase().includes(search) ||
          cl.contact_email.toLowerCase().includes(search) ||
          cl.contact_name.toLowerCase().includes(search),
      );
    }

    return uptickPaginate(c, clients, formatClient, `/api/${c.req.param("ver")}/clients/`);
  });

  // Create client
  app.post("/api/:ver/clients/", async (c) => {
    const { attributes } = await parseJsonApiBody(c);
    const client = us().clients.insert({
      name: (attributes.name as string) ?? "New Client",
      is_active: attributes.is_active !== false,
      sector: (attributes.sector as string) ?? "",
      ref: (attributes.ref as string) ?? "",
      contact_name: (attributes.contact_name as string) ?? "",
      contact_email: (attributes.contact_email as string) ?? "",
    });
    return c.json({ data: formatClient(client) }, 201);
  });

  // Get single client
  app.get("/api/:ver/clients/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const client = us().clients.get(id);
    if (!client) return uptickError(c, 404, "Not Found");
    return c.json({ data: formatClient(client) });
  });

  // Update client
  app.patch("/api/:ver/clients/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    const s = us();
    const existing = s.clients.get(id);
    if (!existing) return uptickError(c, 404, "Not Found");
    const { attributes } = await parseJsonApiBody(c);
    const updated = s.clients.update(id, {
      name: (attributes.name as string) ?? existing.name,
      is_active: attributes.is_active !== undefined ? (attributes.is_active as boolean) : existing.is_active,
      sector: (attributes.sector as string) ?? existing.sector,
      ref: (attributes.ref as string) ?? existing.ref,
      contact_name: (attributes.contact_name as string) ?? existing.contact_name,
      contact_email: (attributes.contact_email as string) ?? existing.contact_email,
    });
    return c.json({ data: formatClient(updated!) });
  });

  // Delete client
  app.delete("/api/:ver/clients/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return uptickError(c, 400, "Invalid ID");
    if (!us().clients.get(id)) return uptickError(c, 404, "Not Found");
    us().clients.delete(id);
    return c.body(null, 204);
  });
}
