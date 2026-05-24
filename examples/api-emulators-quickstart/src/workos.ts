// WorkOS User Management emulator.
//
// WorkOS uses its own `/user_management` namespace and a single JSON
// `/authenticate` endpoint (SDK v4+ style). With one seeded user the authorize
// endpoint redirects straight back with a code. Flow: authorize → authenticate
// (code) → list the user's organization memberships → password grant.
//
//   pnpm --filter api-emulators-quickstart workos
import { workosPlugin, seedFromConfig } from "@emulators/workos";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4160";
const CLIENT = "client_test_01";
const REDIRECT = "http://localhost:3000/callback";
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function main(): Promise<void> {
  const emu = mount(workosPlugin, BASE);

  seedFromConfig(emu.store, BASE, {
    users: [{ email: "dev@agent-emulate.dev", first_name: "Dev", last_name: "User", password: "DevPassword123!" }],
    organizations: [{ name: "Acme Inc", slug: "acme" }],
    memberships: [{ user_email: "dev@agent-emulate.dev", organization_slug: "acme", role: "owner" }],
    oauth_clients: [{ client_id: CLIENT, client_secret: "sk_test_secret", redirect_uris: [REDIRECT] }],
  });

  heading("WorkOS — authorize (single user → instant redirect)");

  const authz = await emu.app.request(
    `${BASE}/user_management/authorize?response_type=code&client_id=${CLIENT}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s1`,
    { redirect: "manual" },
  );
  const code = new URL(authz.headers.get("Location")!).searchParams.get("code")!;
  console.log(`\n▶ GET /user_management/authorize  →  ${authz.status} (code=${code.slice(0, 10)}…)`);

  const authd = (await call(
    emu,
    "Authenticate with the code",
    `${BASE}/user_management/authenticate`,
    json({
      grant_type: "authorization_code",
      client_id: CLIENT,
      code,
    }),
  )) as { user: { id: string } };

  heading("WorkOS — organization memberships");

  await call(
    emu,
    "List the user's memberships",
    `${BASE}/user_management/organization_memberships?user_id=${authd.user.id}`,
  );

  heading("WorkOS — password grant");

  await call(
    emu,
    "Authenticate with email + password",
    `${BASE}/user_management/authenticate`,
    json({
      grant_type: "password",
      client_id: CLIENT,
      email: "dev@agent-emulate.dev",
      password: "DevPassword123!",
    }),
  );

  console.log("\n✅ WorkOS demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
