import type { RouteContext } from "@emulators/core";
import {
  DEFAULT_MODEL,
  cannedReply,
  contentToText,
  countInputTokens,
  countTokens,
  generateId,
  lastUserText,
} from "../helpers.js";
import { isAuthed, unauthorized, invalidRequest, sseResponse, tokenize } from "./shared.js";

export function messagesRoutes({ app }: RouteContext): void {
  app.post("/v1/messages", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return invalidRequest(c, "Could not parse the request body as JSON.");
    }

    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    if (!body.messages) return invalidRequest(c, "messages: field required");
    if (body.max_tokens === undefined) return invalidRequest(c, "max_tokens: field required");

    const prompt = lastUserText(body.messages);
    const reply = cannedReply(prompt);
    const id = generateId("msg");
    const inputTokens = countInputTokens(body.system, body.messages);
    const outputTokens = countTokens(reply);

    if (body.stream === true) {
      const frames: string[] = [];
      const message = {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [] as unknown[],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      };
      frames.push(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message })}\n\n`);
      frames.push(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        })}\n\n`,
      );
      frames.push(`event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`);
      for (const piece of tokenize(reply)) {
        frames.push(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: piece },
          })}\n\n`,
        );
      }
      frames.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
      frames.push(
        `event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: outputTokens },
        })}\n\n`,
      );
      frames.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      return sseResponse(c, frames);
    }

    return c.json({
      id,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: reply }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
  });

  // Token counting endpoint.
  app.post("/v1/messages/count_tokens", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return invalidRequest(c, "Could not parse the request body as JSON.");
    }
    if (!body.messages) return invalidRequest(c, "messages: field required");
    return c.json({ input_tokens: countInputTokens(body.system, body.messages) });
  });

  // Legacy Text Completions API.
  app.post("/v1/complete", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return invalidRequest(c, "Could not parse the request body as JSON.");
    }
    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    const prompt = contentToText(body.prompt);
    return c.json({
      type: "completion",
      id: generateId("compl"),
      completion: " " + cannedReply(prompt),
      stop_reason: "stop_sequence",
      model,
    });
  });
}
