// Microsoft Entra ID OAuth 2.0 / OpenID Connect emulator.
//
// The Entra sign-in flow plus a Microsoft Graph `/me` call — what an app using
// MSAL or the auth library's "microsoft-entra-id" provider drives.
//
//   pnpm --filter api-emulators-quickstart microsoft
import { microsoftPlugin, seedFromConfig } from "@emulators/microsoft";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4120";
const CLIENT = "example-client-id";
const SECRET = "example-client-secret";
const REDIRECT = "http://localhost:3000/callback";
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

async function main(): Promise<void> {
  const emu = mount(microsoftPlugin, BASE);

  seedFromConfig(emu.store, BASE, {
    users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
    oauth_clients: [{ client_id: CLIENT, client_secret: SECRET, name: "Demo App", redirect_uris: [REDIRECT] }],
  });

  heading("Microsoft — OIDC discovery");

  await call(emu, "Discovery document", `${BASE}/.well-known/openid-configuration`);

  heading("Microsoft — authorization-code flow");

  const page = await emu.app.request(
    `${BASE}/oauth2/v2.0/authorize?response_type=code&client_id=${CLIENT}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("openid email profile")}&state=s1`,
  );
  console.log(`\n▶ GET /oauth2/v2.0/authorize  →  ${page.status} (sign-in HTML)`);

  const cb = await emu.app.request(
    `${BASE}/oauth2/v2.0/authorize/callback`,
    form({
      email: "testuser@agent-emulate.dev",
      redirect_uri: REDIRECT,
      scope: "openid email profile",
      state: "s1",
      client_id: CLIENT,
      response_mode: "query",
    }),
  );
  const code = new URL(cb.headers.get("Location")!).searchParams.get("code")!;
  console.log(`▶ POST /oauth2/v2.0/authorize/callback  →  ${cb.status} (code=${code.slice(0, 10)}…)`);

  const token = (await call(
    emu,
    "Exchange code → tokens",
    `${BASE}/oauth2/v2.0/token`,
    form({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      client_secret: SECRET,
      redirect_uri: REDIRECT,
    }),
  )) as { access_token: string };

  heading("Microsoft — identity & Graph");

  const headers = { Authorization: `Bearer ${token.access_token}` };
  await call(emu, "GET /oidc/userinfo", `${BASE}/oidc/userinfo`, { headers });
  await call(emu, "GET /v1.0/me (Microsoft Graph)", `${BASE}/v1.0/me`, { headers });

  console.log("\n✅ Microsoft demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
