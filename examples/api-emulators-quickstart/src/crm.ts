// CRM emulators end-to-end — HubSpot CRM v3/v4 + Salesforce REST/SOQL.
//
// Both surfaces are served by the Nango plugin's *direct* routes (no proxy /
// connection layer): a backend points its HubSpot/Salesforce client at the
// emulator base URL and exercises the real object API. This demo runs the
// integration a real CRM sync does end-to-end:
//
//   HubSpot:    OAuth → create contact/company → associate → CRM Search → batch
//   Salesforce: OAuth (password) → sObject CRUD → SOQL → describe → composite
//
//   pnpm --filter api-emulators-quickstart crm
import { nangoPlugin } from "@emulators/nango";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4035";

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

const jsonReq = (token: string, body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const get = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

async function main(): Promise<void> {
  const emu = mount(nangoPlugin, BASE);

  // ── HubSpot CRM ─────────────────────────────────────────────────────────
  heading("HubSpot — OAuth 2.0 authorization-code flow");

  await call(
    emu,
    "Consent screen (HTML)",
    `${BASE}/hubspot-emu/oauth/authorize?client_id=cid&redirect_uri=https://app.test/cb&scope=crm.objects.contacts.write&state=hs1`,
  );

  // The hosted consent form posts back here; the emulator mints a code and
  // 302-redirects to the app's callback with `?code=…`.
  const hsCb = await emu.app.request(
    `${BASE}/hubspot-emu/oauth/authorize/callback`,
    form({ client_id: "cid", redirect_uri: "https://app.test/cb", scope: "crm.objects.contacts.write", state: "hs1" }),
  );
  const hsCode = new URL(hsCb.headers.get("location") as string).searchParams.get("code") as string;
  console.log(`\n▶ Authorize callback  →  ${hsCb.status}  (code=${hsCode.slice(0, 8)}…)`);

  const hsTok = (await call(
    emu,
    "Exchange code for tokens",
    `${BASE}/hubspot-emu/oauth/v1/token`,
    form({ grant_type: "authorization_code", code: hsCode, client_id: "cid", redirect_uri: "https://app.test/cb" }),
  )) as { access_token: string };
  const hsToken = hsTok.access_token;

  heading("HubSpot — objects, associations, search, batch");

  const contact = (await call(
    emu,
    "Create a contact",
    `${BASE}/hubspot-emu/crm/v3/objects/contacts`,
    jsonReq(hsToken, {
      properties: { email: "ada@agent-emulate.dev", firstname: "Ada", lastname: "Lovelace", lifecyclestage: "lead" },
    }),
  )) as { id: string };

  const company = (await call(
    emu,
    "Create a company",
    `${BASE}/hubspot-emu/crm/v3/objects/companies`,
    jsonReq(hsToken, { properties: { name: "Acme Corp", domain: "agent-emulate.dev" } }),
  )) as { id: string };

  await call(
    emu,
    "Associate the contact with the company (v4)",
    `${BASE}/hubspot-emu/crm/v4/objects/contacts/${contact.id}/associations/companies/${company.id}`,
    { method: "PUT", headers: { Authorization: `Bearer ${hsToken}` } },
  );

  await call(
    emu,
    "List the contact's company associations",
    `${BASE}/hubspot-emu/crm/v4/objects/contacts/${contact.id}/associations/companies`,
    get(hsToken),
  );

  await call(
    emu,
    "Patch the contact",
    `${BASE}/hubspot-emu/crm/v3/objects/contacts/${contact.id}`,
    jsonReq(hsToken, { properties: { lifecyclestage: "customer" } }, "PATCH"),
  );

  await call(
    emu,
    "CRM Search — contacts where lifecyclestage = customer",
    `${BASE}/hubspot-emu/crm/v3/objects/contacts/search`,
    jsonReq(hsToken, {
      filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }] }],
    }),
  );

  await call(
    emu,
    "Batch-create two more companies",
    `${BASE}/hubspot-emu/crm/v3/objects/companies/batch/create`,
    jsonReq(hsToken, { inputs: [{ properties: { name: "Globex" } }, { properties: { name: "Initech" } }] }),
  );

  // ── Salesforce ──────────────────────────────────────────────────────────
  heading("Salesforce — OAuth 2.0 username-password grant");

  const sfTok = (await call(
    emu,
    "Request a session (grant_type=password)",
    `${BASE}/salesforce-emu/services/oauth2/token`,
    form({
      grant_type: "password",
      client_id: "cid",
      client_secret: "secret",
      username: "admin@agent-emulate.dev",
      password: "pw",
    }),
  )) as { access_token: string; instance_url: string };
  const sfToken = sfTok.access_token;
  const V = "v60.0";

  heading("Salesforce — sObject CRUD, SOQL, describe, composite");

  const acct = (await call(
    emu,
    "Create an Account",
    `${BASE}/salesforce-emu/services/data/${V}/sobjects/Account`,
    jsonReq(sfToken, { Name: "Acme Corp", Industry: "Technology", Website: "agent-emulate.dev" }),
  )) as { id: string };

  await call(
    emu,
    "Read the Account back (attributes envelope)",
    `${BASE}/salesforce-emu/services/data/${V}/sobjects/Account/${acct.id}`,
    get(sfToken),
  );

  await call(
    emu,
    "Update the Account (PATCH → 204)",
    `${BASE}/salesforce-emu/services/data/${V}/sobjects/Account/${acct.id}`,
    jsonReq(sfToken, { Industry: "Software" }, "PATCH"),
  );

  await call(
    emu,
    "Create a related Contact",
    `${BASE}/salesforce-emu/services/data/${V}/sobjects/Contact`,
    jsonReq(sfToken, { LastName: "Lovelace", FirstName: "Ada", AccountId: acct.id, Email: "ada@agent-emulate.dev" }),
  );

  await call(
    emu,
    "Composite collection-create two more Accounts",
    `${BASE}/salesforce-emu/services/data/${V}/composite/sobjects`,
    jsonReq(sfToken, {
      allOrNone: false,
      records: [
        { attributes: { type: "Account" }, Name: "Globex", Industry: "Software" },
        { attributes: { type: "Account" }, Name: "Umbrella", Industry: "Pharma" },
      ],
    }),
  );

  const soql = encodeURIComponent("SELECT Id, Name, Industry FROM Account WHERE Industry = 'Software'");
  await call(
    emu,
    "SOQL — Accounts in the Software industry",
    `${BASE}/salesforce-emu/services/data/${V}/query?q=${soql}`,
    get(sfToken),
  );

  await call(
    emu,
    "Describe the Account sObject",
    `${BASE}/salesforce-emu/services/data/${V}/sobjects/Account/describe`,
    get(sfToken),
  );

  console.log("\n✅ CRM demo complete — HubSpot + Salesforce exercised end-to-end.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
