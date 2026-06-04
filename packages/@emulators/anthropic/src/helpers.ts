import { randomBytes } from "crypto";

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

/** Models the emulator advertises. Static; no real inference happens. */
export const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-1-20250805", display_name: "Claude Opus 4.1" },
  { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
  { id: "claude-3-7-sonnet-20250219", display_name: "Claude Sonnet 3.7" },
  { id: "claude-3-5-haiku-20241022", display_name: "Claude Haiku 3.5" },
] as const;

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Rough whitespace token estimate — enough for plausible usage numbers. */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
}

type ContentBlock = { type?: string; text?: string };
type Message = { role?: string; content?: string | ContentBlock[] };

/** Flatten a message `content` (string or content-block array) to plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        const b = block as ContentBlock;
        return typeof b?.text === "string" ? b.text : "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** The text of the last user-authored message in a messages array. */
export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Message;
    if (m?.role === "user") return contentToText(m.content);
  }
  const last = messages[messages.length - 1] as Message | undefined;
  return last ? contentToText(last.content) : "";
}

/** Sum of input tokens across system + all messages. */
export function countInputTokens(system: unknown, messages: unknown): number {
  let total = countTokens(contentToText(system));
  if (Array.isArray(messages)) {
    for (const m of messages) total += countTokens(contentToText((m as Message).content));
  }
  return Math.max(1, total);
}

/**
 * Deterministic canned assistant reply. No model is run — the emulator echoes
 * the prompt so consumers can assert on a stable, prompt-derived response.
 */
export function cannedReply(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "Hello! This is a canned response from the agent-emulate Anthropic emulator.";
  }
  return `This is a canned response from the agent-emulate Anthropic emulator. You said: "${trimmed}"`;
}
