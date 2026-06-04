import type { RouteContext } from "@emulators/core";
import { DEFAULT_MODEL, cannedReply, countTokens, lastUserText } from "../helpers.js";
import { generateId } from "../helpers.js";
import { isAuthed, unauthorized, badRequest, sseResponse, tokenize } from "./shared.js";

export function chatRoutes({ app }: RouteContext): void {
  app.post("/v1/chat/completions", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "We could not parse the JSON body of your request.");
    }

    const model = typeof body.model === "string" ? body.model : DEFAULT_MODEL;
    if (!body.messages) return badRequest(c, "Missing required parameter: 'messages'.", "missing_required_parameter");

    const prompt = lastUserText(body.messages);
    const reply = cannedReply(prompt);
    const created = Math.floor(Date.now() / 1000);
    const id = generateId("chatcmpl");
    const promptTokens = countTokens(prompt);
    const completionTokens = countTokens(reply);

    if (body.stream === true) {
      const frames: string[] = [];
      const base = { id, object: "chat.completion.chunk", created, model };
      frames.push(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
        })}\n\n`,
      );
      for (const piece of tokenize(reply)) {
        frames.push(
          `data: ${JSON.stringify({
            ...base,
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          })}\n\n`,
        );
      }
      frames.push(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      frames.push("data: [DONE]\n\n");
      return sseResponse(c, frames);
    }

    return c.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: reply, refusal: null },
          logprobs: null,
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
  });

  // Legacy text completions.
  app.post("/v1/completions", async (c) => {
    if (!isAuthed(c)) return unauthorized(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "We could not parse the JSON body of your request.");
    }
    const model = typeof body.model === "string" ? body.model : "gpt-3.5-turbo-instruct";
    const promptText = Array.isArray(body.prompt)
      ? String(body.prompt[0] ?? "")
      : typeof body.prompt === "string"
        ? body.prompt
        : "";
    const reply = cannedReply(promptText);
    const promptTokens = countTokens(promptText);
    const completionTokens = countTokens(reply);
    return c.json({
      id: generateId("cmpl"),
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ text: reply, index: 0, logprobs: null, finish_reason: "stop" }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
  });
}
