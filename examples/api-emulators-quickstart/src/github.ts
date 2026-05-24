// GitHub REST API emulator — users, repos, issues.
//
// The flow an integration (or Octokit) drives against api.github.com: identify
// the token's user, browse repos, then open and update an issue.
//
//   pnpm --filter api-emulators-quickstart github
import { githubPlugin, seedFromConfig } from "@emulators/github";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4050";

async function main(): Promise<void> {
  const emu = mount(githubPlugin, BASE, {
    fallbackUser: { login: "octocat", id: 1, scopes: ["repo", "user", "admin:org"] },
  });

  seedFromConfig(emu.store, BASE, {
    users: [{ login: "octocat", name: "The Octocat", email: "octocat@github.com" }],
    repos: [{ owner: "octocat", name: "hello-world", description: "My first repo", language: "TypeScript" }],
  });

  const auth = { Authorization: "Bearer ghp_dev", "Content-Type": "application/json" };

  heading("GitHub — identity & repositories");

  await call(emu, "Get the authenticated user", `${BASE}/user`, { headers: auth });
  await call(emu, "List the user's repos", `${BASE}/user/repos`, { headers: auth });
  await call(emu, "Get one repo", `${BASE}/repos/octocat/hello-world`, { headers: auth });

  heading("GitHub — issue lifecycle");

  const issue = (await call(emu, "Open an issue", `${BASE}/repos/octocat/hello-world/issues`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ title: "Flaky CI on main", body: "Re-runs pass — investigate." }),
  })) as { number: number };

  await call(emu, "Update the issue", `${BASE}/repos/octocat/hello-world/issues/${issue.number}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ state: "closed", labels: ["bug"] }),
  });

  await call(emu, "List issues", `${BASE}/repos/octocat/hello-world/issues?state=all`, { headers: auth });

  console.log("\n✅ GitHub demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
