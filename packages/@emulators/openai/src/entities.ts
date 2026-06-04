import type { Entity } from "@emulators/core";

export interface OpenAiUser extends Entity {
  /** Stable user id, e.g. `user-...`. */
  user_id: string;
  email: string;
  name: string | null;
  /** Organization the user belongs to, e.g. `org-...`. */
  org_id: string;
}

export interface OpenAiOAuthClient extends Entity {
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
}

export interface OpenAiApiKey extends Entity {
  /** The secret value the SDK sends as `Authorization: Bearer <key>`. */
  key: string;
  name: string;
  /** `user-...` of the owner. */
  user_id: string;
  redacted: string;
}
