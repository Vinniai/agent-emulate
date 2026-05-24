// Apple Sign In / OAuth emulator.
//
// Apple has no userinfo endpoint — identity travels in the signed id_token.
// Flow: authorize page → callback (first consent also returns a `user` blob) →
// token exchange → decode the id_token, with the JWKS used to verify it.
//
//   pnpm --filter api-emulators-quickstart apple
import { applePlugin, seedFromConfig } from "@emulators/apple";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4130";
const CLIENT = "com.acme.app";
const REDIRECT = "http://localhost:3000/callback";
// Real Apple wants an ES256 JWT here; the emulator accepts the shape unsigned.
const SECRET = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJURUFNMDAxIiwic3ViIjoiY29tLmFjbWUuYXBwIn0.fake";
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

function decodeJwt(jwt: string): unknown {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
}

async function main(): Promise<void> {
  const emu = mount(applePlugin, BASE);

  seedFromConfig(emu.store, BASE, {
    users: [{ email: "testuser@agent-emulate.dev", name: "Test User" }],
    oauth_clients: [{ client_id: CLIENT, team_id: "TEAM001", name: "Acme iOS", redirect_uris: [REDIRECT] }],
  });

  heading("Apple — JWKS (used to verify the id_token)");

  await call(emu, "GET /auth/keys", `${BASE}/auth/keys`);

  heading("Apple — authorization-code flow");

  const page = await emu.app.request(
    `${BASE}/auth/authorize?response_type=code&response_mode=query&client_id=${CLIENT}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("openid email name")}&state=s1`,
  );
  console.log(`\n▶ GET /auth/authorize  →  ${page.status} (consent HTML)`);

  const cb = await emu.app.request(
    `${BASE}/auth/authorize/callback`,
    form({
      email: "testuser@agent-emulate.dev",
      redirect_uri: REDIRECT,
      scope: "openid email name",
      state: "s1",
      client_id: CLIENT,
      response_mode: "query",
    }),
  );
  const loc = new URL(cb.headers.get("Location")!);
  const code = loc.searchParams.get("code")!;
  console.log(
    `▶ POST /auth/authorize/callback  →  ${cb.status} (code=${code.slice(0, 10)}…, user blob=${loc.searchParams.has("user")})`,
  );

  const token = (await call(
    emu,
    "Exchange code → tokens",
    `${BASE}/auth/token`,
    form({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      client_secret: SECRET,
      redirect_uri: REDIRECT,
    }),
  )) as { id_token: string };

  console.log("\n▶ Decoded id_token claims");
  console.log(`    ${JSON.stringify(decodeJwt(token.id_token), null, 2).split("\n").join("\n    ")}`);

  console.log("\n✅ Apple demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
