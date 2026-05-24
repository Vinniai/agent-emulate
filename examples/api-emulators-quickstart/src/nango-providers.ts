// Nango provider library — one quickstart over the whole seed catalogue.
//
// `examples/nango-seeds.yaml` is a 34-provider, SDK-aligned seed library. This
// script loads it whole, seeds every connection into one Nango emulator, then
// walks a representative provider per category — listing the connection,
// pulling normalised records out of the sync API, and (for Salesforce) making
// a provider-native `/proxy/*` call. It ends with a summary table.
//
//   pnpm --filter api-emulators-quickstart nango-providers
//
// Next step for *live* activity (gmail/teams/drive/calendar/whatsapp streaming
// in real time) see `packages/@emulators/simulator/` — `emulate-sim` with
// `inbox-stream.yaml`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { nangoPlugin, seedFromConfig } from "@emulators/nango";
import { heading, mount } from "./harness.js";

const BASE = "http://localhost:4030";
const SEEDS = fileURLToPath(new URL("../../nango-seeds.yaml", import.meta.url));

// One representative provider per category. The connection id + record models
// are discovered from the YAML, so this stays correct as the library grows.
const REPRESENTATIVE: Array<{ category: string; provider_config_key: string }> = [
  { category: "CRM", provider_config_key: "salesforce" },
  { category: "Accounting", provider_config_key: "freshbooks" },
  { category: "Comms", provider_config_key: "mailchimp" },
  { category: "Storage", provider_config_key: "dropbox" },
  { category: "Calendar", provider_config_key: "google-calendar" },
  { category: "Issues", provider_config_key: "jira" },
  { category: "Code", provider_config_key: "github" },
  { category: "Support", provider_config_key: "zendesk" },
  { category: "HR", provider_config_key: "greenhouse" },
  { category: "Ecommerce", provider_config_key: "shopify" },
  { category: "Analytics", provider_config_key: "mixpanel" },
  { category: "Forms", provider_config_key: "typeform" },
];

interface SeedConn {
  id: string;
  provider: string;
  provider_config_key: string;
  records?: Record<string, Record<string, unknown>[]>;
}

async function main(): Promise<void> {
  const doc = parse(readFileSync(SEEDS, "utf8")) as { nango?: { connections?: SeedConn[] } };
  const connections = doc.nango?.connections ?? [];

  const emu = mount(nangoPlugin, BASE);
  seedFromConfig(emu.store, BASE, { connections });

  heading(`Nango — loaded ${connections.length} connections from nango-seeds.yaml`);

  const listed = (await (await emu.app.request(`${BASE}/connection`)).json()) as {
    connections: Array<{ connection_id?: string; id?: string }>;
  };
  console.log(`\n▶ GET /connection  →  ${listed.connections.length} connections registered\n`);

  const summary: Array<{ category: string; provider: string; id: string; models: string; rows: number }> = [];

  for (const { category, provider_config_key } of REPRESENTATIVE) {
    const conn = connections.find((c) => c.provider_config_key === provider_config_key);
    if (!conn) {
      console.log(`⚠️  ${provider_config_key} not present in seed library — skipping`);
      continue;
    }
    const models = Object.keys(conn.records ?? {});

    // 1. Resolve the connection (returns live OAuth2 credentials).
    const cRes = await emu.app.request(`${BASE}/connections/${conn.id}`);

    // 2. Pull normalised records for every model the seed defines.
    let total = 0;
    const perModel: string[] = [];
    for (const model of models) {
      const r = await emu.app.request(`${BASE}/records?model=${encodeURIComponent(model)}`, {
        headers: { "Connection-Id": conn.id, "Provider-Config-Key": conn.provider_config_key },
      });
      const body = (await r.json()) as { records: unknown[] };
      total += body.records.length;
      perModel.push(`${model}(${body.records.length})`);
    }

    console.log(
      `▶ ${category.padEnd(10)} ${provider_config_key.padEnd(16)} ` +
        `GET /connections/${conn.id} → ${cRes.status}  •  records: ${perModel.join(", ")}`,
    );

    summary.push({
      category,
      provider: provider_config_key,
      id: conn.id,
      models: models.join(", "),
      rows: total,
    });
  }

  heading("Nango — provider-native /proxy call (Salesforce SOQL)");

  const sf = connections.find((c) => c.provider_config_key === "salesforce")!;
  const soql = encodeURIComponent("SELECT Id, Name FROM Account");
  const proxy = await emu.app.request(`${BASE}/proxy/services/data/v59.0/query?q=${soql}`, {
    headers: { "Connection-Id": sf.id, "Provider-Config-Key": "salesforce" },
  });
  const proxyBody = (await proxy.json()) as { records?: unknown[] };
  console.log(
    `\n▶ GET /proxy/services/data/v59.0/query?q=…  →  ${proxy.status} ` +
      `(${proxyBody.records?.length ?? 0} native records returned)`,
  );

  heading("Summary — representative provider per category");

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`\n  ${pad("CATEGORY", 11)}${pad("PROVIDER", 17)}${pad("CONNECTION", 22)}${pad("MODELS", 34)}ROWS`);
  console.log(`  ${"─".repeat(88)}`);
  for (const s of summary) {
    console.log(`  ${pad(s.category, 11)}${pad(s.provider, 17)}${pad(s.id, 22)}${pad(s.models, 34)}${s.rows}`);
  }

  const allHaveRows = summary.length === REPRESENTATIVE.length && summary.every((s) => s.rows > 0);
  console.log(
    `\n  ${summary.length}/${REPRESENTATIVE.length} categories covered, ` +
      `all with non-zero records — ${allHaveRows ? "✅ verified" : "❌ MISMATCH"}`,
  );
  if (!allHaveRows) process.exit(1);

  console.log("\n✅ Nango provider-library demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
