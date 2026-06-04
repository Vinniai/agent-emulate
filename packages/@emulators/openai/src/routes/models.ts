import type { RouteContext } from "@emulators/core";
import { OPENAI_MODELS } from "../helpers.js";
import { isAuthed, unauthorized } from "./shared.js";

export function modelsRoutes({ app }: RouteContext): void {
  app.get("/v1/models", (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    return c.json({
      object: "list",
      data: OPENAI_MODELS.map((id) => ({
        id,
        object: "model",
        created: 1700000000,
        owned_by: "openai",
      })),
    });
  });

  app.get("/v1/models/:model", (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    const model = c.req.param("model");
    if (!OPENAI_MODELS.includes(model as (typeof OPENAI_MODELS)[number])) {
      return c.json(
        {
          error: {
            message: `The model '${model}' does not exist or you do not have access to it.`,
            type: "invalid_request_error",
            param: null,
            code: "model_not_found",
          },
        },
        404,
      );
    }
    return c.json({ id: model, object: "model", created: 1700000000, owned_by: "openai" });
  });
}
