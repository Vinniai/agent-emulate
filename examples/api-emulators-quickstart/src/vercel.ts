// Vercel REST API emulator — projects, deployments, teams.
//
// The token-gated REST surface a deploy tool would drive: identify the user,
// list and create projects, then list deployments.
//
//   pnpm --filter api-emulators-quickstart vercel
import { vercelPlugin, seedFromConfig } from "@emulators/vercel";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4040";

async function main(): Promise<void> {
  // Any bearer token resolves to "developer" (the registry defaultFallback).
  const emu = mount(vercelPlugin, BASE, { fallbackUser: { login: "developer", id: 1, scopes: [] } });

  seedFromConfig(emu.store, BASE, {
    users: [{ username: "developer", name: "Developer", email: "dev@agent-emulate.dev" }],
    teams: [{ slug: "acme", name: "Acme Inc" }],
    projects: [{ name: "marketing-site", team: "acme", framework: "nextjs" }],
  });

  const auth = { Authorization: "Bearer tok_dev", "Content-Type": "application/json" };

  heading("Vercel — identity & projects");

  await call(emu, "Who am I?", `${BASE}/v2/user`, { headers: auth });
  await call(emu, "List projects", `${BASE}/v10/projects`, { headers: auth });

  await call(emu, "Create a new project", `${BASE}/v11/projects`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "api-gateway", framework: "nextjs" }),
  });

  await call(emu, "List projects again (the new one is there)", `${BASE}/v10/projects`, { headers: auth });

  heading("Vercel — deployments");

  await call(emu, "List deployments", `${BASE}/v6/deployments`, { headers: auth });

  console.log("\n✅ Vercel demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
