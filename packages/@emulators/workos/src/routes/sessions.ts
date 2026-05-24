import type { AppEnv } from "@emulators/core";
import type { Hono } from "hono";
import type { WorkOSStoreFacade } from "../store.js";

export function sessionRoutes(app: Hono<AppEnv>, ws: WorkOSStoreFacade): void {
  app.get("/user_management/sessions/:sessionId", (c) => {
    const session = ws.getSession(c.req.param("sessionId"));
    if (!session) return c.json({ code: "entity_not_found", message: "Session not found" }, 404);
    return c.json({ object: "session", ...session });
  });

  app.delete("/user_management/sessions/:sessionId", (c) => {
    ws.revokeSession(c.req.param("sessionId"));
    return c.body(null, 204);
  });
}
