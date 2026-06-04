import type { RouteContext } from "@emulators/core";
import { ANTHROPIC_MODELS } from "../helpers.js";
import { isAuthed, unauthorized } from "./shared.js";

export function modelsRoutes({ app }: RouteContext): void {
  app.get("/v1/models", (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    const data = ANTHROPIC_MODELS.map((m) => ({
      type: "model",
      id: m.id,
      display_name: m.display_name,
      created_at: "2025-01-01T00:00:00Z",
    }));
    return c.json({
      data,
      has_more: false,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
    });
  });

  app.get("/v1/models/:model", (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    const id = c.req.param("model");
    const model = ANTHROPIC_MODELS.find((m) => m.id === id);
    if (!model) {
      return c.json({ type: "error", error: { type: "not_found_error", message: `model: ${id}` } }, 404);
    }
    return c.json({
      type: "model",
      id: model.id,
      display_name: model.display_name,
      created_at: "2025-01-01T00:00:00Z",
    });
  });
}
