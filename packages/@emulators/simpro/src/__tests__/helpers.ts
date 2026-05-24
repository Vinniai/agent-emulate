import { Hono } from "hono";
import { Store, WebhookDispatcher, type TokenMap } from "@emulators/core";
import { simproPlugin } from "../index.js";
import { resetRateLimit } from "../helpers.js";

export const BASE = "http://localhost:14010";

export interface TestApp {
  app: Hono;
  store: Store;
}

export function createTestApp(opts: { seed?: boolean; rateLimit?: boolean } = {}): TestApp {
  resetRateLimit();
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();

  simproPlugin.register(app as never, store, webhooks, BASE, tokenMap);
  if (opts.seed ?? true) simproPlugin.seed?.(store, BASE);
  if (opts.rateLimit) store.setData("simpro.rate_limit_enabled", true);

  return { app, store };
}

export async function getAccessToken(app: Hono): Promise<string> {
  // OAuth authorization code flow: /oauth/authorize -> code -> /oauth/token
  const authRes = await app.request(
    `${BASE}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  const location = authRes.headers.get("Location")!;
  const code = new URL(location).searchParams.get("code")!;
  const tokenRes = await app.request(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, client_id: "taskr_dev" }),
  });
  const body = (await tokenRes.json()) as { access_token: string };
  return body.access_token;
}

export function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
