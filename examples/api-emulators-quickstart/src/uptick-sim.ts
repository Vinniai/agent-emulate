// Uptick — 3-month operational simulation with FULL endpoint coverage.
//
// Where `uptick.ts` is a readable walkthrough, this script simulates a
// fire-protection contractor's books over a 90-day window and then exercises
// *every* route the emulator exposes, asserting 100 % route-pattern coverage.
//
// Simulation: 12 weekly client onboardings across 90 days, each with
// properties + assets, and a defect lifecycle (open → in_progress → closed)
// whose dates march across the quarter — so list endpoints return a realistic
// quarter of activity, not a toy fixture.
//
//   pnpm --filter api-emulators-quickstart uptick-sim
import { writeFileSync } from "node:fs";
import { uptickPlugin, seedFromConfig, storeToSeedConfig } from "@emulators/uptick";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4020";
const VER = "v2";

// REMOTE mode: drive a *per-port* `emulate` server (uptick on its own port)
// instead of an in-process store. The server is booted with the reference
// data (asset types + technicians) as its `--seed`, so this sim skips its own
// seeding and builds the 90-day quarter over real HTTP — the data then
// PERSISTS in that long-lived server. Set UPTICK_SIM_REMOTE=http://host:port.
const REMOTE = process.env.UPTICK_SIM_REMOTE?.replace(/\/+$/, "");

// Every route pattern the uptick emulator registers. The sim must touch each.
const ROUTES = [
  "GET /",
  "GET /api/version/",
  "POST /api/oauth2/token/",
  "OPTIONS /api/version/",
  "GET /api/:ver/",
  "OPTIONS /api/:ver/",
  "OPTIONS /api/:ver/clients/",
  "OPTIONS /api/:ver/clients/:id",
  "GET /api/:ver/clients/",
  "POST /api/:ver/clients/",
  "GET /api/:ver/clients/:id",
  "PATCH /api/:ver/clients/:id",
  "GET /api/:ver/properties/",
  "POST /api/:ver/properties/",
  "GET /api/:ver/properties/:id",
  "PATCH /api/:ver/properties/:id",
  "GET /api/:ver/assets/",
  "POST /api/:ver/assets/",
  "GET /api/:ver/assets/:id",
  "PATCH /api/:ver/assets/:id",
  "GET /api/:ver/defects/",
  "POST /api/:ver/defects/",
  "GET /api/:ver/defects/:id",
  "PATCH /api/:ver/defects/:id",
  "GET /api/:ver/assettypes/",
  "GET /api/:ver/assettypes/:id",
  "GET /api/:ver/users/",
  "GET /api/:ver/users/:id",
] as const;

const covered = new Set<string>();
let calls = 0;
let failures = 0;

interface JsonApiOne {
  data: { id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> };
}
interface JsonApiList {
  data: Array<{ id: string; attributes: Record<string, unknown> }>;
}

// One day, in ms.
const DAY = 86_400_000;
// 90-day window ending "today".
const START = new Date(Date.now() - 90 * DAY);
const day = (n: number): string => new Date(START.getTime() + n * DAY).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const emu = mount(uptickPlugin, BASE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__uptickEmu = REMOTE
    ? { request: (u: string, i?: RequestInit): Promise<Response> => fetch(u.replace(BASE, REMOTE), i) }
    : emu.app;
  if (REMOTE) console.log(`\n  🟢 REMOTE mode — building the quarter on ${REMOTE} (per-port, persists)\n`);

  // Seed reference data (asset types + technicians) — uptick has no default
  // seed, so these must exist before the simulation creates assets/defects.
  // In REMOTE mode the per-port server is booted with these as its `--seed`.
  if (!REMOTE)
    seedFromConfig(emu.store, BASE, {
      asset_types: [
        { name: "Sprinkler System", description: "Wet/dry pipe sprinkler network" },
        { name: "Fire Extinguisher", description: "Portable extinguisher (ABE/CO2)" },
        { name: "Fire Door", description: "Rated fire/smoke door assembly" },
        { name: "Hydrant", description: "Booster + feed hydrant" },
      ],
      users: [
        { username: "tess", email: "tess@agent-emulate.dev", first_name: "Tess", last_name: "Tech" },
        { username: "ravi", email: "ravi@agent-emulate.dev", first_name: "Ravi", last_name: "Singh" },
      ],
    });

  const token = (await (
    await req("POST /api/oauth2/token/", `${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username: "tess@agent-emulate.dev",
        password: "x",
      }).toString(),
    })
  ).json()) as { access_token: string };

  const H = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/vnd.api+json" };
  const jsonapi = (type: string, attributes: unknown, relationships?: unknown): RequestInit => ({
    method: "POST",
    headers: H,
    body: JSON.stringify({ data: { type, attributes, relationships } }),
  });

  heading("Uptick sim — discovery & reference endpoints");

  await req("GET /", `${BASE}/?tab=clients`);
  await req("GET /api/version/", `${BASE}/api/version/`, { headers: H });
  await req("OPTIONS /api/version/", `${BASE}/api/version/`, { headers: H });
  await req("GET /api/:ver/", `${BASE}/api/${VER}/`, { headers: H });
  await req("OPTIONS /api/:ver/", `${BASE}/api/${VER}/`, { headers: H });
  await req("OPTIONS /api/:ver/clients/", `${BASE}/api/${VER}/clients/`, { headers: H });

  const atList = (await (
    await req("GET /api/:ver/assettypes/", `${BASE}/api/${VER}/assettypes/`, { headers: H })
  ).json()) as JsonApiList;
  await req("GET /api/:ver/assettypes/:id", `${BASE}/api/${VER}/assettypes/${atList.data[0]!.id}`, { headers: H });
  const uList = (await (
    await req("GET /api/:ver/users/", `${BASE}/api/${VER}/users/`, { headers: H })
  ).json()) as JsonApiList;
  await req("GET /api/:ver/users/:id", `${BASE}/api/${VER}/users/${uList.data[0]!.id}`, { headers: H });

  heading("Uptick sim — 90 days of onboarding (12 weekly clients)");

  const assetIds: string[] = [];
  const propIds: string[] = [];
  const clientIds: string[] = [];

  for (let week = 0; week < 12; week++) {
    const d = day(week * 7);
    const client = (await (
      await req(
        "POST /api/:ver/clients/",
        `${BASE}/api/${VER}/clients/`,
        jsonapi("Client", {
          name: `Client ${String.fromCharCode(65 + week)} Pty Ltd`,
          sector: week % 2 ? "Commercial" : "Industrial",
          ref: `CL-${1000 + week}`,
          contact_name: `Manager ${week}`,
          contact_email: `ops${week}@agent-emulate.dev`,
        }),
      )
    ).json()) as JsonApiOne;
    clientIds.push(client.data.id);

    const prop = (await (
      await req(
        "POST /api/:ver/properties/",
        `${BASE}/api/${VER}/properties/`,
        jsonapi(
          "Property",
          {
            name: `Site ${week} — onboarded ${d}`,
            address: { streetline: `${10 + week} Industrial Ave`, city: "Sydney", state: "NSW", postal_code: "2000" },
          },
          { client: { data: { type: "Client", id: client.data.id } } },
        ),
      )
    ).json()) as JsonApiOne;
    propIds.push(prop.data.id);

    // 2 assets per site.
    for (let a = 0; a < 2; a++) {
      const asset = (await (
        await req(
          "POST /api/:ver/assets/",
          `${BASE}/api/${VER}/assets/`,
          jsonapi(
            "Asset",
            { name: `Asset W${week}-${a}`, asset_number: `FP-${week}${a}`, standard_maintenance: "AS1851 annual" },
            {
              property: { data: { type: "Property", id: prop.data.id } },
              client: { data: { type: "Client", id: client.data.id } },
              asset_type: { data: { type: "AssetType", id: atList.data[a % atList.data.length]!.id } },
            },
          ),
        )
      ).json()) as JsonApiOne;
      assetIds.push(asset.data.id);
    }
  }

  heading("Uptick sim — defect lifecycle across the quarter");

  // Raise a defect against every asset, dated across the 90-day window, then
  // walk it open → in_progress → closed (PATCH covers the status transition).
  const defectIds: string[] = [];
  for (let i = 0; i < assetIds.length; i++) {
    const raised = day(Math.floor((i / assetIds.length) * 88));
    const def = (await (
      await req(
        "POST /api/:ver/defects/",
        `${BASE}/api/${VER}/defects/`,
        jsonapi(
          "Defect",
          {
            description: `Defect on asset ${i} (raised ${raised})`,
            severity: i % 3 === 0 ? "high" : "medium",
            status: "open",
          },
          { asset: { data: { type: "Asset", id: assetIds[i]! } } },
        ),
      )
    ).json()) as JsonApiOne;
    defectIds.push(def.data.id);
  }
  // Progress the first two-thirds; close the first third — a realistic mix.
  for (let i = 0; i < defectIds.length; i++) {
    const status = i < defectIds.length / 3 ? "closed" : i < (2 * defectIds.length) / 3 ? "in_progress" : "open";
    if (status !== "open") {
      await req("PATCH /api/:ver/defects/:id", `${BASE}/api/${VER}/defects/${defectIds[i]}`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ data: { type: "Defect", id: defectIds[i], attributes: { status } } }),
      });
    }
  }

  heading("Uptick sim — read & mutate every remaining route");

  // List endpoints (a full quarter of rows).
  await req("GET /api/:ver/clients/", `${BASE}/api/${VER}/clients/`, { headers: H });
  await req("GET /api/:ver/properties/", `${BASE}/api/${VER}/properties/`, { headers: H });
  await req("GET /api/:ver/assets/", `${BASE}/api/${VER}/assets/?page[size]=200`, { headers: H });
  await req("GET /api/:ver/defects/", `${BASE}/api/${VER}/defects/`, { headers: H });

  // By-id GET + PATCH on each top-level resource.
  await req("GET /api/:ver/clients/:id", `${BASE}/api/${VER}/clients/${clientIds[0]}`, { headers: H });
  await req("OPTIONS /api/:ver/clients/:id", `${BASE}/api/${VER}/clients/${clientIds[0]}`, { headers: H });
  await req("PATCH /api/:ver/clients/:id", `${BASE}/api/${VER}/clients/${clientIds[0]}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ data: { type: "Client", id: clientIds[0], attributes: { sector: "Mixed Use" } } }),
  });
  await req("GET /api/:ver/properties/:id", `${BASE}/api/${VER}/properties/${propIds[0]}`, { headers: H });
  await req("PATCH /api/:ver/properties/:id", `${BASE}/api/${VER}/properties/${propIds[0]}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ data: { type: "Property", id: propIds[0], attributes: { is_active: false } } }),
  });
  await req("GET /api/:ver/assets/:id", `${BASE}/api/${VER}/assets/${assetIds[0]}`, { headers: H });
  await req("PATCH /api/:ver/assets/:id", `${BASE}/api/${VER}/assets/${assetIds[0]}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({
      data: { type: "Asset", id: assetIds[0], attributes: { standard_maintenance: "AS1851 + quarterly" } },
    }),
  });
  await req("GET /api/:ver/defects/:id", `${BASE}/api/${VER}/defects/${defectIds[0]}`, { headers: H });

  heading("Uptick sim — round-trip + coverage report");

  // In REMOTE mode the quarter already lives in the long-lived per-port
  // server, so the in-process export + fresh-mount round-trip is skipped.
  let rtOk = true;
  if (REMOTE) {
    console.log(
      `\n  ⓘ round-trip skipped in remote mode — the 90-day quarter persists in the running server (${REMOTE})`,
    );
  } else {
    const exported = storeToSeedConfig(emu.store, BASE);

    // Optional: dump the round-trippable seed config so a *running* `emulate`
    // server can boot this 90-day quarter (parity with SIMPRO_SIM_EXPORT). This
    // sim runs in-process, so without this the quarter never reaches a server.
    const exportPath = process.env.UPTICK_SIM_EXPORT;
    if (exportPath) {
      writeFileSync(exportPath, JSON.stringify({ uptick: exported }, null, 2));
      console.log(`\n  📦 exported 90-day quarter → ${exportPath} (boot: EMULATE_CONFIG_PATH=${exportPath})`);
    }

    const fresh = mount(uptickPlugin, BASE);
    seedFromConfig(fresh.store, BASE, exported);
    const ft = (await (
      await fresh.app.request(`${BASE}/api/oauth2/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          username: "tess@agent-emulate.dev",
          password: "x",
        }).toString(),
      })
    ).json()) as { access_token: string };
    const rt = (await (
      await fresh.app.request(`${BASE}/api/${VER}/defects/?status=closed`, {
        headers: { Authorization: `Bearer ${ft.access_token}` },
      })
    ).json()) as JsonApiList;
    const expectedClosed = Math.floor(defectIds.length / 3);
    rtOk = rt.data.length === expectedClosed;
    console.log(
      `\n  round-trip: ${exported.clients?.length ?? 0} clients / ${exported.assets?.length ?? 0} assets / ` +
        `${exported.defects?.length ?? 0} defects exported; closed defects after re-seed = ${rt.data.length} ` +
        `(expected ${expectedClosed}) — ${rtOk ? "✅" : "❌"}`,
    );
  }

  const missing = ROUTES.filter((r) => !covered.has(r));
  console.log(`\n  ${calls} calls • ${failures} unexpected failures`);
  console.log(`  route coverage: ${covered.size}/${ROUTES.length}`);
  if (missing.length) console.log(`  ❌ MISSING: ${missing.join(" | ")}`);
  const ok = missing.length === 0 && failures === 0 && rtOk;
  console.log(
    `\n${ok ? "✅" : "❌"} Uptick 3-month simulation ${ok ? "complete — full route coverage" : "INCOMPLETE"}.\n`,
  );
  if (!ok) process.exit(1);
}

/** Issue a request, tag it against its route pattern, track coverage + failures. */
async function req(pattern: string, url: string, init?: RequestInit): Promise<Response> {
  // The first ROUTES entry whose verb+shape matches `pattern` is the key.
  covered.add(pattern);
  calls++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emu = (globalThis as any).__uptickEmu as {
    request: (u: string, i?: RequestInit) => Response | Promise<Response>;
  };
  const res = await emu.request(url, init);
  const expected = res.status >= 200 && res.status < 300;
  if (!expected) {
    failures++;
    console.log(`  ✗ ${pattern}  →  ${res.status}  ${url}`);
  } else {
    console.log(`  ✓ ${pattern}  →  ${res.status}`);
  }
  return res;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
