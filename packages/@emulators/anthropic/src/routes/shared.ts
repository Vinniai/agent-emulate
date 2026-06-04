import type { Context } from "hono";

/** Anthropic SDKs authenticate with the `x-api-key` header (not Bearer). Accept
 * that natively, and also accept an OAuth bearer token resolved into `authUser`
 * by the core middleware — any non-empty credential passes, like the other
 * emulators' permissive fallback. */
export function isAuthed(c: Context): boolean {
  if (c.get("authUser")) return true;
  const apiKey = c.req.header("x-api-key");
  return !!apiKey && apiKey.length > 0;
}

export function unauthorized(c: Context): Response {
  return c.json(
    {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    },
    401,
  );
}

export function invalidRequest(c: Context, message: string): Response {
  return c.json({ type: "error", error: { type: "invalid_request_error", message } }, 400);
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
