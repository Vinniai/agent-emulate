import { randomBytes, createHash } from "crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const ACCOUNT_ID = "123456789012";
const DEFAULT_REGION = "us-east-1";

export function generateAwsId(prefix: string): string {
  return prefix + randomBytes(8).toString("hex").toUpperCase();
}

export function generateMessageId(): string {
  return [
    randomBytes(4).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(6).toString("hex"),
  ].join("-");
}

export function generateReceiptHandle(): string {
  return randomBytes(48).toString("base64url");
}

export function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

export function getAccountId(): string {
  return ACCOUNT_ID;
}

export function getDefaultRegion(): string {
  return DEFAULT_REGION;
}

export function awsXmlResponse(c: Context, xml: string, status: ContentfulStatusCode = 200) {
  return c.text(xml, status, { "Content-Type": "application/xml" });
}

export function awsErrorXml(c: Context, code: string, message: string, status: ContentfulStatusCode = 400) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Code>${escapeXml(code)}</Code>
    <Message>${escapeXml(message)}</Message>
  </Error>
  <RequestId>${generateMessageId()}</RequestId>
</ErrorResponse>`;
  return c.text(xml, status, { "Content-Type": "application/xml" });
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parseQueryString(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

// --- AWS JSON 1.1 protocol (KMS, Secrets Manager, SSM, Lambda) ---

const JSON_CONTENT_TYPE = "application/x-amz-json-1.1";

/**
 * Action name dispatched from the `X-Amz-Target` header, which AWS JSON-RPC
 * SDKs send as `<ServicePrefix>.<Action>` (e.g. `TrentService.CreateKey`).
 * Returns the action (segment after the last dot) or undefined when absent.
 */
export function targetAction(c: Context): string | undefined {
  const target = c.req.header("X-Amz-Target");
  if (!target) return undefined;
  const dot = target.lastIndexOf(".");
  return dot >= 0 ? target.slice(dot + 1) : target;
}

/** True when this request's `X-Amz-Target` belongs to the given service prefix. */
export function targetMatches(c: Context, prefix: string): boolean {
  const target = c.req.header("X-Amz-Target");
  return !!target && target.startsWith(prefix + ".");
}

export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function awsJsonResponse(c: Context, body: unknown, status: ContentfulStatusCode = 200) {
  return c.body(JSON.stringify(body ?? {}), status, {
    "Content-Type": JSON_CONTENT_TYPE,
    "x-amzn-requestid": generateMessageId(),
  });
}

/**
 * AWS JSON-protocol error. SDKs map the exception by the `__type` body field
 * and `x-amzn-errortype` header, so `code` must be the documented exception
 * name (e.g. `NotFoundException`, `ResourceNotFoundException`).
 */
export function awsJsonError(c: Context, code: string, message: string, status: ContentfulStatusCode = 400) {
  return c.body(JSON.stringify({ __type: code, message }), status, {
    "Content-Type": "application/x-amz-json-1.0",
    "x-amzn-errortype": code,
    "x-amzn-requestid": generateMessageId(),
  });
}

export function strInput(input: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string") return v;
  }
  return "";
}

export function boolInput(input: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    if (typeof input[k] === "boolean") return input[k] as boolean;
  }
  return false;
}

export function numInput(input: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "number") return v;
  }
  return undefined;
}

/** A short 6-char uppercase suffix in the style AWS appends to secret ARNs. */
export function shortSuffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}
