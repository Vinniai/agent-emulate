// Nango emulator — org-wide integration management.
//
// Demonstrates the flow a backend uses to manage many linked SaaS accounts
// through one Nango account: list/fetch connections, sync normalised records,
// proxy a provider-native call, and run the hosted connect-session handshake.
//
//   pnpm --filter api-emulators-quickstart nango
import { nangoPlugin, seedFromConfig } from "@emulators/nango";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4030";
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function main(): Promise<void> {
  const emu = mount(nangoPlugin, BASE);

  // An org that has linked both its accounting platforms through Nango.
  seedFromConfig(emu.store, BASE, {
    connections: [
      {
        id: "xero-acme",
        provider: "xero",
        provider_config_key: "xero",
        connection_config: { tenantId: "tenant-acme-0001" },
        metadata: { organizationId: "org_acme" },
        records: {
          Invoice: [{ InvoiceID: "x-1", InvoiceNumber: "INV-001", Total: 990, Status: "AUTHORISED" }],
        },
      },
      {
        id: "quickbooks-acme",
        provider: "quickbooks",
        provider_config_key: "quickbooks",
        connection_config: { realmId: "9341453644728342" },
        metadata: { organizationId: "org_acme" },
        records: {
          Invoice: [{ Id: "1", DocNumber: "1001", TotalAmt: 1100 }],
        },
      },
    ],
  });

  heading("Nango — org-wide connection management");

  await call(emu, "List every linked provider for the org", `${BASE}/connection`);

  await call(emu, "Fetch one connection (with live OAuth2 credentials)", `${BASE}/connections/xero-acme`);

  await call(emu, "Persist sync state on the connection (metadata merge)", `${BASE}/connection/xero-acme/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastSyncedAt: new Date().toISOString(), cursor: "abc123" }),
  });

  await call(emu, "Pull normalised records out of QuickBooks (sync API)", `${BASE}/records?model=Invoice`, {
    headers: { "Connection-Id": "quickbooks-acme", "Provider-Config-Key": "quickbooks" },
  });

  const query = encodeURIComponent("SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100");
  await call(
    emu,
    "Proxy a provider-native QuickBooks query",
    `${BASE}/proxy/v3/company/9341453644728342/query?query=${query}`,
    {
      headers: { "Connection-Id": "quickbooks-acme" },
    },
  );

  heading("Nango — hosted connect-session handshake (new link)");

  const session = (await call(
    emu,
    "Create a connect session for the end user",
    `${BASE}/connect/sessions`,
    json({
      end_user: { id: "user_42", tags: { organizationId: "org_acme" } },
      allowed_integrations: ["xero"],
    }),
  )) as { data: { token: string } };

  const completed = (await call(
    emu,
    "User authorises in the hosted UI → complete",
    `${BASE}/connect/complete`,
    json({
      token: session.data.token,
    }),
  )) as { connectionId: string };

  await call(emu, "Newly materialised connection is now manageable", `${BASE}/connections/${completed.connectionId}`);

  console.log("\n✅ Nango demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
