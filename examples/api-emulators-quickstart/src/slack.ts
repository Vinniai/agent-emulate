// Slack Web API emulator — auth, channels, messages.
//
// The bot-token flow: confirm the token, list conversations, post a message
// (by channel name), then read the channel history back.
//
//   pnpm --filter api-emulators-quickstart slack
import { slackPlugin, seedFromConfig } from "@emulators/slack";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4060";

async function main(): Promise<void> {
  const emu = mount(slackPlugin, BASE, {
    fallbackUser: { login: "U000000001", id: 1, scopes: ["chat:write", "channels:read"] },
  });

  seedFromConfig(emu.store, BASE, {
    team: { name: "Acme Corp", domain: "acme" },
    users: [{ name: "alice", real_name: "Alice Smith", email: "alice@agent-emulate.dev", is_admin: true }],
    channels: [
      { name: "general", topic: "Company-wide announcements" },
      { name: "deploys", topic: "CI/CD notifications" },
    ],
  });

  // Slack methods are all POST; bodies may be JSON or form-urlencoded.
  const auth = { Authorization: "Bearer xoxb-dev", "Content-Type": "application/json" };
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: auth, body: JSON.stringify(body) });

  heading("Slack — identity & channels");

  await call(emu, "auth.test", `${BASE}/api/auth.test`, { method: "POST", headers: auth });
  await call(emu, "conversations.list", `${BASE}/api/conversations.list`, { method: "POST", headers: auth });
  await call(emu, "team.info", `${BASE}/api/team.info`, { method: "POST", headers: auth });

  heading("Slack — post & read a message");

  await call(
    emu,
    "chat.postMessage (#deploys)",
    `${BASE}/api/chat.postMessage`,
    post({
      channel: "deploys",
      text: ":rocket: marketing-site deployed to production",
    }),
  );

  await call(
    emu,
    "conversations.history (#deploys)",
    `${BASE}/api/conversations.history`,
    post({
      channel: "deploys",
    }),
  );

  console.log("\n✅ Slack demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
