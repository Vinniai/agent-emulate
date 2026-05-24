// Clerk authentication & user-management emulator.
//
// The OIDC sign-in flow (Clerk issues no refresh token) plus the backend
// management API a server uses with its secret key.
//
//   pnpm --filter api-emulators-quickstart clerk
import { clerkPlugin, seedFromConfig, getClerkStore } from "@emulators/clerk";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4150";
const CLIENT = "clerk_emulate_client";
const SECRET = "clerk_emulate_secret";
const REDIRECT = "http://localhost:3000/api/auth/callback/clerk";
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

async function main(): Promise<void> {
  // seedDefaults registers the default OAuth app + a default user; `tokens`
  // registers the Backend-API secret key the management endpoints check.
  const emu = mount(clerkPlugin, BASE, {
    seedDefaults: true,
    tokens: { sk_test_emulate: { login: "backend", id: 1, scopes: [] } },
  });

  seedFromConfig(emu.store, BASE, {
    users: [{ email_addresses: ["alice@agent-emulate.dev"], first_name: "Alice", last_name: "Admin", password: "pw" }],
  });

  const user = getClerkStore(emu.store).users.all().at(-1)!;

  heading("Clerk — discovery");

  await call(emu, "Discovery document", `${BASE}/.well-known/openid-configuration`);

  heading("Clerk — authorization-code flow");

  const page = await emu.app.request(
    `${BASE}/oauth/authorize?response_type=code&client_id=${CLIENT}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("openid profile email")}&state=s1`,
  );
  console.log(`\n▶ GET /oauth/authorize  →  ${page.status} (user-picker HTML)`);

  const cb = await emu.app.request(
    `${BASE}/oauth/authorize/callback`,
    form({
      user_ref: user.clerk_id,
      redirect_uri: REDIRECT,
      scope: "openid profile email",
      state: "s1",
      client_id: CLIENT,
    }),
  );
  const code = new URL(cb.headers.get("Location")!).searchParams.get("code")!;
  console.log(`▶ POST /oauth/authorize/callback  →  ${cb.status} (code=${code.slice(0, 10)}…)`);

  const token = (await call(
    emu,
    "Exchange code → tokens",
    `${BASE}/oauth/token`,
    form({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      client_secret: SECRET,
      redirect_uri: REDIRECT,
    }),
  )) as { access_token: string };

  heading("Clerk — identity & backend management API");

  await call(emu, "GET /oauth/userinfo", `${BASE}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  await call(emu, "List users (Backend API, secret key)", `${BASE}/v1/users`, {
    headers: { Authorization: "Bearer sk_test_emulate" },
  });

  console.log("\n✅ Clerk demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
