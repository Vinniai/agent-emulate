import type { Hono } from "hono";
import type { AppEnv, RouteContext, ServicePlugin, Store, WebhookDispatcher, TokenMap } from "@emulators/core";
import { getOpenAiStore } from "./store.js";
import { generateId } from "./helpers.js";
import { oauthRoutes } from "./routes/oauth.js";
import { modelsRoutes } from "./routes/models.js";
import { chatRoutes } from "./routes/chat.js";
import { responsesRoutes } from "./routes/responses.js";
import { embeddingsRoutes } from "./routes/embeddings.js";

export { getOpenAiStore, type OpenAiStore } from "./store.js";
export * from "./entities.js";

export interface OpenAiSeedConfig {
  port?: number;
  baseUrl?: string;
  users?: Array<{
    email: string;
    name?: string;
    org_id?: string;
  }>;
  oauth_clients?: Array<{
    client_id: string;
    client_secret: string;
    name: string;
    redirect_uris: string[];
  }>;
  api_keys?: Array<{
    key: string;
    name?: string;
    user_email?: string;
  }>;
}

function seedDefaults(store: Store): void {
  const os = getOpenAiStore(store);
  os.users.insert({
    user_id: generateId("user"),
    email: "dev@agent-emulate.dev",
    name: "Dev User",
    org_id: "org-emulate",
  });
}

export function seedFromConfig(store: Store, _baseUrl: string, config: OpenAiSeedConfig): void {
  const os = getOpenAiStore(store);

  if (config.users) {
    for (const u of config.users) {
      if (os.users.findOneBy("email", u.email)) continue;
      os.users.insert({
        user_id: generateId("user"),
        email: u.email,
        name: u.name ?? null,
        org_id: u.org_id ?? "org-emulate",
      });
    }
  }

  if (config.oauth_clients) {
    for (const cl of config.oauth_clients) {
      if (os.oauthClients.findOneBy("client_id", cl.client_id)) continue;
      os.oauthClients.insert({
        client_id: cl.client_id,
        client_secret: cl.client_secret,
        name: cl.name,
        redirect_uris: cl.redirect_uris,
      });
    }
  }

  if (config.api_keys) {
    for (const k of config.api_keys) {
      if (os.apiKeys.findOneBy("key", k.key)) continue;
      const owner = k.user_email ? os.users.findOneBy("email", k.user_email) : os.users.all()[0];
      os.apiKeys.insert({
        key: k.key,
        name: k.name ?? "default",
        user_id: owner?.user_id ?? "user-unknown",
        redacted: `sk-...${k.key.slice(-4)}`,
      });
    }
  }
}

export const openaiPlugin: ServicePlugin = {
  name: "openai",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    modelsRoutes(ctx);
    chatRoutes(ctx);
    responsesRoutes(ctx);
    embeddingsRoutes(ctx);
  },
  seed(store: Store): void {
    seedDefaults(store);
  },
};

export default openaiPlugin;
