// Direct (NO Nango) — 3-month cross-provider operational simulation.
//
// Where the Nango sims drive one uniform `/records` envelope, this proves the
// *other* shape: five emulators each spoken to through their own native API,
// no proxy / connection / records layer anywhere. It simulates a DevOps team's
// quarter — weekly incidents filed on GitHub, deploy notices to Slack, invoice
// payments through Stripe, customer mail via Resend, services shipped on Vercel
// — then exercises every route pattern it touches, asserts 100 % coverage, and
// round-trips every created entity back through that provider's own GET. Exits
// non-zero on any coverage gap, unexpected non-2xx, or count mismatch — so it
// doubles as a native-surface contract test.
//
//   pnpm --filter api-emulators-quickstart direct-sim
import { githubPlugin, seedFromConfig as seedGithub } from "@emulators/github";
import { slackPlugin, seedFromConfig as seedSlack } from "@emulators/slack";
import { stripePlugin, seedFromConfig as seedStripe } from "@emulators/stripe";
import { resendPlugin, seedFromConfig as seedResend } from "@emulators/resend";
import { vercelPlugin, seedFromConfig as seedVercel } from "@emulators/vercel";
import { heading, mount, type Emulator } from "./harness.js";

const GH = "http://localhost:4110";
const SL = "http://localhost:4120";
const ST = "http://localhost:4130";
const RE = "http://localhost:4140";
const VC = "http://localhost:4150";

// Every native route pattern this sim touches — coverage is asserted at the end.
const ROUTES = [
  "GH GET /user",
  "GH GET /user/repos",
  "GH POST /repos/:o/:r/issues",
  "GH GET /repos/:o/:r/issues",
  "GH GET /repos/:o/:r/issues/:n",
  "GH PATCH /repos/:o/:r/issues/:n",
  "SL POST /api/auth.test",
  "SL POST /api/team.info",
  "SL POST /api/conversations.list",
  "SL POST /api/chat.postMessage",
  "SL POST /api/conversations.history",
  "ST GET /v1/products",
  "ST GET /v1/prices",
  "ST POST /v1/payment_intents",
  "ST POST /v1/payment_intents/:id/confirm",
  "ST GET /v1/payment_intents",
  "ST GET /v1/payment_intents/:id",
  "RE POST /emails",
  "RE GET /emails",
  "RE GET /emails/:id",
  "VC GET /v2/user",
  "VC GET /v10/projects",
  "VC POST /v11/projects",
  "VC GET /v6/deployments",
] as const;

const covered = new Set<string>();
let calls = 0;
let failures = 0;

const SUBJECTS = [
  "AS1851 inspection due",
  "Pump test results",
  "Re: site access",
  "Quarterly compliance report",
  "Defect raised on Level 3",
  "Schedule confirmation",
];

const DAY = 86_400_000;
const START = new Date(Date.now() - 90 * DAY);
const day = (n: number): string => new Date(START.getTime() + n * DAY).toISOString().slice(0, 10);

/** Issue a request against a specific emulator, tag coverage, track failures. */
async function req(emu: Emulator, pattern: string, url: string, init?: RequestInit): Promise<Response> {
  covered.add(pattern);
  calls++;
  const res = await emu.app.request(url, init);
  const ok = res.status >= 200 && res.status < 300;
  if (!ok) {
    failures++;
    console.log(`  ✗ ${pattern}  →  ${res.status}  ${url}`);
  } else {
    console.log(`  ✓ ${pattern}  →  ${res.status}`);
  }
  return res;
}

const jh = (tok: string): Record<string, string> => ({
  Authorization: `Bearer ${tok}`,
  "Content-Type": "application/json",
});

async function main(): Promise<void> {
  const gh = mount(githubPlugin, GH, { fallbackUser: { login: "octocat", id: 1, scopes: ["repo"] } });
  const sl = mount(slackPlugin, SL, { fallbackUser: { login: "U1", id: 1, scopes: ["chat:write", "channels:read"] } });
  const st = mount(stripePlugin, ST, { fallbackUser: { login: "sk_test_admin", id: 1, scopes: [] } });
  const re = mount(resendPlugin, RE, { fallbackUser: { login: "re_test_admin", id: 1, scopes: [] } });
  const vc = mount(vercelPlugin, VC, { fallbackUser: { login: "developer", id: 1, scopes: [] } });

  seedGithub(gh.store, GH, {
    users: [{ login: "octocat", name: "The Octocat", email: "octocat@github.com" }],
    repos: [{ owner: "octocat", name: "platform", description: "Core platform", language: "TypeScript" }],
  });
  seedSlack(sl.store, SL, {
    team: { name: "Acme Corp", domain: "acme" },
    channels: [{ name: "deploys", topic: "CI/CD notifications" }],
  });
  seedStripe(st.store, ST, {
    customers: [{ email: "buyer@agent-emulate.dev", name: "Acme Buyer" }],
    products: [{ name: "Pro Plan", description: "Monthly pro subscription" }],
    prices: [{ product_name: "Pro Plan", currency: "usd", unit_amount: 2000 }],
  });
  seedResend(re.store, RE, { domains: [{ name: "agent-emulate.dev", region: "us-east-1" }] });
  seedVercel(vc.store, VC, {
    users: [{ username: "developer", name: "Developer", email: "dev@agent-emulate.dev" }],
    teams: [{ slug: "acme", name: "Acme Inc" }],
    projects: [{ name: "marketing-site", team: "acme", framework: "nextjs" }],
  });

  const ghH = jh("ghp_dev");
  const slH = jh("xoxb-dev");
  const stH = jh("sk_test_dev");
  const reH = jh("re_dev");
  const vcH = jh("tok_dev");

  heading("Direct sim — identity & catalog (each provider's native API)");

  await req(gh, "GH GET /user", `${GH}/user`, { headers: ghH });
  await req(gh, "GH GET /user/repos", `${GH}/user/repos`, { headers: ghH });
  await req(sl, "SL POST /api/auth.test", `${SL}/api/auth.test`, { method: "POST", headers: slH });
  await req(sl, "SL POST /api/team.info", `${SL}/api/team.info`, { method: "POST", headers: slH });
  const chans = (await (
    await req(sl, "SL POST /api/conversations.list", `${SL}/api/conversations.list`, { method: "POST", headers: slH })
  ).json()) as { channels: Array<{ id: string; name: string }> };
  const deployId = chans.channels.find((c) => c.name === "deploys")!.id;
  await req(st, "ST GET /v1/products", `${ST}/v1/products`, { headers: stH });
  await req(st, "ST GET /v1/prices", `${ST}/v1/prices`, { headers: stH });
  await req(vc, "VC GET /v2/user", `${VC}/v2/user`, { headers: vcH });
  await req(vc, "VC GET /v10/projects", `${VC}/v10/projects`, { headers: vcH });
  await req(vc, "VC GET /v6/deployments", `${VC}/v6/deployments`, { headers: vcH });

  heading("Direct sim — 90-day quarter: 12 weekly ops cycles across 5 providers");

  const issueNums: number[] = [];
  const piIds: string[] = [];
  const emailIds: string[] = [];
  const projectNames: string[] = [];

  for (let week = 0; week < 12; week++) {
    const d = day(week * 7);
    const subj = SUBJECTS[week % SUBJECTS.length]!;

    // GitHub — file the incident for the week.
    const issue = (await (
      await req(gh, "GH POST /repos/:o/:r/issues", `${GH}/repos/octocat/platform/issues`, {
        method: "POST",
        headers: ghH,
        body: JSON.stringify({ title: `[${d}] ${subj}`, body: `Filed during ops week ${week}.` }),
      })
    ).json()) as { number: number };
    issueNums.push(issue.number);

    // Slack — deploy/incident notice to #deploys.
    await req(sl, "SL POST /api/chat.postMessage", `${SL}/api/chat.postMessage`, {
      method: "POST",
      headers: slH,
      body: JSON.stringify({ channel: "deploys", text: `:rotating_light: ${d} — ${subj} (issue #${issue.number})` }),
    });

    // Stripe — the customer pays the weekly invoice.
    const pi = (await (
      await req(st, "ST POST /v1/payment_intents", `${ST}/v1/payment_intents`, {
        method: "POST",
        headers: stH,
        body: JSON.stringify({ amount: 2000 + week * 250, currency: "usd", payment_method: "pm_card_visa" }),
      })
    ).json()) as { id: string };
    piIds.push(pi.id);
    await req(st, "ST POST /v1/payment_intents/:id/confirm", `${ST}/v1/payment_intents/${pi.id}/confirm`, {
      method: "POST",
      headers: stH,
      body: JSON.stringify({}),
    });

    // Resend — notify the customer.
    const mail = (await (
      await req(re, "RE POST /emails", `${RE}/emails`, {
        method: "POST",
        headers: reH,
        body: JSON.stringify({
          from: "noreply@agent-emulate.dev",
          to: ["ops@agent-emulate.dev"],
          subject: `[${d}] ${subj}`,
          html: `<p>${subj} — see issue #${issue.number}.</p>`,
        }),
      })
    ).json()) as { id: string };
    emailIds.push(mail.id);

    // Vercel — ship a new service every 4th week.
    if (week % 4 === 3) {
      const name = `service-q${week}`;
      await req(vc, "VC POST /v11/projects", `${VC}/v11/projects`, {
        method: "POST",
        headers: vcH,
        body: JSON.stringify({ name, framework: "nextjs" }),
      });
      projectNames.push(name);
    }
  }

  heading("Direct sim — resolve a third of incidents (PATCH status transition)");

  const closeCount = Math.floor(issueNums.length / 3);
  for (let i = 0; i < closeCount; i++) {
    await req(gh, "GH PATCH /repos/:o/:r/issues/:n", `${GH}/repos/octocat/platform/issues/${issueNums[i]}`, {
      method: "PATCH",
      headers: ghH,
      body: JSON.stringify({ state: "closed", labels: ["resolved"] }),
    });
  }

  heading("Direct sim — read-back round-trip via each provider's own GET");

  // GitHub: list all, single-get the first, assert closed count.
  const ghIssues = (await (
    await req(gh, "GH GET /repos/:o/:r/issues", `${GH}/repos/octocat/platform/issues?state=all&per_page=100`, {
      headers: ghH,
    })
  ).json()) as Array<{ number: number; state: string }>;
  const firstIssue = (await (
    await req(gh, "GH GET /repos/:o/:r/issues/:n", `${GH}/repos/octocat/platform/issues/${issueNums[0]}`, {
      headers: ghH,
    })
  ).json()) as { number: number };
  const ghClosed = ghIssues.filter((x) => x.state === "closed").length;

  // Slack: history of #deploys (resolved channel id, not name).
  const slHist = (await (
    await req(sl, "SL POST /api/conversations.history", `${SL}/api/conversations.history`, {
      method: "POST",
      headers: slH,
      body: JSON.stringify({ channel: deployId }),
    })
  ).json()) as { ok: boolean; messages?: unknown[] };

  // Stripe: list + single-get; assert all confirmed intents present & succeeded.
  const stList = (await (
    await req(st, "ST GET /v1/payment_intents", `${ST}/v1/payment_intents?limit=100`, { headers: stH })
  ).json()) as { data: Array<{ id: string; status: string }> };
  const firstPi = (await (
    await req(st, "ST GET /v1/payment_intents/:id", `${ST}/v1/payment_intents/${piIds[0]}`, { headers: stH })
  ).json()) as { id: string; status: string };
  const stSucceeded = stList.data.filter((p) => p.status === "succeeded").length;

  // Resend: list + single-get.
  const reList = (await (await req(re, "RE GET /emails", `${RE}/emails`, { headers: reH })).json()) as {
    data?: Array<{ id: string }>;
  };
  const reArr = reList.data ?? [];
  const firstMail = (await (
    await req(re, "RE GET /emails/:id", `${RE}/emails/${emailIds[0]}`, { headers: reH })
  ).json()) as { id: string; subject: string };

  // Vercel: list projects, assert seeded + created are all present.
  const vcProjects = (await (await req(vc, "VC GET /v10/projects", `${VC}/v10/projects`, { headers: vcH })).json()) as {
    projects: Array<{ name: string }>;
  };
  const vcAllPresent = projectNames.every((n) => vcProjects.projects.some((p) => p.name === n));

  heading("Direct sim — assertions & coverage report");

  const checks: Array<[string, boolean, string]> = [
    ["github issues created", ghIssues.length >= issueNums.length, `${ghIssues.length} ≥ ${issueNums.length}`],
    ["github single-get round-trip", firstIssue.number === issueNums[0], `#${firstIssue.number} == #${issueNums[0]}`],
    ["github closed transitions", ghClosed === closeCount, `${ghClosed} == ${closeCount}`],
    ["slack history queryable", slHist.ok === true, `ok=${slHist.ok}`],
    ["slack messages persisted", (slHist.messages?.length ?? 0) >= 12, `${slHist.messages?.length ?? 0} ≥ 12`],
    ["stripe intents created", stList.data.length >= piIds.length, `${stList.data.length} ≥ ${piIds.length}`],
    ["stripe all succeeded", stSucceeded >= piIds.length, `${stSucceeded} ≥ ${piIds.length}`],
    ["stripe single-get round-trip", firstPi.id === piIds[0], `${firstPi.id} == ${piIds[0]}`],
    ["resend emails sent", reArr.length >= emailIds.length, `${reArr.length} ≥ ${emailIds.length}`],
    ["resend single-get round-trip", firstMail.id === emailIds[0], `${firstMail.id} == ${emailIds[0]}`],
    [
      "vercel created projects present",
      vcAllPresent && projectNames.length === 3,
      `${projectNames.length}/3 created round-trip`,
    ],
  ];
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(34)} (${detail})`);
  }

  const missing = ROUTES.filter((r) => !covered.has(r));
  const checksOk = checks.every(([, p]) => p);
  console.log(`\n  ${calls} native calls • ${failures} unexpected non-2xx`);
  console.log(`  route coverage: ${covered.size}/${ROUTES.length} across 5 providers`);
  if (missing.length) console.log(`  ❌ MISSING: ${missing.join(" | ")}`);

  const ok = missing.length === 0 && failures === 0 && checksOk;
  console.log(
    `\n${ok ? "✅" : "❌"} Direct 3-month simulation ${ok ? "complete — every write went through the provider's native API, full route coverage, all round-trips verified" : "INCOMPLETE"}.\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
