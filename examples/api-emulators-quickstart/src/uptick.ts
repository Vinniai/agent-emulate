// Uptick emulator — a full narrated walkthrough.
//
// Uptick is asset & defect management for fire-protection field work. Its API
// is JSON:API (`application/vnd.api+json`) with a version path segment
// (`/api/:ver/…`) and name-based FK auto-resolution: create a defect with only
// an `asset` relationship and the property/client are backfilled. This demo:
//
//   1. OAuth 2.0 password grant + the version endpoints.
//   2. JSON:API across clients → properties → assets → defects.
//   3. Asset types & users (read); version-path + page[size] behaviour.
//   4. Defect creation with FK auto-resolution; PATCH status transition.
//   5. Inspector tab UI.
//   6. Round-trip: mutate → storeToSeedConfig → re-seed a fresh store → verify.
//      (Uptick ships no default seed, so the script seeds first.)
//
//   pnpm --filter api-emulators-quickstart uptick
import { uptickPlugin, seedFromConfig, storeToSeedConfig } from "@emulators/uptick";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4020";

interface JsonApiList {
  data: Array<{
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  }>;
}
interface JsonApiOne {
  data: { type: string; id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown> };
}

async function main(): Promise<void> {
  const emu = mount(uptickPlugin, BASE);

  // A contractor that services Acme's fire-protection assets through Uptick.
  // Uptick has NO built-in default seed, so this is mandatory.
  seedFromConfig(emu.store, BASE, {
    asset_types: [{ name: "Sprinkler System", description: "Wet/dry pipe sprinkler network" }],
    users: [{ username: "tech", email: "tech@agent-emulate.dev", first_name: "Tess", last_name: "Tech" }],
    clients: [
      {
        name: "Acme Facilities Pty Ltd",
        sector: "Commercial",
        ref: "ACME-001",
        contact_name: "Dana Ops",
        contact_email: "ops@agent-emulate.dev",
      },
    ],
    properties: [
      {
        name: "North Campus Building A",
        client_name: "Acme Facilities Pty Ltd",
        address_streetline: "12 Industrial Ave",
        address_city: "Sydney",
        address_state: "NSW",
        address_postcode: "2000",
      },
    ],
    assets: [
      {
        name: "Sprinkler Riser #1",
        asset_number: "FP-RISER-001",
        asset_type_name: "Sprinkler System",
        property_name: "North Campus Building A",
        client_name: "Acme Facilities Pty Ltd",
        standard_maintenance: "Annual AS1851 inspection",
      },
    ],
  });

  heading("Uptick — OAuth 2.0 password grant + version endpoints");

  const token = (await call(emu, "Exchange technician credentials for a token", `${BASE}/api/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: "tech@agent-emulate.dev",
      password: "hunter2",
    }).toString(),
  })) as { access_token: string };

  const auth = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/vnd.api+json" };

  await call(emu, "API version metadata", `${BASE}/api/version/`, { headers: auth });
  await call(emu, "Self-describing endpoint index (v2)", `${BASE}/api/v2/`, { headers: auth });

  heading("Uptick — JSON:API resource surface (clients → properties → assets)");

  await call(emu, "List clients (JSON:API envelope)", `${BASE}/api/v2/clients/`, { headers: auth });
  await call(emu, "List properties", `${BASE}/api/v2/properties/`, { headers: auth });
  await call(emu, "Asset types (reference)", `${BASE}/api/v2/assettypes/`, { headers: auth });
  await call(emu, "Users (reference)", `${BASE}/api/v2/users/`, { headers: auth });

  // The version path is just a segment — v1 resolves the same store, and
  // page[size] caps the page. Demonstrates both behaviours in one call.
  await call(emu, "Assets via the v1 path with page[size]=1", `${BASE}/api/v1/assets/?page[size]=1`, {
    headers: auth,
  });

  const assets = (await call(emu, "List assets (relationships resolved)", `${BASE}/api/v2/assets/`, {
    headers: auth,
  })) as JsonApiList;
  const assetId = assets.data[0]!.id;

  heading("Uptick — raise a defect (FK auto-resolution)");

  // Only the asset relationship is supplied; the emulator backfills the
  // property and client from the asset, mirroring Uptick's behaviour.
  const created = (await call(emu, "Create a defect (property/client auto-resolved)", `${BASE}/api/v2/defects/`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      data: {
        type: "Defect",
        attributes: { description: "Riser gauge reading below spec", severity: "high", status: "open" },
        relationships: { asset: { data: { type: "Asset", id: assetId } } },
      },
    }),
  })) as JsonApiOne;
  const defectId = created.data.id;
  const rel = created.data.relationships ?? {};
  console.log(`    ↳ auto-filled relationships: ${Object.keys(rel).join(", ")}`);

  heading("Uptick — PATCH: defect status transition open → closed");

  await call(emu, "PATCH the defect to status=closed", `${BASE}/api/v2/defects/${defectId}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ data: { type: "Defect", id: defectId, attributes: { status: "closed" } } }),
  });
  await call(emu, "Filter defects by status=closed", `${BASE}/api/v2/defects/?status=closed`, { headers: auth });

  heading("Uptick — inspector tab UI (HTML)");

  for (const tab of ["clients", "properties", "assets", "defects", "reference"]) {
    const res = await emu.app.request(`${BASE}/?tab=${tab}`);
    console.log(`▶ GET /?tab=${tab}  →  ${res.status} (${res.headers.get("content-type")})`);
  }

  heading("Uptick — round-trip: export → re-seed → verify");

  // Project the mutated store (with the new closed defect) back to a config.
  const exported = storeToSeedConfig(emu.store, BASE);
  console.log(
    `\n▶ storeToSeedConfig → ${exported.clients?.length ?? 0} clients, ` +
      `${exported.assets?.length ?? 0} assets, ${exported.defects?.length ?? 0} defects`,
  );

  // Re-seed a FRESH emulator from the export and confirm the closed defect
  // (with auto-resolved client/property) survived the round-trip.
  const fresh = mount(uptickPlugin, BASE);
  seedFromConfig(fresh.store, BASE, exported);
  const ftoken = (await (
    await fresh.app.request(`${BASE}/api/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username: "tech@agent-emulate.dev",
        password: "hunter2",
      }).toString(),
    })
  ).json()) as { access_token: string };
  const rt = await fresh.app.request(`${BASE}/api/v2/defects/?status=closed`, {
    headers: { Authorization: `Bearer ${ftoken.access_token}` },
  });
  const rtBody = (await rt.json()) as JsonApiList;
  const ok = rt.status === 200 && rtBody.data.length === 1 && rtBody.data[0]!.attributes.status === "closed";
  console.log(`▶ Fresh store seeded from export → GET defects?status=closed  →  ${rt.status}`);
  console.log(`    round-trip preserved 1 closed defect — ${ok ? "✅ verified" : "❌ MISMATCH"}`);
  if (!ok) process.exit(1);

  console.log("\n✅ Uptick demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
