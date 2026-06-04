import type { RouteContext } from "@emulators/core";
import { countTokens } from "../helpers.js";
import { isAuthed, unauthorized, badRequest } from "./shared.js";

/** Deterministic pseudo-embedding so vectors are stable across runs without
 * running a real model. Values are derived from the input text + index. */
function pseudoEmbedding(text: string, dims: number): number[] {
  const vec = new Array<number>(dims);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < dims; i++) {
    h ^= i + 0x9e3779b9;
    h = Math.imul(h, 16777619);
    // Map to roughly [-1, 1].
    vec[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
  }
  return vec;
}

export function embeddingsRoutes({ app }: RouteContext): void {
  app.post("/v1/embeddings", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "We could not parse the JSON body of your request.");
    }
    if (!body.input) return badRequest(c, "Missing required parameter: 'input'.", "missing_required_parameter");

    const model = typeof body.model === "string" ? body.model : "text-embedding-3-small";
    const dims = typeof body.dimensions === "number" ? body.dimensions : 1536;
    const inputs = Array.isArray(body.input) ? body.input.map((x) => String(x)) : [String(body.input)];
    // The OpenAI SDK requests base64 by default and decodes a Float32Array
    // client-side; honor `encoding_format` exactly like the real API.
    const format = body.encoding_format === "base64" ? "base64" : "float";

    const data = inputs.map((text, index) => {
      const vec = pseudoEmbedding(text, dims);
      let embedding: number[] | string = vec;
      if (format === "base64") {
        const f32 = Float32Array.from(vec);
        embedding = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString("base64");
      }
      return { object: "embedding", index, embedding };
    });
    const promptTokens = inputs.reduce((sum, t) => sum + countTokens(t), 0);

    return c.json({
      object: "list",
      data,
      model,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    });
  });
}
