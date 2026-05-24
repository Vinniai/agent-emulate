// Simpro Premium emulator — a full narrated walkthrough.
//
// Simpro is a field-service job-management platform. Its API is multi-company
// (`/api/v1.0/companies/:cid/…`) with deeply nested job structures
// (job → section → cost center) and an OAuth 2.0 layer with refreshable
// tokens. This demo exercises that whole surface end to end:
//
//   1. OAuth 2.0 authorization-code flow + single-use refresh-token rotation.
//   2. Reference data (tax codes, statuses, master cost centers).
//   3. Customers (company + individual) with nested sites; staff; contractors.
//   4. Jobs → sections → cost centers, including the deep nested route
//      /api/v1.0/companies/:cid/jobs/:jid/sections/:sid/costCenters/:ccid.
//   5. Quotes, invoices, a payment POST, schedules, assets.
//   6. A webhook subscription proving the signing Secret is returned exactly
//      once (on create, never on list).
//   7. The inspector HTML pages.
//   8. A round-trip: mutate live state → storeToSeedConfig → re-seed a fresh
//      store from that export → assert the mutation survived verbatim.
//
//   pnpm --filter api-emulators-quickstart simpro
import { simproPlugin, seedFromConfig, storeToSeedConfig } from "@emulators/simpro";
import { call, heading, mount } from "./harness.js";

const BASE = "http://localhost:4010";
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function main(): Promise<void> {
  const emu = mount(simproPlugin, BASE);

  // A rich seed: reference data + two customer kinds with sites, staff,
  // contractors, a job with a section that already holds one cost center,
  // a quote, an invoice, a schedule and an asset.
  seedFromConfig(emu.store, BASE, {
    oauth: { client_id: "taskr_dev", client_secret: "taskr_dev_secret" },
    companies: [{ id: 0, name: "Taskr Test Co" }],
    tax_codes: [{ id: 1, name: "GST", rate: 10 }],
    statuses: [
      { id: 10, kind: "job", name: "In Progress" },
      { id: 20, kind: "quote", name: "Quoted" },
    ],
    master_cost_centers: [{ id: 500, name: "Service", income_account: "4000", expense_account: "5000" }],
    staff: [{ id: 7, given_name: "Dana", family_name: "Tech", email: "dana@agent-emulate.dev" }],
    contractors: [{ id: 90, company_name: "Subbie Co", given_name: "Sam", family_name: "Sub" }],
    customers: [
      {
        id: 200,
        type: "company",
        company_name: "Acme Facilities Pty Ltd",
        email: "ops@agent-emulate.dev",
        sites: [{ id: 55, name: "North Campus Building A" }],
      },
      { id: 201, type: "individual", given_name: "Pat", family_name: "Owner", email: "pat@agent-emulate.dev" },
    ],
    jobs: [
      {
        id: 12345,
        type: "Project",
        name: "Sprinkler Overhaul Q3",
        customer_id: 200,
        site_id: 55,
        stage: 3,
        order_no: "PO-4481",
        sections: [
          {
            id: 1,
            name: "Mechanical",
            cost_centers: [{ id: 800, master_cost_center_id: 500, tax_code_id: 1, name: "Pipework", ex_tax: 4000 }],
          },
        ],
      },
    ],
    quotes: [{ id: 9001, name: "Annual Service Quote", customer_id: 201, status_id: 20, total_ex_tax: 1200 }],
    invoices: [{ id: 7001, job_id: 12345, type: "ProgressInvoice", total_ex_tax: 4000, total_inc_tax: 4400 }],
    schedules: [
      { id: 301, job_id: 12345, technician_id: 7, date: "2026-06-01", start_time: "09:00", duration_minutes: 240 },
    ],
    assets: [{ id: 410, customer_id: 200, site_id: 55, name: "Pump A1", asset_type: "Pump", serial_number: "SN-001" }],
  });

  heading("Simpro — OAuth 2.0 authorization-code flow + refresh");

  const authorize = await emu.app.request(
    `${BASE}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  const code = new URL(authorize.headers.get("Location")!).searchParams.get("code")!;
  console.log(`\n▶ GET /oauth/authorize  →  302  (code=${code.slice(0, 12)}…)`);

  const token = (await call(
    emu,
    "Exchange the code for an access + refresh token",
    `${BASE}/oauth/token`,
    json({
      grant_type: "authorization_code",
      code,
      client_id: "taskr_dev",
    }),
  )) as { access_token: string; refresh_token: string };

  // Refresh tokens are single-use: this rotates the pair and revokes the old.
  const refreshed = (await call(
    emu,
    "Rotate the refresh token (single-use)",
    `${BASE}/oauth/token`,
    json({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: "taskr_dev",
    }),
  )) as { access_token: string };

  const auth = { Authorization: `Bearer ${refreshed.access_token}`, "Content-Type": "application/json" };

  heading("Simpro — reference data");

  await call(emu, "Tax codes", `${BASE}/api/v1.0/companies/0/setup/taxCodes/`, { headers: auth });
  await call(emu, "Job/quote statuses", `${BASE}/api/v1.0/companies/0/setup/statuses/`, { headers: auth });
  await call(emu, "Master (setup) cost centers", `${BASE}/api/v1.0/companies/0/setup/costCenters/`, { headers: auth });

  heading("Simpro — customers, sites, staff, contractors");

  await call(emu, "List companies (the multi-company root)", `${BASE}/api/v1.0/companies/`, { headers: auth });
  await call(emu, "List customers (company + individual)", `${BASE}/api/v1.0/companies/0/customers/`, {
    headers: auth,
  });
  await call(emu, "Sites (the customer's North Campus site)", `${BASE}/api/v1.0/companies/0/sites/`, {
    headers: auth,
  });
  await call(emu, "Staff", `${BASE}/api/v1.0/companies/0/staff/`, { headers: auth });
  await call(emu, "Contractors", `${BASE}/api/v1.0/companies/0/contractors/`, { headers: auth });

  heading("Simpro — jobs → sections → cost centers (deep nested route)");

  await call(emu, "Fetch the job (Stage resolves to its label)", `${BASE}/api/v1.0/companies/0/jobs/12345`, {
    headers: auth,
  });
  await call(emu, "Sections of the job", `${BASE}/api/v1.0/companies/0/jobs/12345/sections/`, { headers: auth });
  await call(emu, "Cost centers under section 1", `${BASE}/api/v1.0/companies/0/jobs/12345/sections/1/costCenters/`, {
    headers: auth,
  });
  await call(
    emu,
    "The seeded cost center by id (deepest route)",
    `${BASE}/api/v1.0/companies/0/jobs/12345/sections/1/costCenters/800`,
    { headers: auth },
  );

  heading("Simpro — quotes, invoices, payments, schedules, assets");

  await call(emu, "Quotes", `${BASE}/api/v1.0/companies/0/quotes/`, { headers: auth });
  await call(emu, "Invoices", `${BASE}/api/v1.0/companies/0/invoices/`, { headers: auth });
  await call(emu, "Record a customer payment against the invoice", `${BASE}/api/v1.0/companies/0/customerPayments/`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ Payment: { Amount: 4400, PaymentMethod: "EFT" }, Invoices: [{ ID: 7001 }] }),
  });
  await call(emu, "Schedules", `${BASE}/api/v1.0/companies/0/schedules/`, { headers: auth });
  await call(emu, "Customer assets", `${BASE}/api/v1.0/companies/0/assets/`, { headers: auth });

  heading("Simpro — webhook subscription (Secret returned exactly once)");

  const sub = (await call(emu, "Register a webhook", `${BASE}/api/v1.0/companies/0/setup/webhooks/`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ URL: "https://agent-emulate.dev/hook", Events: ["job.created", "job.updated"] }),
  })) as { ID: number; Secret?: string };
  console.log(`    ↳ create returned Secret? ${Boolean(sub.Secret)}`);

  const list = (await call(emu, "List webhooks (Secret now omitted)", `${BASE}/api/v1.0/companies/0/setup/webhooks/`, {
    headers: auth,
  })) as Array<{ Secret?: string }>;
  console.log(`    ↳ list entries expose Secret? ${list.some((w) => Boolean(w.Secret))}`);

  heading("Simpro — inspector pages (HTML)");

  for (const page of ["jobs", "customers", "sections", "cost-centers", "invoices", "webhooks"]) {
    const res = await emu.app.request(`${BASE}/inspector/${page}`);
    console.log(`▶ GET /inspector/${page}  →  ${res.status} (${res.headers.get("content-type")})`);
  }

  heading("Simpro — round-trip: mutate → export → re-seed → verify");

  // Mutate live state: add a brand-new cost center through the deep route.
  const created = (await call(
    emu,
    "Create a NEW cost center under section 1",
    `${BASE}/api/v1.0/companies/0/jobs/12345/sections/1/costCenters/`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        Name: "Variation — Extra Valves",
        CostCenter: { ID: 500 },
        TaxCode: { ID: 1 },
        ExTax: 950,
      }),
    },
  )) as { ID: number };

  // Project the mutated store back into a seed config.
  const exported = storeToSeedConfig(emu.store, BASE);
  const exportedCcs = exported.jobs?.[0]?.sections?.[0]?.cost_centers ?? [];
  console.log(`\n▶ storeToSeedConfig → job 12345 / section 1 now has ${exportedCcs.length} cost centers`);

  // Re-seed a FRESH emulator from the export and confirm the new cost center
  // round-tripped verbatim through the deepest route. Simpro validates bearer
  // tokens against its own store, so the fresh emulator gets its own token.
  const fresh = mount(simproPlugin, BASE);
  seedFromConfig(fresh.store, BASE, exported);
  const fauthz = await fresh.app.request(
    `${BASE}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  const fcode = new URL(fauthz.headers.get("Location")!).searchParams.get("code")!;
  const ftoken = (await (
    await fresh.app.request(
      `${BASE}/oauth/token`,
      json({ grant_type: "authorization_code", code: fcode, client_id: "taskr_dev" }),
    )
  ).json()) as { access_token: string };
  const roundTrip = await fresh.app.request(
    `${BASE}/api/v1.0/companies/0/jobs/12345/sections/1/costCenters/${created.ID}`,
    { headers: { Authorization: `Bearer ${ftoken.access_token}` } },
  );
  const rtBody = (await roundTrip.json()) as { Name: string };
  const ok = roundTrip.status === 200 && rtBody.Name === "Variation — Extra Valves";
  console.log(`▶ Fresh store seeded from export → GET cost center ${created.ID}  →  ${roundTrip.status}`);
  console.log(`    round-trip preserved "${rtBody.Name}" — ${ok ? "✅ verified" : "❌ MISMATCH"}`);
  if (!ok) process.exit(1);

  console.log("\n✅ Simpro demo complete.\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
