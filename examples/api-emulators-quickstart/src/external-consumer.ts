// The end-to-end proof: a *separate process* authenticates against a running
// `emulate` server exactly the way a production app would, then reads data
// through it as a provider proxy. No in-process harness — this spawns the real
// `@emulators/server` binary, talks to it over real HTTP, and verifies the
// OpenID Connect id_token with `jose`'s `createRemoteJWKSet` + `jwtVerify` —
// the *same* primitives Auth.js / openid-client use internally. If this script
// passes, a real OIDC client library trusts emulate's tokens.
//
// What it demonstrates (the three pillars):
//   1. emulate auth   — RS256 id_token verifiable against the live JWKS, with
//                        the issuer/audience/nonce a real client checks.
//   2. token realism  — access tokens expire (EMULATE_GOOGLE_TOKEN_TTL=1s);
//                        an expired token gets a real 401, and the standard
//                        refresh_token grant mints a fresh one.
//   3. provider proxy  — an authenticated read through the same server against
//                        a *different* provider (GitHub) just works.
//
//   pnpm --filter api-emulators-quickstart external-consumer
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SERVER_ENTRY = join(REPO_ROOT, "apps/server/dist/index.js");
const PORT = 4399;
const ORIGIN = `http://localhost:${PORT}`;
const GOOGLE = `${ORIGIN}/google`;

// No oauth client is seeded in default (no-config) mode, so any client
// credentials are accepted — exactly what a fresh app would send.
const CLIENT_ID = "emulate-external-demo.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-emulate-external-demo";
const REDIRECT = "http://localhost:3000/api/auth/callback/google";
const NONCE = "nonce-" + Math.random().toString(36).slice(2);
const USER_EMAIL = "testuser@agent-emulate.dev"; // the Google plugin's built-in default seed

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const form = (p: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(p).toString(),
});

function step(label: string): void {
  console.log(`\n▶ ${label}`);
}
function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  throw new Error(`emulate server did not become ready on :${PORT} within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `Server build not found at ${SERVER_ENTRY}.\n` +
        `Run \`pnpm -w build\` (or \`pnpm --filter @emulators/server build\`) first.`,
    );
  }

  // Empty cwd → the config loader finds no emulate.config.* → every service
  // mounts with its plugin's built-in default seed. Short token TTL so we can
  // observe a real expiry → refresh cycle in seconds, not an hour.
  const workdir = mkdtempSync(join(tmpdir(), "emulate-external-"));
  let server: ChildProcess | undefined;

  try {
    console.log(`Spawning @emulators/server on :${PORT} (TTL=1s, no config → plugin defaults)…`);
    server = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: workdir,
      env: {
        ...process.env,
        PORT: String(PORT),
        EMULATE_BASE_URL: ORIGIN,
        EMULATE_GOOGLE_TOKEN_TTL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", () => {});
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`  [server] ${d}`));
    server.on("exit", (code) => {
      if (code && code !== 0) console.error(`  [server] exited with code ${code}`);
    });

    await waitForServer(15_000);
    ok("server is live");

    // ── 1. OIDC discovery (what every OpenID client fetches first) ──────────
    step("GET /google/.well-known/openid-configuration");
    const discovery = (await (await fetch(`${GOOGLE}/.well-known/openid-configuration`)).json()) as {
      issuer: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      jwks_uri: string;
      id_token_signing_alg_values_supported: string[];
    };
    console.log(`  issuer:   ${discovery.issuer}`);
    console.log(`  jwks_uri: ${discovery.jwks_uri}`);
    console.log(`  id_token alg: ${discovery.id_token_signing_alg_values_supported.join(", ")}`);
    if (discovery.issuer !== GOOGLE) throw new Error(`issuer ${discovery.issuer} !== ${GOOGLE}`);
    if (!discovery.id_token_signing_alg_values_supported.includes("RS256"))
      throw new Error("discovery does not advertise RS256");
    ok("discovery advertises RS256 + a real JWKS URI");

    // ── 2. Authorization-code flow over real HTTP ──────────────────────────
    step("POST /google/o/oauth2/v2/auth/callback  (user picks an account)");
    const cb = await fetch(`${GOOGLE}/o/oauth2/v2/auth/callback`, {
      ...form({
        email: USER_EMAIL,
        redirect_uri: REDIRECT,
        scope: "openid email profile",
        client_id: CLIENT_ID,
        state: "s1",
        nonce: NONCE,
      }),
      redirect: "manual",
    });
    const location = cb.headers.get("location");
    if (!location) throw new Error(`expected 302 redirect, got ${cb.status}`);
    const code = new URL(location).searchParams.get("code");
    if (!code) throw new Error("no authorization code in redirect");
    ok(`got authorization code ${code.slice(0, 10)}…`);

    step("POST /google/oauth2/token  (exchange code → tokens)");
    const tokens = (await (
      await fetch(
        `${GOOGLE}/oauth2/token`,
        form({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      )
    ).json()) as { access_token: string; id_token: string; refresh_token: string; expires_in: number };
    console.log(`  access_token: ${tokens.access_token.slice(0, 16)}…  (expires_in=${tokens.expires_in}s)`);
    console.log(`  id_token:     ${tokens.id_token.slice(0, 24)}…`);
    if (!tokens.id_token || !tokens.refresh_token) throw new Error("token response missing id_token/refresh_token");

    // ── 3. Verify the id_token the way Auth.js / openid-client does ─────────
    // createRemoteJWKSet fetches /google/oauth2/v3/certs over HTTP and caches
    // it; jwtVerify checks RS256 signature + issuer + audience. This is the
    // exact code path a production OIDC client runs — if it passes, real auth
    // libraries trust emulate.
    step("Verify id_token against the live JWKS (jose — same as Auth.js)");
    const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload, protectedHeader } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: GOOGLE,
      audience: CLIENT_ID,
    });
    console.log(`  header.alg=${protectedHeader.alg} header.kid=${protectedHeader.kid}`);
    console.log(`  payload.email=${payload.email as string} payload.nonce=${payload.nonce as string}`);
    if (protectedHeader.alg !== "RS256") throw new Error(`expected RS256, got ${protectedHeader.alg}`);
    if (payload.email !== USER_EMAIL) throw new Error(`email mismatch: ${payload.email as string}`);
    if (payload.nonce !== NONCE) throw new Error(`nonce mismatch: ${payload.nonce as string}`);
    ok("id_token signature + issuer + audience + nonce all verified by jose");

    // ── 4. Token realism: expiry → 401 → refresh → fresh token ─────────────
    step("GET /google/oauth2/v2/userinfo  (fresh token → 200)");
    const ui1 = await fetch(`${GOOGLE}/oauth2/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (ui1.status !== 200) throw new Error(`expected 200 with fresh token, got ${ui1.status}`);
    ok(`userinfo 200 — email=${((await ui1.json()) as { email: string }).email}`);

    console.log("\n  …waiting ~1.5s for the access token to expire…");
    await sleep(1500);

    step("GET /google/oauth2/v2/userinfo  (expired token → 401)");
    const ui2 = await fetch(`${GOOGLE}/oauth2/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (ui2.status !== 401) throw new Error(`expected 401 for expired token, got ${ui2.status}`);
    ok("expired access token correctly rejected with 401 (drives the refresh path)");

    step("POST /google/oauth2/token  (grant_type=refresh_token → new token)");
    const refreshed = (await (
      await fetch(
        `${GOOGLE}/oauth2/token`,
        form({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      )
    ).json()) as { access_token: string; expires_in: number };
    if (!refreshed.access_token) throw new Error("refresh did not return a new access_token");
    ok(`refreshed access_token ${refreshed.access_token.slice(0, 16)}… (expires_in=${refreshed.expires_in}s)`);

    step("GET /google/oauth2/v2/userinfo  (refreshed token → 200)");
    const ui3 = await fetch(`${GOOGLE}/oauth2/v2/userinfo`, {
      headers: { Authorization: `Bearer ${refreshed.access_token}` },
    });
    if (ui3.status !== 200) throw new Error(`expected 200 with refreshed token, got ${ui3.status}`);
    ok("refreshed token works — full expiry→refresh cycle proven end-to-end");

    // ── 5. Provider proxy: an authenticated read through a *different* svc ──
    // Same running server, different provider. In no-config mode GitHub's
    // registry defaultFallback maps any bearer token to the seeded "admin"
    // user, so the consumer just points its GitHub base URL at emulate.
    step("GET /github/user  (Bearer token → proxied GitHub identity)");
    const gh = await fetch(`${ORIGIN}/github/user`, {
      headers: { Authorization: "Bearer ghp_external_demo", "User-Agent": "emulate-external-consumer" },
    });
    if (gh.status !== 200) throw new Error(`expected 200 from /github/user, got ${gh.status}`);
    const ghUser = (await gh.json()) as { login: string; id: number };
    ok(`GitHub proxy returned login=${ghUser.login} id=${ghUser.id}`);

    // The access token is an opaque string; the id_token carries the claims —
    // show the decoded JWT once for the reader.
    console.log("\n  Decoded id_token claims:");
    console.log("  " + JSON.stringify(decodeJwt(tokens.id_token), null, 2).split("\n").join("\n  "));

    console.log(
      "\n✅ External-consumer proof complete — a separate process authenticated\n" +
        "   via OIDC, verified the RS256 id_token against the live JWKS, survived a\n" +
        "   real token-expiry → refresh cycle, and read data through emulate acting\n" +
        "   as a provider proxy. Point any Auth.js app's issuer at " +
        GOOGLE +
        ".\n",
    );
  } finally {
    if (server && !server.killed) server.kill("SIGTERM");
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error("\n❌ External-consumer proof FAILED:\n", err);
  process.exit(1);
});
