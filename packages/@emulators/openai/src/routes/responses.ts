import type { RouteContext } from "@emulators/core";
import { DEFAULT_MODEL, cannedReply, contentToText, countTokens, generateId, lastUserText } from "../helpers.js";
import { isAuthed, unauthorized, badRequest, sseResponse, tokenize } from "./shared.js";

/** The Responses API (`/v1/responses`) — the surface the Codex CLI and the
 * modern OpenAI SDKs use. Accepts `input` as a string or a message array. */
export function responsesRoutes({ app }: RouteContext): void {
  app.post("/v1/responses", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "We could not parse the JSON body of your request.");
    }

    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    const prompt =
      typeof body.input === "string"
        ? body.input
        : Array.isArray(body.input)
          ? lastUserText(body.input) || contentToText(body.input)
          : "";
    const reply = cannedReply(prompt);
    const createdAt = Math.floor(Date.now() / 1000);
    const respId = generateId("resp");
    const msgId = generateId("msg");
    const inputTokens = countTokens(prompt);
    const outputTokens = countTokens(reply);

    const fullResponse = {
      id: respId,
      object: "response",
      created_at: createdAt,
      status: "completed",
      model,
      output: [
        {
          id: msgId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: reply, annotations: [] }],
        },
      ],
      output_text: reply,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      error: null,
      incomplete_details: null,
      instructions: typeof body.instructions === "string" ? body.instructions : null,
      metadata: {},
    };

    if (body.stream === true) {
      const frames: string[] = [];
      let seq = 0;
      const created = { ...fullResponse, status: "in_progress", output: [], output_text: "" };
      frames.push(
        `event: response.created\ndata: ${JSON.stringify({
          type: "response.created",
          sequence_number: seq++,
          response: created,
        })}\n\n`,
      );
      frames.push(
        `event: response.output_item.added\ndata: ${JSON.stringify({
          type: "response.output_item.added",
          sequence_number: seq++,
          output_index: 0,
          item: { id: msgId, type: "message", status: "in_progress", role: "assistant", content: [] },
        })}\n\n`,
      );
      for (const piece of tokenize(reply)) {
        frames.push(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            sequence_number: seq++,
            item_id: msgId,
            output_index: 0,
            content_index: 0,
            delta: piece,
          })}\n\n`,
        );
      }
      frames.push(
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          sequence_number: seq++,
          response: fullResponse,
        })}\n\n`,
      );
      return sseResponse(c, frames);
    }

    return c.json(fullResponse);
  });
}
