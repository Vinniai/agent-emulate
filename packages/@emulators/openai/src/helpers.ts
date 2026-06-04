import { randomBytes } from "crypto";

export function generateId(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}

/** Models the emulator advertises. Static; real inference is not performed. */
export const OPENAI_MODELS = [
  "gpt-5.1",
  "gpt-5.1-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "o4-mini",
  "text-embedding-3-small",
] as const;

export const DEFAULT_MODEL = "gpt-4o-mini";

/** Rough whitespace token estimate — enough for plausible usage numbers. */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
}

type ChatContentPart = { type?: string; text?: string };
type ChatMessage = { role?: string; content?: string | ChatContentPart[] };

/** Flatten a chat/messages `content` (string or content-part array) to text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = part as ChatContentPart;
        return typeof p?.text === "string" ? p.text : "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** The text of the last user-authored message in a chat array. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage;
    if (m?.role === "user") return contentToText(m.content);
  }
  // Fall back to the last message of any role.
  const last = messages[messages.length - 1] as ChatMessage | undefined;
  return last ? contentToText(last.content) : "";
}

/**
 * Deterministic canned assistant reply. No model is run — the emulator echoes
 * the prompt so consumers can assert on a stable, prompt-derived response.
 */
export function cannedReply(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "Hello! This is a canned response from the agent-emulate OpenAI emulator.";
  }
  return `This is a canned response from the agent-emulate OpenAI emulator. You said: "${trimmed}"`;
}
