// Okta OAuth 2.0 / OpenID Connect emulator (custom authorization server).
//
// The OIDC flow against the `default` auth server: discovery → authorize page
// → callback (the user is referenced by their Okta id) → token → userinfo.
//
//   pnpm --filter api-emulators-quickstart okta
import { oktaPlugin, seedFromConfig, getOktaStore } from "@emulators/okta";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4140";
const CLIENT = "okta-test-client";
const SECRET = "okta-test-secret";
const REDIRECT = "http://localhost:3000/callback";
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

async function main(): Promise<void> {
  // seedDefaults registers the default `okta-test-client` + a default user;
  // `tokens` registers the SSWS API token the management endpoints check.
  const emu = mount(oktaPlugin, BASE, {
    seedDefaults: true,
    tokens: { "mgmt-token": { login: "admin", id: 1, scopes: [] } },
  });

  seedFromConfig(emu.store, BASE, {
    users: [
      { login: "alice@agent-emulate.dev", email: "alice@agent-emulate.dev", first_name: "Alice", last_name: "Admin" },
    ],
  });

  const user = getOktaStore(emu.store).users.findOneBy("login", "alice@agent-emulate.dev")!;

  heading("Okta — discovery (default auth server)");

  await call(emu, "Discovery document", `${BASE}/oauth2/default/.well-known/openid-configuration`);

  heading("Okta — authorization-code flow");

  const page = await emu.app.request(
    `${BASE}/oauth2/default/v1/authorize?response_type=code&client_id=${CLIENT}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("openid profile email")}&state=s1`,
  );
  console.log(`\n▶ GET /oauth2/default/v1/authorize  →  ${page.status} (user-picker HTML)`);

  const cb = await emu.app.request(
    `${BASE}/oauth2/default/v1/authorize/callback`,
    form({
      user_ref: user.okta_id,
      redirect_uri: REDIRECT,
      scope: "openid profile email",
      state: "s1",
      client_id: CLIENT,
      auth_server_id: "default",
    }),
  );
  const code = new URL(cb.headers.get("Location")!).searchParams.get("code")!;
  console.log(`▶ POST …/authorize/callback  →  ${cb.status} (code=${code.slice(0, 10)}…)`);

  const token = (await call(
    emu,
    "Exchange code → tokens",
    `${BASE}/oauth2/default/v1/token`,
    form({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      client_secret: SECRET,
      redirect_uri: REDIRECT,
    }),
  )) as { access_token: string };

  heading("Okta — authenticated identity & management API");

  await call(emu, "GET /oauth2/default/v1/userinfo", `${BASE}/oauth2/default/v1/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  await call(emu, "List users (management API)", `${BASE}/api/v1/users`, {
    headers: { Authorization: "SSWS mgmt-token" },
  });

  console.log("\n✅ Okta demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
