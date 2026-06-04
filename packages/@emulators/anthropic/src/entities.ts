import type { Entity } from "@emulators/core";

export interface AnthropicUser extends Entity {
  /** Stable account id, e.g. `user_...`. */
  user_id: string;
  email: string;
  name: string | null;
  /** Organization id, e.g. `org_...`. */
  org_id: string;
}

export interface AnthropicOAuthClient extends Entity {
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
}

export interface AnthropicApiKey extends Entity {
  /** The secret the SDK sends as the `x-api-key` header. */
  key: string;
  name: string;
  user_id: string;
  redacted: string;
}
