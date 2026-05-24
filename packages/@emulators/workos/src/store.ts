/**
 * WorkOS store helpers using @emulators/core's Store.
 * All WorkOS state is kept in store.setData() Maps so it participates
 * in snapshot/restore and is properly scoped per server instance.
 */
import type { Store } from "@emulators/core";
import { now, randomHex, randomId } from "./helpers.js";
import type {
  AuthCode,
  RefreshTokenEntry,
  Session,
  WorkOSInvitation,
  WorkOSMembership,
  WorkOSOAuthClient,
  WorkOSOrganization,
  WorkOSUser,
} from "./types.js";

type UsersMap = Map<string, WorkOSUser>;
type OrgsMap = Map<string, WorkOSOrganization>;
type MembershipsMap = Map<string, WorkOSMembership>;
type InvitationsMap = Map<string, WorkOSInvitation>;
type OAuthClientsMap = Map<string, WorkOSOAuthClient>;
type AuthCodesMap = Map<string, AuthCode>;
type SessionsMap = Map<string, Session>;
type RefreshTokensMap = Map<string, RefreshTokenEntry>;

const KEY = {
  users: "workos_users",
  orgs: "workos_orgs",
  memberships: "workos_memberships",
  invitations: "workos_invitations",
  oauthClients: "workos_oauth_clients",
  authCodes: "workos_auth_codes",
  sessions: "workos_sessions",
  refreshTokens: "workos_refresh_tokens",
  init: "_workos_init",
} as const;

export function getWorkOSStore(store: Store) {
  if (!store.getData(KEY.init)) {
    store.setData(KEY.users, new Map<string, WorkOSUser>());
    store.setData(KEY.orgs, new Map<string, WorkOSOrganization>());
    store.setData(KEY.memberships, new Map<string, WorkOSMembership>());
    store.setData(KEY.invitations, new Map<string, WorkOSInvitation>());
    store.setData(KEY.oauthClients, new Map<string, WorkOSOAuthClient>());
    store.setData(KEY.authCodes, new Map<string, AuthCode>());
    store.setData(KEY.sessions, new Map<string, Session>());
    store.setData(KEY.refreshTokens, new Map<string, RefreshTokenEntry>());
    store.setData(KEY.init, true);
  }

  const users = store.getData<UsersMap>(KEY.users)!;
  const orgs = store.getData<OrgsMap>(KEY.orgs)!;
  const memberships = store.getData<MembershipsMap>(KEY.memberships)!;
  const invitations = store.getData<InvitationsMap>(KEY.invitations)!;
  const oauthClients = store.getData<OAuthClientsMap>(KEY.oauthClients)!;
  const authCodes = store.getData<AuthCodesMap>(KEY.authCodes)!;
  const sessions = store.getData<SessionsMap>(KEY.sessions)!;
  const refreshTokens = store.getData<RefreshTokensMap>(KEY.refreshTokens)!;

  return {
    // --- Users ---
    insertUser(data: Partial<WorkOSUser> & { email: string }): WorkOSUser {
      const id = data.id ?? randomId("user");
      const user: WorkOSUser = {
        id,
        email: data.email,
        email_verified: data.email_verified ?? true,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        profile_picture_url: data.profile_picture_url ?? null,
        password: data.password,
        created_at: now(),
        updated_at: now(),
      };
      users.set(id, user);
      return user;
    },
    findUserByEmail(email: string): WorkOSUser | undefined {
      for (const u of users.values()) {
        if (u.email === email) return u;
      }
      return undefined;
    },
    getUser(id: string): WorkOSUser | undefined {
      return users.get(id);
    },
    allUsers(): WorkOSUser[] {
      return [...users.values()];
    },
    updateUser(id: string, patch: Partial<WorkOSUser>): WorkOSUser | undefined {
      const user = users.get(id);
      if (!user) return undefined;
      const next: WorkOSUser = {
        ...user,
        ...patch,
        id: user.id,
        created_at: user.created_at,
        updated_at: now(),
      };
      users.set(id, next);
      return next;
    },
    deleteUser(id: string): boolean {
      return users.delete(id);
    },

    // --- Organizations ---
    insertOrganization(data: Partial<WorkOSOrganization> & { name: string }): WorkOSOrganization {
      const id = data.id ?? randomId("org");
      const org: WorkOSOrganization = {
        id,
        name: data.name,
        slug: data.slug ?? data.name.toLowerCase().replace(/\s+/g, "-"),
        created_at: now(),
        updated_at: now(),
      };
      orgs.set(id, org);
      return org;
    },
    findOrgBySlug(slug: string): WorkOSOrganization | undefined {
      for (const o of orgs.values()) {
        if (o.slug === slug) return o;
      }
      return undefined;
    },
    getOrg(id: string): WorkOSOrganization | undefined {
      return orgs.get(id);
    },
    allOrgs(): WorkOSOrganization[] {
      return [...orgs.values()];
    },

    // --- Memberships ---
    insertMembership(userId: string, organizationId: string, role = "member"): WorkOSMembership {
      const id = randomId("om");
      const m: WorkOSMembership = {
        id,
        user_id: userId,
        organization_id: organizationId,
        role: { slug: role },
        status: "active",
        created_at: now(),
        updated_at: now(),
      };
      memberships.set(id, m);
      return m;
    },
    getUserMemberships(userId: string): WorkOSMembership[] {
      return [...memberships.values()].filter((m) => m.user_id === userId && m.status === "active");
    },
    allMemberships(): WorkOSMembership[] {
      return [...memberships.values()];
    },
    getMembership(id: string): WorkOSMembership | undefined {
      return memberships.get(id);
    },
    deactivateMembership(id: string): boolean {
      const m = memberships.get(id);
      if (!m) return false;
      m.status = "inactive";
      m.updated_at = now();
      return true;
    },

    // --- Auth Codes ---
    createAuthCode(
      clientId: string,
      userId: string,
      redirectUri: string,
      opts?: {
        organizationId?: string;
        codeChallenge?: string;
        codeChallengeMethod?: string;
      },
    ): string {
      const code = randomHex(20);
      authCodes.set(code, {
        code,
        client_id: clientId,
        user_id: userId,
        organization_id: opts?.organizationId,
        redirect_uri: redirectUri,
        code_challenge: opts?.codeChallenge,
        code_challenge_method: opts?.codeChallengeMethod,
        expires_at: Date.now() + 10 * 60 * 1000,
      });
      return code;
    },
    consumeAuthCode(code: string): AuthCode | null {
      const entry = authCodes.get(code);
      if (!entry) return null;
      authCodes.delete(code);
      if (Date.now() > entry.expires_at) return null;
      return entry;
    },
    setPendingAuthToken(token: string, entry: AuthCode): void {
      authCodes.set(`pending_${token}`, entry);
    },
    consumePendingAuthToken(token: string): AuthCode | null {
      const entry = authCodes.get(`pending_${token}`);
      if (!entry || Date.now() > entry.expires_at) return null;
      authCodes.delete(`pending_${token}`);
      return entry;
    },

    // --- Sessions ---
    createSession(userId: string, organizationId?: string): Session {
      const id = randomId("session");
      const s: Session = {
        id,
        user_id: userId,
        organization_id: organizationId,
        created_at: now(),
        revoked: false,
      };
      sessions.set(id, s);
      return s;
    },
    getSession(sessionId: string): Session | undefined {
      const s = sessions.get(sessionId);
      if (!s || s.revoked) return undefined;
      return s;
    },
    revokeSession(sessionId: string): boolean {
      const s = sessions.get(sessionId);
      if (!s) return false;
      s.revoked = true;
      return true;
    },

    // --- Refresh Tokens ---
    createRefreshToken(userId: string, sessionId: string, organizationId?: string): string {
      const token = `r_workos_${randomHex(32)}`;
      refreshTokens.set(token, { token, user_id: userId, organization_id: organizationId, session_id: sessionId });
      return token;
    },
    consumeRefreshToken(token: string): RefreshTokenEntry | null {
      const entry = refreshTokens.get(token);
      if (!entry) return null;
      // Emulator: keep the token in the map so concurrent RSC requests
      // that all arrive before the first refresh completes don't invalidate
      // each other's sessions. Real WorkOS rotates tokens; we don't need to.
      return entry;
    },

    // --- Invitations ---
    insertInvitation(email: string, organizationId: string, roleSlug?: string): WorkOSInvitation {
      const id = randomId("inv");
      const inv: WorkOSInvitation = {
        id,
        email,
        organization_id: organizationId,
        role_slug: roleSlug ?? null,
        status: "pending",
        created_at: now(),
        updated_at: now(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      invitations.set(id, inv);
      return inv;
    },
    listInvitations(organizationId: string): WorkOSInvitation[] {
      return [...invitations.values()].filter((i) => i.organization_id === organizationId && i.status === "pending");
    },
    revokeInvitation(invitationId: string): boolean {
      const inv = invitations.get(invitationId);
      if (!inv) return false;
      inv.status = "revoked";
      inv.updated_at = now();
      return true;
    },

    // --- OAuth Clients ---
    insertOAuthClient(data: WorkOSOAuthClient): void {
      oauthClients.set(data.client_id, data);
    },
    getOAuthClient(clientId: string): WorkOSOAuthClient | undefined {
      return oauthClients.get(clientId);
    },
    allOAuthClients(): WorkOSOAuthClient[] {
      return [...oauthClients.values()];
    },
  };
}

export type WorkOSStoreFacade = ReturnType<typeof getWorkOSStore>;
