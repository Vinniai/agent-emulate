/**
 * End-to-end scenario: the org-auth → org-sync → personal-comms stack.
 *
 * Strings together the four emulators that back the real use case, in process,
 * with NO custom config (default seeds only) so it is reproducible without a
 * running server:
 *
 *   1. WorkOS org login (password grant) → returns the org_id backbone.
 *   2. Nango org-level connections for an ACCOUNTING (xero) and a STORAGE
 *      (google-drive) provider, tagged with that org_id via the connect flow.
 *   3. Personal OAuth for comms — Gmail (Google) and Teams (Microsoft) — under
 *      individual users.
 *
 * Asserts the invariant the use case depends on: the org id is identical across
 * every org-level Nango connection AND is the one WorkOS issued, while the comms
 * connections stay user-scoped (their own identity, not coupled to the org).
 *
 * Run:  pnpm --filter @emulators/server exec tsx scripts/e2e-org-sync.ts
 * Exits non-zero on the first failed assertion.
 */
import { Hono } from "hono";
import type { AppEnv } from "@emulators/core";
import { buildServiceApps, mountDispatcher, type ServiceName } from "../src/dispatcher.js";

// ---- tiny assertion harness -------------------------------------------------
let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failures.push(label);
    console.log(`  [31m✗[0m ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n[1m${title}[0m`);
}

const REDIRECT = "http://localhost:9999/cb";

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}
function jsonBody(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function main(): Promise<void> {
  const baseUrl = "http://localhost:4000";
  const services: ServiceName[] = ["workos", "nango", "google", "microsoft"];
  const apps = await buildServiceApps(services, { baseUrl, serviceConfigs: {}, tokens: {} });
  const app = new Hono<AppEnv>();
  mountDispatcher(app, apps);
  const req = (path: string, init?: RequestInit): Promise<Response> => app.request(path, init);

  // ---- 1. WorkOS org login ----------------------------------------------------
  section("1. WorkOS org login (password grant)");
  const loginRes = await req(
    "/workos/user_management/authenticate",
    jsonBody({
      grant_type: "password",
      username: "dev@agent-emulate.dev",
      password: "DevPassword123!",
      client_id: "client_test_01",
    }),
  );
  const login = (await loginRes.json()) as {
    organization_id?: string;
    access_token?: string;
    user?: { id: string; email: string };
  };
  check("login returns 200", loginRes.status === 200, loginRes.status);
  check("login returns an organization_id", typeof login.organization_id === "string" && !!login.organization_id);
  check("login returns an access token", typeof login.access_token === "string");
  const orgId = login.organization_id!;
  const userId = login.user?.id ?? "user_test_dev";
  console.log(`    org_id=${orgId}  user=${login.user?.email} (${userId})`);

  // ---- 2. Nango org-level connections ----------------------------------------
  section("2. Nango org-level connections (accounting + storage), tagged with the WorkOS org");

  async function connectOrgProvider(integration: string): Promise<string> {
    const sessionRes = await req(
      "/nango/connect/sessions",
      jsonBody({ end_user: { id: userId, tags: { organizationId: orgId } }, allowed_integrations: [integration] }),
    );
    const { data } = (await sessionRes.json()) as { data: { token: string } };
    const completeRes = await req("/nango/connect/complete", jsonBody({ token: data.token }));
    const { connectionId } = (await completeRes.json()) as { connectionId: string };
    return connectionId;
  }

  const accountingId = await connectOrgProvider("xero");
  const storageId = await connectOrgProvider("google-drive");

  // Read each connection back and confirm the org tag landed (the B fix).
  async function connectionTags(id: string): Promise<Record<string, string>> {
    const res = await req(`/nango/connections/${id}`);
    const conn = (await res.json()) as { tags?: Record<string, string> };
    return conn.tags ?? {};
  }
  const accountingTags = await connectionTags(accountingId);
  const storageTags = await connectionTags(storageId);
  check("accounting (xero) connection carries org tag", accountingTags.organization_id === orgId, accountingTags);
  check("storage (google-drive) connection carries org tag", storageTags.organization_id === orgId, storageTags);

  // Server-side org filtering returns exactly the two org-level connections.
  const orgListRes = await req(`/nango/connections?tags[organization_id]=${encodeURIComponent(orgId)}`);
  const orgList = (await orgListRes.json()) as { connections: Array<{ connection_id: string; provider: string }> };
  const orgProviders = orgList.connections.map((c) => c.provider).sort();
  check(
    "GET /connections?tags[organization_id] returns both org connections",
    orgList.connections.length === 2 && orgProviders.join(",") === "google-drive,xero",
    orgProviders,
  );

  // ---- 3. Personal comms: Gmail ----------------------------------------------
  section("3. Personal Gmail OAuth (user-scoped)");
  const gmailEmail = "testuser@gmail.com";
  const gCbRes = await req(
    "/google/o/oauth2/v2/auth/callback",
    form({ email: gmailEmail, redirect_uri: REDIRECT, scope: "openid email profile", state: "g", client_id: "x" }),
  );
  const gCode = new URL(gCbRes.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  check("gmail callback issues an auth code", gCbRes.status === 302 && gCode.length > 0, gCbRes.status);
  const gTokRes = await req(
    "/google/oauth2/token",
    form({ grant_type: "authorization_code", code: gCode, redirect_uri: REDIRECT, client_id: "x" }),
  );
  const gTok = (await gTokRes.json()) as { access_token?: string };
  check("gmail token exchange returns an access token", typeof gTok.access_token === "string");
  const gInfoRes = await req("/google/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${gTok.access_token}` } });
  const gInfo = (await gInfoRes.json()) as { email?: string };
  check("gmail userinfo resolves the personal user", gInfo.email === gmailEmail, gInfo.email);
  const gMsgRes = await req("/google/gmail/v1/users/me/messages", {
    headers: { Authorization: `Bearer ${gTok.access_token}` },
  });
  const gMsg = (await gMsgRes.json()) as { messages?: unknown[] };
  check("gmail messages are reachable with the personal token", gMsgRes.status === 200 && Array.isArray(gMsg.messages));

  // ---- 4. Personal comms: Teams ----------------------------------------------
  section("4. Personal Teams OAuth (user-scoped)");
  const teamsEmail = "testuser@agent-emulate.dev";
  const mCbRes = await req(
    "/microsoft/oauth2/v2.0/authorize/callback",
    form({ email: teamsEmail, redirect_uri: REDIRECT, scope: "openid email profile", state: "m", client_id: "x", response_mode: "query" }),
  );
  const mCode = new URL(mCbRes.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  check("teams callback issues an auth code", mCbRes.status === 302 && mCode.length > 0, mCbRes.status);
  const mTokRes = await req(
    "/microsoft/oauth2/v2.0/token",
    form({ grant_type: "authorization_code", code: mCode, redirect_uri: REDIRECT, client_id: "x" }),
  );
  const mTok = (await mTokRes.json()) as { access_token?: string };
  check("teams token exchange returns an access token", typeof mTok.access_token === "string");
  const mInfoRes = await req("/microsoft/oidc/userinfo", { headers: { Authorization: `Bearer ${mTok.access_token}` } });
  const mInfo = (await mInfoRes.json()) as { email?: string; preferred_username?: string };
  check(
    "teams userinfo resolves the personal user",
    mInfo.email === teamsEmail || mInfo.preferred_username === teamsEmail,
    mInfo,
  );
  const teamsRes = await req("/microsoft/v1.0/me/joinedTeams", {
    headers: { Authorization: `Bearer ${mTok.access_token}` },
  });
  const teams = (await teamsRes.json()) as { value?: Array<{ displayName: string }> };
  check("joined teams are reachable with the personal token", teamsRes.status === 200 && (teams.value?.length ?? 0) > 0);

  // ---- 5. Cross-cutting invariant --------------------------------------------
  section("5. Invariant: one org id across org-level sync, comms stay user-scoped");
  check(
    "both org-level connections share the WorkOS org id",
    accountingTags.organization_id === orgId && storageTags.organization_id === orgId,
  );
  check(
    "comms identities are personal and distinct from each other",
    gInfo.email === gmailEmail && (mInfo.email === teamsEmail || mInfo.preferred_username === teamsEmail) && gmailEmail !== teamsEmail,
  );

  // ---- result -----------------------------------------------------------------
  console.log("");
  if (failures.length === 0) {
    console.log(`[32mPASS[0m — ${passed} checks green`);
    process.exit(0);
  } else {
    console.log(`[31mFAIL[0m — ${failures.length} failed, ${passed} passed`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
