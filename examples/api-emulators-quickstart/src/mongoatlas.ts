// MongoDB Atlas emulator — Admin API v2 + Data API v1.
//
// First the control plane (list projects and their clusters), then the Data
// API a serverless app uses at runtime (insert a document, read it back, run
// a filtered find).
//
//   pnpm --filter api-emulators-quickstart mongoatlas
import { mongoatlasPlugin, seedFromConfig } from "@emulators/mongoatlas";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4080";

interface GroupList {
  results: Array<{ id: string; name: string }>;
}

async function main(): Promise<void> {
  const emu = mount(mongoatlasPlugin, BASE, { fallbackUser: { login: "admin", id: 1, scopes: [] } });

  seedFromConfig(emu.store, BASE, {
    projects: [{ name: "Production" }],
    clusters: [{ name: "Cluster0", project: "Production" }],
    database_users: [{ username: "app", project: "Production" }],
    databases: [{ cluster: "Cluster0", name: "shop", collections: ["items"] }],
  });

  const auth = { Authorization: "Bearer atlas_dev", "Content-Type": "application/json" };
  const action = (name: string, body: unknown): RequestInit => ({
    method: "POST",
    headers: auth,
    body: JSON.stringify({ dataSource: "Cluster0", database: "shop", collection: "items", ...(body as object) }),
  });

  heading("Atlas Admin API — projects & clusters");

  const groups = (await call(emu, "List projects", `${BASE}/api/atlas/v2/groups`, { headers: auth })) as GroupList;
  const groupId = groups.results[0]!.id;
  await call(emu, "List clusters in the project", `${BASE}/api/atlas/v2/groups/${groupId}/clusters`, {
    headers: auth,
  });

  heading("Atlas Data API — documents");

  await call(
    emu,
    "insertOne",
    `${BASE}/app/data-api/v1/action/insertOne`,
    action("insertOne", {
      document: { sku: "WIDGET-1", name: "Blue Widget", price: 19.99, stock: 42 },
    }),
  );

  await call(
    emu,
    "findOne",
    `${BASE}/app/data-api/v1/action/findOne`,
    action("findOne", {
      filter: { sku: "WIDGET-1" },
    }),
  );

  await call(
    emu,
    "find (price < 50)",
    `${BASE}/app/data-api/v1/action/find`,
    action("find", {
      filter: { price: { $lt: 50 } },
    }),
  );

  console.log("\n✅ MongoDB Atlas demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
