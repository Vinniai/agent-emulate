import { Store, type Collection } from "@emulators/core";
import type { AnthropicUser, AnthropicOAuthClient, AnthropicApiKey } from "./entities.js";

export interface AnthropicStore {
  users: Collection<AnthropicUser>;
  oauthClients: Collection<AnthropicOAuthClient>;
  apiKeys: Collection<AnthropicApiKey>;
}

export function getAnthropicStore(store: Store): AnthropicStore {
  return {
    users: store.collection<AnthropicUser>("anthropic.users", ["user_id", "email"]),
    oauthClients: store.collection<AnthropicOAuthClient>("anthropic.oauth_clients", ["client_id"]),
    apiKeys: store.collection<AnthropicApiKey>("anthropic.api_keys", ["key", "user_id"]),
  };
}
