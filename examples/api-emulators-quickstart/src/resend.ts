// Resend email API emulator — send, retrieve, inspect.
//
// The transactional-email flow: send a message, retrieve it by id, list the
// outbox, then open the development inbox UI (the local equivalent of the
// Resend dashboard).
//
//   pnpm --filter api-emulators-quickstart resend
import { resendPlugin, seedFromConfig } from "@emulators/resend";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4070";

async function main(): Promise<void> {
  const emu = mount(resendPlugin, BASE, { fallbackUser: { login: "re_test_admin", id: 1, scopes: [] } });

  seedFromConfig(emu.store, BASE, {
    domains: [{ name: "agent-emulate.dev", region: "us-east-1" }],
    contacts: [{ email: "user@agent-emulate.dev", first_name: "Casey", last_name: "User" }],
  });

  const auth = { Authorization: "Bearer re_dev", "Content-Type": "application/json" };

  heading("Resend — send a transactional email");

  const sent = (await call(emu, "POST /emails", `${BASE}/emails`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      from: "noreply@agent-emulate.dev",
      to: ["user@agent-emulate.dev"],
      subject: "Your magic link",
      html: "<p>Click <a href='https://agent-emulate.dev/auth?t=abc'>here</a> to sign in.</p>",
    }),
  })) as { id: string };

  heading("Resend — inspect the captured mail");

  await call(emu, "Retrieve it by id", `${BASE}/emails/${sent.id}`, { headers: auth });
  await call(emu, "List the outbox", `${BASE}/emails`, { headers: auth });
  await call(emu, "Open the dev inbox UI (HTML)", `${BASE}/inbox`, { headers: auth });

  console.log("\n✅ Resend demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
