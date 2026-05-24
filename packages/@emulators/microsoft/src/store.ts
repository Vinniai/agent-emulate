import type { Collection, Store } from "@emulators/core";
import type { MicrosoftOAuthClient, MicrosoftUser } from "./entities.js";

export interface MicrosoftStore {
  users: Collection<MicrosoftUser>;
  oauthClients: Collection<MicrosoftOAuthClient>;
}

export function getMicrosoftStore(store: Store): MicrosoftStore {
  return {
    users: store.collection<MicrosoftUser>("microsoft.users", ["oid", "email"]),
    oauthClients: store.collection<MicrosoftOAuthClient>("microsoft.oauth_clients", ["client_id"]),
  };
}
