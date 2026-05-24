/** WorkOS emulator entity types — mirrors WorkOS API shapes. */

export interface WorkOSUser {
  id: string;
  email: string;
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
  password?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkOSOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface WorkOSMembership {
  id: string;
  user_id: string;
  organization_id: string;
  role: { slug: string };
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface WorkOSInvitation {
  id: string;
  email: string;
  organization_id: string;
  role_slug: string | null;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface WorkOSOAuthClient {
  client_id: string;
  client_secret?: string;
  name: string;
  redirect_uris: string[];
}

export interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  organization_id?: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  expires_at: number;
}

export interface Session {
  id: string;
  user_id: string;
  organization_id?: string;
  created_at: string;
  revoked: boolean;
}

export interface RefreshTokenEntry {
  token: string;
  user_id: string;
  organization_id?: string;
  session_id: string;
}
