// The composed end-to-end story — the whole three-pillar vision in one run.
//
// A user signs in to an app with **WorkOS**, opens their dashboard and
// **connects applications** (Google Mail + Drive through Nango, and SimPro
// directly via its own OAuth). All of that provider data **flows back to the
// end app** through the emulators acting as proxies. Then we **watch live
// activity arrive**: the `@emulators/simulator` drips brand-new Gmail messages
// into the running emulator over real wall-clock time and each one is
// delivered to the app's webhook sink — exactly how a real connector would
// feed events into production.
//
// Everything is in-process (no ports, no network): each emulator is a
// `ServicePlugin` mounted by `@emulators/core`, and the simulator's `fetch` is
// injected straight to `app.request`.
//
//   pnpm --filter api-emulators-quickstart workos-dashboard-live
//
// Acts:
//   1. Sign in with WorkOS            — identity for the end app's user.
//   2. Connect apps from the dashboard — Nango connect-session (Google), and
//                                        SimPro's own OAuth 2.0 code flow.
//   3. Unified data back to the app    — proxied reads across all providers.
//   4. Watch live events flow in       — simulator drips Gmail → webhook sink.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workosPlugin, seedFromConfig as seedWorkos } from "@emulators/workos";
import { nangoPlugin, seedFromConfig as seedNango } from "@emulators/nango";
import { simproPlugin, seedFromConfig as seedSimpro } from "@emulators/simpro";
import { loadScenario, Simulator } from "@emulators/simulator";
import { call, heading, mount } from "./harness.js";

const WORKOS = "http://localhost:4400";
const NANGO = "http://localhost:4401";
const SIMPRO = "http://localhost:4402";

const WORKOS_CLIENT = "client_app_01";
const WORKOS_REDIRECT = "http://localhost:3000/callback";
const APP_WEBHOOK = "https://acme-app.example/webhooks/nango";

const scenarioPath = (f: string): string => fileURLToPath(new URL(`../scenarios/${f}`, import.meta.url));
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function recordCount(
  emu: ReturnType<typeof mount>,
  base: string,
  id: string,
  key: string,
  model: string,
): Promise<number> {
  const r = await emu.app.request(`${base}/records?model=${model}`, {
    headers: { "Connection-Id": id, "Provider-Config-Key": key },
  });
  return ((await r.json()) as { records: unknown[] }).records.length;
}

async function deliveriesTo(emu: ReturnType<typeof mount>, base: string, url: string): Promise<number> {
  const r = await emu.app.request(`${base}/webhook-deliveries`);
  const all = ((await r.json()) as { deliveries: { url?: string }[] }).deliveries;
  return all.filter((d) => d.url === url).length;
}

async function main(): Promise<void> {
  let ok = true;

  // ── Mount the three emulators the app talks to ──────────────────────────
  const workos = mount(workosPlugin, WORKOS);
  const nango = mount(nangoPlugin, NANGO);
  const simpro = mount(simproPlugin, SIMPRO);

  seedWorkos(workos.store, WORKOS, {
    users: [{ email: "dev@agent-emulate.dev", first_name: "Dev", last_name: "User", password: "DevPassword123!" }],
    organizations: [{ name: "Acme Inc", slug: "acme" }],
    memberships: [{ user_email: "dev@agent-emulate.dev", organization_slug: "acme", role: "owner" }],
    oauth_clients: [{ client_id: WORKOS_CLIENT, client_secret: "sk_app_secret", redirect_uris: [WORKOS_REDIRECT] }],
  });

  // The org's already-linked Google connections (Mail + Drive), each with a
  // little pre-existing history so the "unified view" isn't empty before any
  // live activity. `gm-acme`/`google-mail` matches scenarios/single-gmail.yaml.
  seedNango(nango.store, NANGO, {
    connections: [
      {
        id: "gm-acme",
        provider: "gmail",
        provider_config_key: "google-mail",
        metadata: { organizationId: "org_acme", linkedBy: "dev@agent-emulate.dev" },
        records: {
          messages: [
            { id: "seed-m-1", snippet: "Welcome to Acme", _historyAt: new Date(Date.now() - 86_400_000).toISOString() },
          ],
        },
      },
      {
        id: "dr-acme",
        provider: "drive",
        provider_config_key: "google-drive",
        metadata: { organizationId: "org_acme", linkedBy: "dev@agent-emulate.dev" },
        records: {
          files: [
            { id: "seed-f-1", name: "Q3 Plan.gdoc", modifiedTime: new Date(Date.now() - 3_600_000).toISOString() },
          ],
        },
      },
    ],
  });

  seedSimpro(simpro.store, SIMPRO, {
    oauth: { client_id: "acme_app", client_secret: "acme_app_secret" },
    companies: [{ id: 0, name: "Acme Facilities" }],
    customers: [{ id: 200, type: "company", company_name: "North Campus", email: "ops@agent-emulate.dev" }],
    jobs: [
      { id: 12345, type: "Project", name: "Sprinkler Overhaul Q3", customer_id: 200, stage: 3, order_no: "PO-4481" },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────────
  heading("Act 1 — The user signs in with WorkOS");

  const authz = await workos.app.request(
    `${WORKOS}/user_management/authorize?response_type=code&client_id=${WORKOS_CLIENT}` +
      `&redirect_uri=${encodeURIComponent(WORKOS_REDIRECT)}&state=login1`,
    { redirect: "manual" },
  );
  const wcode = new URL(authz.headers.get("Location")!).searchParams.get("code")!;
  console.log(`\n▶ GET /user_management/authorize  →  ${authz.status}  (code=${wcode.slice(0, 10)}…)`);

  const session = (await call(
    workos,
    "App exchanges the code for the user session",
    `${WORKOS}/user_management/authenticate`,
    json({ grant_type: "authorization_code", client_id: WORKOS_CLIENT, code: wcode }),
  )) as {
    user: { id: string; email: string };
  };
  const membership = (await call(
    workos,
    "App loads the user's org membership (dashboard context)",
    `${WORKOS}/user_management/organization_memberships?user_id=${session.user.id}`,
  )) as { data: { organization_id: string; role: { slug: string } }[] };
  const signedIn = Boolean(session.user.email) && (membership.data?.length ?? 0) > 0;
  console.log(
    `\n  signed in as ${session.user.email} • ${membership.data?.length ?? 0} org membership(s) — ${signedIn ? "✅" : "❌"}`,
  );
  ok &&= signedIn;

  // ─────────────────────────────────────────────────────────────────────────
  heading("Act 2 — From the dashboard, the user connects applications");

  // 2a. Google (Mail + Drive) — the hosted Nango connect-session handshake,
  //     exactly what the "Connect Google" button does.
  const connect = (await call(
    nango,
    "Dashboard opens a Nango connect session for the user",
    `${NANGO}/connect/sessions`,
    json({
      end_user: { id: session.user.id, email: session.user.email, tags: { organizationId: "org_acme" } },
      allowed_integrations: ["google-mail", "google-drive"],
    }),
  )) as { data: { token: string } };
  const completed = (await call(
    nango,
    "User authorises Google in the popup → connection materialises",
    `${NANGO}/connect/complete`,
    json({ token: connect.data.token }),
  )) as { connectionId: string };
  const linked = Boolean(completed.connectionId);
  console.log(`\n  Google linked via Nango connection "${completed.connectionId}" — ${linked ? "✅" : "❌"}`);
  ok &&= linked;

  // 2b. SimPro — its own OAuth 2.0 authorization-code flow ("Connect SimPro").
  const sAuth = await simpro.app.request(
    `${SIMPRO}/oauth/authorize?client_id=acme_app&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  const scode = new URL(sAuth.headers.get("Location")!).searchParams.get("code")!;
  console.log(`\n▶ GET /oauth/authorize (SimPro)  →  ${sAuth.status}  (code=${scode.slice(0, 12)}…)`);
  const sTok = (await call(
    simpro,
    "App exchanges the SimPro code for an access token",
    `${SIMPRO}/oauth/token`,
    json({ grant_type: "authorization_code", code: scode, client_id: "acme_app" }),
  )) as { access_token: string };
  const simproLinked = Boolean(sTok.access_token);
  console.log(`\n  SimPro linked (token ${sTok.access_token?.slice(0, 10)}…) — ${simproLinked ? "✅" : "❌"}`);
  ok &&= simproLinked;

  // ─────────────────────────────────────────────────────────────────────────
  heading("Act 3 — All the connected data flows back to the end app");

  await call(nango, "App lists every linked provider for the org", `${NANGO}/connection`);
  await call(nango, "App pulls Gmail messages (proxied through Nango)", `${NANGO}/records?model=messages`, {
    headers: { "Connection-Id": "gm-acme", "Provider-Config-Key": "google-mail" },
  });
  await call(nango, "App pulls Drive files (proxied through Nango)", `${NANGO}/records?model=files`, {
    headers: { "Connection-Id": "dr-acme", "Provider-Config-Key": "google-drive" },
  });
  const simproAuth = { Authorization: `Bearer ${sTok.access_token}`, "Content-Type": "application/json" };
  const job = (await call(
    simpro,
    "App reads the SimPro job (its own API surface)",
    `${SIMPRO}/api/v1.0/companies/0/jobs/12345`,
    {
      headers: simproAuth,
    },
  )) as { Name?: string };
  const unified = job?.Name === "Sprinkler Overhaul Q3";
  console.log(`\n  unified app view assembled across WorkOS + Google + SimPro — ${unified ? "✅" : "❌"}`);
  ok &&= unified;

  // ─────────────────────────────────────────────────────────────────────────
  heading("Act 4 — The app watches live events arrive (simulator → webhook)");

  // The app registers its webhook sink with Nango; every sync delivery now
  // lands at the app's endpoint.
  await call(
    nango,
    "App registers its webhook sink with Nango",
    `${NANGO}/webhook-settings`,
    json({ url: APP_WEBHOOK, events: ["sync", "forward"] }),
  );

  const beforeMsgs = await recordCount(nango, NANGO, "gm-acme", "google-mail", "messages");
  const beforeDeliv = await deliveriesTo(nango, NANGO, APP_WEBHOOK);

  // The simulator dribbles brand-new Gmail messages into the *running*
  // emulator over real wall-clock time — exactly what a live connector does.
  const scenario = loadScenario(readFileSync(scenarioPath("single-gmail.yaml"), "utf8"));
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(nango.app.request(url, init)) as Promise<Response>;
  const t0 = Date.now();
  let ticks = 0;
  const sim = new Simulator(scenario, {
    base: NANGO,
    fetch: fetchImpl,
    onTick: (i) => {
      ticks++;
      console.log(`  +${String(Date.now() - t0).padStart(5)}ms  new email #${i.seq} → delivered to ${APP_WEBHOOK}`);
    },
  });
  await sim.start();
  // Let the final in-flight delivery settle before we read tallies.
  for (let k = 0; k < 200; k++) await new Promise<void>((r) => setImmediate(r));

  const afterMsgs = await recordCount(nango, NANGO, "gm-acme", "google-mail", "messages");
  const afterDeliv = await deliveriesTo(nango, NANGO, APP_WEBHOOK);
  const grew = afterMsgs - beforeMsgs;
  const delivered = afterDeliv - beforeDeliv;
  const liveOk = ticks === 6 && grew === 6 && delivered >= 6;
  console.log(
    `\n  ${ticks} live emails streamed in ~${((Date.now() - t0) / 1000).toFixed(1)}s • ` +
      `GET /records: ${beforeMsgs} → ${afterMsgs} (+${grew}) • ` +
      `app webhook deliveries: +${delivered}  — ${liveOk ? "✅ live + delivered to the app" : "❌"}`,
  );
  ok &&= liveOk;

  // ─────────────────────────────────────────────────────────────────────────
  heading("Composed end-to-end — summary");
  console.log(`  Act 1  sign in with WorkOS             ${signedIn ? "✅" : "❌"}`);
  console.log(`  Act 2  connect Google (Nango) + SimPro ${linked && simproLinked ? "✅" : "❌"}`);
  console.log(`  Act 3  unified data back to the app    ${unified ? "✅" : "❌"}`);
  console.log(`  Act 4  live events → app webhook sink  ${liveOk ? "✅" : "❌"}`);
  console.log(
    `\n${ok ? "✅" : "❌"} ${ok ? "Full simulation complete — auth → connect → unified proxy reads → live activity into the app." : "Composed run INCOMPLETE."}\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
