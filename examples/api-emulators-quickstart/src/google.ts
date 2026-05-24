// Google OAuth 2.0 / OpenID Connect emulator.
//
// The full sign-in flow an auth library runs: authorize page → user picks an
// account (the internal callback) → code → token exchange → userinfo, plus the
// OIDC discovery document and a refresh-token rotation.
//
//   pnpm --filter api-emulators-quickstart google
import { googlePlugin, seedFromConfig } from "@emulators/google";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4110";
const CLIENT = "emu_google_client_id";
const SECRET = "emu_google_client_secret";
const REDIRECT = "http://localhost:3000/api/auth/callback/google";
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

async function main(): Promise<void> {
  const emu = mount(googlePlugin, BASE);

  seedFromConfig(emu.store, BASE, {
    users: [{ email: "testuser@agent-emulate.dev", name: "Test User", email_verified: true }],
    oauth_clients: [{ client_id: CLIENT, client_secret: SECRET, name: "Demo App", redirect_uris: [REDIRECT] }],
  });

  heading("Google — OpenID Connect discovery");

  await call(emu, "Discovery document", `${BASE}/.well-known/openid-configuration`);

  heading("Google — authorization-code flow");

  const authorizeUrl =
    `${BASE}/o/oauth2/v2/auth?response_type=code&client_id=${CLIENT}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("openid email profile")}&state=s1`;
  const page = await emu.app.request(authorizeUrl);
  console.log(`\n▶ GET /o/oauth2/v2/auth  →  ${page.status} (account picker HTML)`);

  // The user picks an account — the picker form POSTs back to the callback.
  const cb = await emu.app.request(
    `${BASE}/o/oauth2/v2/auth/callback`,
    form({
      email: "testuser@agent-emulate.dev",
      redirect_uri: REDIRECT,
      scope: "openid email profile",
      client_id: CLIENT,
      state: "s1",
    }),
  );
  const code = new URL(cb.headers.get("Location")!).searchParams.get("code")!;
  console.log(`▶ POST /o/oauth2/v2/auth/callback  →  ${cb.status} (code=${code.slice(0, 10)}…)`);

  const token = (await call(
    emu,
    "Exchange code → tokens",
    `${BASE}/oauth2/token`,
    form({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      client_secret: SECRET,
    }),
  )) as { access_token: string; refresh_token: string };

  heading("Google — authenticated identity");

  await call(emu, "GET /oauth2/v2/userinfo", `${BASE}/oauth2/v2/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  await call(
    emu,
    "Rotate the access token via refresh_token",
    `${BASE}/oauth2/token`,
    form({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: CLIENT,
      client_secret: SECRET,
    }),
  );

  console.log("\n✅ Google demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
