import { Store, type Collection } from "@emulators/core";
import type { OpenAiUser, OpenAiOAuthClient, OpenAiApiKey } from "./entities.js";

export interface OpenAiStore {
  users: Collection<OpenAiUser>;
  oauthClients: Collection<OpenAiOAuthClient>;
  apiKeys: Collection<OpenAiApiKey>;
}

export function getOpenAiStore(store: Store): OpenAiStore {
  return {
    users: store.collection<OpenAiUser>("openai.users", ["user_id", "email"]),
    oauthClients: store.collection<OpenAiOAuthClient>("openai.oauth_clients", ["client_id"]),
    apiKeys: store.collection<OpenAiApiKey>("openai.api_keys", ["key", "user_id"]),
  };
}
