import type { Context } from "hono";

/** OpenAI authenticates with `Authorization: Bearer sk-...`, which the core
 * auth middleware resolves into `authUser` (any non-empty key is accepted via
 * the standalone server's fallback, mirroring every other emulator). */
export function isAuthed(c: Context): boolean {
  return !!c.get("authUser");
}

export function unauthorized(c: Context): Response {
  return c.json(
    {
      error: {
        message:
          "Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.",
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key",
      },
    },
    401,
  );
}

export function badRequest(c: Context, message: string, code = "invalid_request_error"): Response {
  return c.json({ error: { message, type: "invalid_request_error", param: null, code } }, 400);
}

/** Emit a pre-built list of SSE frames as a streamed response. */
export function sseResponse(c: Context, frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return c.body(stream, 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

/** Split a reply into streamable token-ish pieces (keeps trailing spaces). */
export function tokenize(text: string): string[] {
  const parts = text.match(/\S+\s*/g);
  return parts && parts.length ? parts : [text];
}
