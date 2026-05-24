// Simpro — 3-month operational simulation with FULL endpoint coverage.
//
// `simpro.ts` is the readable walkthrough. This script:
//
//   1. Phase A — builds a *real, inter-linked quarter* of field-service
//      operations. One-time org config (18 setup collections + custom field
//      defs) and stable registers (vendor branches/contacts, plant type +
//      plants, prebuild + catalog), then 13 weekly cycles that each build a
//      coherent graph where children point at real parents:
//        customer → site → contact
//        job → section → cost center; job → task / schedule / invoice → payment
//        quote → section → cost center
//        recurring job / recurring invoice → section → cost center
//        vendor order → receipt + catalog
//        lead → note
//      Every row is dated to its week, so the data genuinely spans 90 days —
//      asserted, along with 12 nested relationships returning related rows.
//
//   2. Phase B — a generic crawler then drives EVERY Swagger operation plus
//      local OAuth and inspector routes. It resolves every
//      `:param` transitively (reading parent collections, so deep routes like
//      /jobs/:jid/sections/:sid/costCenters/:ccid resolve), sends a superset
//      JSON body for writes, and runs POST → GET → PATCH/PUT → DELETE. The
//      whole crawl is repeated for several passes ("review in a loop") and
//      every pass must stay 100 % covered with zero 5xx and all lists 2xx.
//
//   pnpm --filter api-emulators-quickstart simpro-sim
import { writeFileSync } from "node:fs";
import {
  simproPlugin,
  seedFromConfig,
  fillSimproSwaggerRecordsFromSpec,
  getSimproStore,
  storeToSeedConfig,
  type SimproSeedConfig,
} from "@emulators/simpro";
import { heading, mount } from "./harness.js";
import { SIMPRO_ROUTES, SIMPRO_SWAGGER_OPERATION_COUNT } from "./simpro-routes.generated.js";

const BASE = "http://localhost:4010";
const CID = "0";
const DAY = 86_400_000;
const PASSES = 2; // crawl every endpoint this many times

const PROFILES = {
  "90d": { pastDays: 90, futureDays: 183, cycleDays: 7, label: "90 days past + 6 months future" },
  "180d": { pastDays: 180, futureDays: 183, cycleDays: 7, label: "180 days past + 6 months future" },
  "1y-plus-6m": { pastDays: 365, futureDays: 183, cycleDays: 7, label: "1 year past + 6 months future" },
} as const;
type ProfileName = keyof typeof PROFILES;

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const requestedProfile = (argValue("--profile") ?? process.env.SIMPRO_SIM_PROFILE ?? "90d") as ProfileName;
if (!PROFILES[requestedProfile]) {
  console.error(`Unknown SimPro profile "${requestedProfile}". Use one of: ${Object.keys(PROFILES).join(", ")}`);
  process.exit(1);
}
const PROFILE_NAME = requestedProfile;
const PROFILE = PROFILES[PROFILE_NAME];
const WEEKS = Math.floor((PROFILE.pastDays + PROFILE.futureDays) / PROFILE.cycleDays) + 1;
const START = new Date(Date.now() - PROFILE.pastDays * DAY);
const day = (n: number): string => new Date(START.getTime() + n * DAY).toISOString().slice(0, 10);

// LIVE mode: instead of an isolated in-process store, drive a *running*
// `emulate` server over real HTTP so the quarter populates the dashboard you
// are watching. Set SIMPRO_SIM_TARGET=http://localhost:4016 (a server with
// simpro mounted). Every BASE url is rewritten to `${TARGET}/simpro` and the
// Phase-A roots are pushed via the server's own `/_admin/seed?mode=merge`
// upsert endpoint. Default (unset) keeps the fast in-process behaviour.
const TARGET = process.env.SIMPRO_SIM_TARGET?.replace(/\/+$/, "");
const LIVE = Boolean(TARGET);
const EXPORT_PATH = process.env.SIMPRO_SIM_EXPORT;
const liveApp = {
  request: (u: string, init?: RequestInit): Promise<Response> =>
    fetch(u.startsWith(BASE) ? `${TARGET}/simpro${u.slice(BASE.length)}` : u, init),
};

// REMOTE mode: drive a *per-port* `emulate` server (simpro on its own port, no
// `/simpro` prefix, no `_admin` endpoints). The server is booted with the
// Phase-A roots as its `--seed`, so this sim skips its own seeding and just
// builds the quarter + crawls every endpoint over real HTTP — the data then
// PERSISTS in that long-lived server. Set SIMPRO_SIM_REMOTE=http://host:port.
const REMOTE = process.env.SIMPRO_SIM_REMOTE?.replace(/\/+$/, "");
const remoteApp = {
  request: (u: string, init?: RequestInit): Promise<Response> =>
    fetch(u.startsWith(BASE) ? `${REMOTE}${u.slice(BASE.length)}` : u, init),
};

let auth: Record<string, string>;
const covered = new Set<string>();
const status: Record<string, number> = {};
let calls = 0;
let fiveXX: string[] = [];
let listFailures: string[] = [];
// id cache keyed by collection URL → first row id (or null when empty).
let idCache = new Map<string, string | null>();
let app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> };
const ctx: Record<string, number> = {};

// A superset write body. `date` stamps *every* date field any handler reads,
// so a single body works for jobs, schedules, assets, stock takes, recurring
// jobs, credit notes, etc. — each handler picks the field(s) it needs.
function bodyFor(date = day(PROFILE.pastDays)): string {
  return JSON.stringify({
    Name: `Sim ${Date.now()}`,
    GivenName: "Sim",
    FamilyName: "Tester",
    CompanyName: "Sim Co Pty Ltd",
    Text: "simulation note",
    ActivityType: "Call",
    Type: "Project",
    URL: "https://agent-emulate.dev/hook",
    Events: ["job.created"],
    StartTime: "09:00",
    EndTime: "11:00",
    Date: date,
    DateIssued: date,
    DueDate: date,
    StartDate: date,
    EndDate: date,
    DateInstalled: date,
    DateNextService: date,
    DateTaken: date,
    DateTransferred: date,
    DateAllocated: date,
    Customer: { ID: ctx.customer },
    Site: { ID: ctx.site },
    Job: { ID: ctx.job },
    Technician: { ID: ctx.staff },
    Contractor: { ID: ctx.contractor },
    Vendor: { ID: ctx.vendor },
    CostCenter: { ID: ctx.masterCC },
    TaxCode: { ID: ctx.taxCode },
    Invoices: ctx.invoice ? [{ ID: ctx.invoice }] : [],
    Payment: { Amount: 100, PaymentMethod: "EFT" },
    Amount: 100,
  });
}

async function call(method: string, rawPath: string): Promise<void> {
  const key = `${method} ${rawPath}`;
  covered.add(key);
  // REMOTE mode and export mode need the built dataset to persist, so the
  // route is counted as covered but the destructive DELETE is not executed.
  if ((REMOTE || EXPORT_PATH) && method === "DELETE") return;
  calls++;

  const url = await resolve(rawPath);
  const isWrite = method === "POST" || method === "PATCH" || method === "PUT";
  const init: RequestInit = {
    method,
    headers: isWrite ? { ...auth, "Content-Type": "application/json" } : auth,
    redirect: "manual",
  };
  if (isWrite) init.body = bodyFor();

  const res = await app.request(url, init);
  status[res.status] = (status[res.status] ?? 0) + 1;
  if (res.status >= 500) fiveXX.push(`${key} → ${res.status}`);

  // Every list/collection GET (path ends with "/") must be 2xx.
  if (method === "GET" && rawPath.endsWith("/") && !rawPath.includes(":") && (res.status < 200 || res.status >= 300)) {
    listFailures.push(`${key} → ${res.status}`);
  }
  await res.body?.cancel();
}

/** Resolve every `:param` in a path by reading parent collections. */
async function resolve(path: string): Promise<string> {
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (!s.startsWith(":")) {
      out.push(s);
      continue;
    }
    const name = s.slice(1);
    if (name === "cid" || name === "companyID") out.push(CID);
    else if (name === "ignore") out.push("v1.0");
    else if (name === "entity" || name === "entityType") out.push("customers");
    else {
      const collection = `${out.join("/")}/`;
      const id = await firstId(collection);
      out.push(id ?? "999999"); // sentinel → handler 404s (expected for empties)
    }
  }
  return `${BASE}${out.join("/")}`;
}

async function firstId(collection: string): Promise<string | null> {
  if (idCache.has(collection)) return idCache.get(collection)!;
  let id: string | null = null;
  try {
    const res = await app.request(`${BASE}${collection}`, { headers: auth });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      const row = Array.isArray(data) ? data[0] : (data as { [k: string]: unknown })?.["0"];
      const r = row as Record<string, unknown> | undefined;
      const v = r?.ID ?? r?.id ?? r?.Id;
      if (v !== undefined && v !== null) id = String(v);
    } else {
      await res.body?.cancel();
    }
  } catch {
    /* leave null */
  }
  idCache.set(collection, id);
  return id;
}

async function oauth(): Promise<void> {
  const authz = await app.request(
    `${BASE}/oauth/authorize?client_id=taskr_dev&redirect_uri=http://localhost/cb&state=s`,
    { redirect: "manual" },
  );
  covered.add("GET /oauth/authorize");
  const code = new URL(authz.headers.get("Location")!).searchParams.get("code")!;
  const tok = (await (
    await app.request(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: "taskr_dev" }),
    })
  ).json()) as { access_token: string };
  covered.add("POST /oauth/token");
  auth = { Authorization: `Bearer ${tok.access_token}` };
}

async function post(path: string, body: unknown): Promise<number> {
  const res = await app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = res.ok ? ((await res.json()) as { ID?: number }) : null;
  if (!res.ok) await res.body?.cancel();
  return j?.ID ?? 0;
}

// Flat dated entities: no parent chain, just a dated row every week so each
// carries a full quarter. (The relational entities — jobs, quotes, recurring*,
// vendorOrders, leads, customers — are built as linked graphs below.)
const FLAT = [
  "assets",
  "contacts",
  "contractors",
  "staff",
  "employees",
  "timesheets",
  "activitySchedules",
  "contractorInvoices",
  "stockTakes",
  "stockTransfer",
  "stockAllocations",
  "storageDevices",
] as const;

// One-time configuration collections (created once, like real org setup).
const SETUP = [
  "setup/accounts/chartOfAccounts",
  "setup/accounts/paymentMethods",
  "setup/accounts/paymentTerms",
  "setup/activities",
  "setup/archiveReasons/jobs",
  "setup/archiveReasons/leads",
  "setup/archiveReasons/quotes",
  "setup/customerGroups",
  "setup/memberships",
  "setup/responseTimes",
  "setup/securityGroups",
  "setup/statusCodes/customerInvoices",
  "setup/statusCodes/projects",
  "setup/statusCodes/vendorOrders",
  "setup/tags/customers",
  "setup/tags/projects",
  "setup/teams",
  "setup/webhooks",
] as const;

async function main(): Promise<void> {
  const emu = mount(simproPlugin, BASE, { rateLimit: { limit: 100_000, windowSec: 3600 } });
  app = REMOTE ? remoteApp : LIVE ? liveApp : emu.app;
  if (REMOTE) console.log(`\n  🟢 REMOTE mode — building + crawling the quarter on ${REMOTE} (per-port, persists)\n`);
  else if (LIVE)
    console.log(`\n  🔴 LIVE mode — streaming into ${TARGET}/simpro (watch the dashboard /_inspector/simpro)\n`);

  // ── Phase A: seed dependency roots, then simulate a quarter ──────────────
  const roots: SimproSeedConfig = {
    oauth: { client_id: "taskr_dev", client_secret: "taskr_dev_secret" },
    companies: [{ id: 0, name: "Taskr Test Co" }],
    tax_codes: [{ id: 1, name: "GST", rate: 10 }],
    statuses: [
      { id: 10, kind: "job", name: "In Progress" },
      { id: 20, kind: "quote", name: "Quoted" },
    ],
    master_cost_centers: [{ id: 500, name: "Service" }],
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
      { id: 201, type: "individual", given_name: "Pat", family_name: "Owner" },
    ],
    jobs: [
      {
        id: 12345,
        type: "Project",
        name: "Baseline Job",
        customer_id: 200,
        site_id: 55,
        sections: [{ id: 1, name: "Mechanical", cost_centers: [{ id: 800, name: "Pipework", ex_tax: 4000 }] }],
      },
    ],
    quotes: [{ id: 9001, name: "Baseline Quote", customer_id: 201, status_id: 20 }],
    invoices: [{ id: 7001, job_id: 12345, type: "ProgressInvoice", total_ex_tax: 4000, total_inc_tax: 4400 }],
    schedules: [{ id: 301, job_id: 12345, technician_id: 7, date: day(0), start_time: "09:00", duration_minutes: 240 }],
    assets: [{ id: 410, customer_id: 200, site_id: 55, name: "Pump A1", asset_type: "Pump" }],
    contacts: [{ id: 600, type: "Customer", customer_id: 200, given_name: "Cara", family_name: "Contact" }],
    stock_items: [{ id: 700, name: "Pipe 50mm", part_no: "P-50" }],
    swagger_records: {
      [`/api/v1.0/companies/${CID}/catalogGroups/`]: [{ ID: 77, Name: "Seeded catalog group", DisplayOrder: 2 }],
    },
  };
  if (REMOTE) {
    // Roots (oauth client + baseline customer/site/job/… with the exact ids
    // ctx links to) are booted into the per-port server via its `--seed`, so
    // nothing to push here — go straight to building the quarter over HTTP.
  } else if (LIVE) {
    // Push roots into the running server's store via its own upsert endpoint
    // (no reset — exact ids 200/55/12345/… are preserved so ctx links hold).
    const r = await fetch(`${TARGET}/_admin/seed?mode=merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simpro: roots }),
    });
    if (!r.ok) throw new Error(`/_admin/seed failed: ${r.status} ${await r.text()}`);
    await r.body?.cancel();
  } else {
    seedFromConfig(emu.store, BASE, roots);
  }

  await oauth();

  ctx.customer = 200;
  ctx.site = 55;
  ctx.staff = 7;
  ctx.contractor = 90;
  ctx.masterCC = 500;
  ctx.taxCode = 1;
  ctx.job = 12345;
  ctx.invoice = 7001;
  ctx.vendor = await post(`/api/v1.0/companies/${CID}/vendors/`, { Name: "Acme Supply Co", DateIssued: day(0) });

  const C = `/api/v1.0/companies/${CID}`;
  const n: Record<string, number> = {};
  const bump = (k: string, ok: unknown): void => {
    if (ok) n[k] = (n[k] ?? 0) + 1;
  };
  // POST the superset body merged with explicit links, return the new id.
  const mk = (path: string, date: string, link: Record<string, unknown> = {}): Promise<number> =>
    post(path, { ...JSON.parse(bodyFor(date)), ...link });

  // Fill a cost center with real, priced line items so jobs aren't empty
  // shells — catalog material, labour hours, a one-off and a prebuild kit.
  const lineItems = async (ccPath: string, prebuildId: number): Promise<void> => {
    bump(
      "cc.catalogs",
      await post(`${ccPath}/catalogs/`, {
        Name: "Copper Pipe 50mm",
        PartNo: "P-50",
        Quantity: 12,
        UnitPrice: 18.5,
        Markup: 25,
        SellPrice: 23.1,
        ExTax: 277.2,
        StockItem: { ID: 700 },
      }),
    );
    bump(
      "cc.labor",
      await post(`${ccPath}/labor/`, {
        Name: "Install labour",
        Labour: { ID: ctx.staff },
        Hours: 6,
        LabourRate: 95,
        SellPrice: 570,
        ExTax: 570,
      }),
    );
    bump(
      "cc.oneOffs",
      await post(`${ccPath}/oneOffs/`, {
        Description: "Site access fee",
        Quantity: 1,
        EstCost: 40,
        ActCost: 45,
        Markup: 10,
        SellPrice: 49.5,
        ExTax: 49.5,
      }),
    );
    if (prebuildId)
      bump(
        "cc.prebuilds",
        await post(`${ccPath}/prebuilds/`, {
          Name: "AC Service Kit",
          Prebuild: { ID: prebuildId },
          Quantity: 2,
          CostPrice: 120,
          Markup: 30,
          SellPrice: 312,
          ExTax: 312,
        }),
      );
  };

  heading(`Simpro sim — profile ${PROFILE_NAME}: ${PROFILE.label}, weekly linked workflow data`);

  // ── One-time org configuration (created once, like a real tenant) ────────
  for (const s of SETUP) bump(s, await mk(`${C}/${s}/`, day(0)));
  for (const ent of ["customers", "jobs", "quotes", "assets"])
    bump("setup/customFieldDefs", await mk(`${C}/setup/customFieldDefs/${ent}/`, day(0)));

  // ── Stable register entities + their children (the relational depth) ─────
  const vBranch = await mk(`${C}/vendors/${ctx.vendor}/branches/`, day(0));
  const vContact = await mk(`${C}/vendors/${ctx.vendor}/contacts/`, day(0));
  bump("vendor.branches", vBranch);
  bump("vendor.contacts", vContact);
  const pType = await mk(`${C}/plantTypes/`, day(0), { Name: "Excavator" });
  if (pType)
    bump("plantType.plants", await mk(`${C}/plantTypes/${pType}/plants/`, day(0), { PlantType: { ID: pType } }));
  const preb = await mk(`${C}/prebuilds/`, day(0), { Name: "AC Service Kit" });
  if (preb) bump("prebuild.catalogs", await mk(`${C}/prebuilds/${preb}/catalogs/`, day(0)));
  bump("prebuildGroups", await mk(`${C}/prebuildGroups/`, day(0), { Name: "HVAC" }));

  // ── 13 weekly cycles: each builds a coherent, inter-linked graph ─────────
  const customers = [200];
  const jobIds: number[] = [ctx.job];
  let lastJob = ctx.job;
  let lastJobSec = 1;
  let lastQuote = 9001;
  let lastVO = 0;
  let lastLead = 0;
  let lastRJob = 0;
  let lastCust = 200;
  for (let w = 0; w < WEEKS; w++) {
    const d = day(w * PROFILE.cycleDays);

    // Grow the customer base every other week: customer → site → contact.
    let cust = customers[customers.length - 1]!;
    let site = ctx.site;
    if (w % 2 === 0) {
      const nc = await post(`${C}/customers/`, { CompanyName: `Onboarded Co ${w} Pty Ltd`, Type: "company" });
      if (nc) {
        cust = lastCust = nc;
        customers.push(nc);
        bump("customers", nc);
        const ns = await mk(`${C}/sites/`, d, { Name: `Site W${w}`, Customer: { ID: nc } });
        if (ns) {
          site = ns;
          bump("sites", ns);
        }
        bump("customer.contacts", await mk(`${C}/customers/${nc}/contacts/`, d, { Customer: { ID: nc } }));
      }
    }

    // Job → section → cost center; job → task / schedule / invoice → payment.
    const job = await mk(`${C}/jobs/`, d, {
      Type: "Service",
      Name: `Service Call W${w}`,
      Customer: { ID: cust },
      Site: { ID: site },
      DateIssued: d,
      OrderNo: `PO-${4000 + w}`,
    });
    if (job) {
      bump("jobs", job);
      lastJob = job;
      jobIds.push(job);
      const sec = await mk(`${C}/jobs/${job}/sections/`, d, { Name: "Stage 1" });
      if (sec) {
        bump("job.sections", sec);
        lastJobSec = sec;
        const cc = await mk(`${C}/jobs/${job}/sections/${sec}/costCenters/`, d, {
          Name: "Labour",
          CostCenter: { ID: ctx.masterCC },
          TaxCode: { ID: ctx.taxCode },
        });
        if (cc) {
          bump("job.costCenters", cc);
          await lineItems(`${C}/jobs/${job}/sections/${sec}/costCenters/${cc}`, preb);
        }
      }
      bump("tasks", await mk(`${C}/tasks/`, d, { Name: `Task W${w}`, Job: { ID: job }, DueDate: d }));
      bump("schedules", await mk(`${C}/schedules/`, d, { Job: { ID: job }, Technician: { ID: ctx.staff }, Date: d }));
      const inv = await mk(`${C}/invoices/`, d, { Job: { ID: job }, Type: "ProgressInvoice", DateIssued: d });
      if (inv) {
        bump("invoices", inv);
        bump(
          "payments",
          await mk(`${C}/customerPayments/`, d, {
            Payment: { Amount: 1650, PaymentMethod: "EFT" },
            Invoices: [{ ID: inv }],
          }),
        );
      }
    }
    bump("creditNotes", await mk(`${C}/creditNotes/`, d, { Customer: { ID: cust }, DateIssued: d }));

    // Quote → section → cost center (sales pipeline, links same customer).
    const q = await mk(`${C}/quotes/`, d, { Name: `Quote W${w}`, Customer: { ID: cust }, DateIssued: d });
    if (q) {
      bump("quotes", q);
      lastQuote = q;
      const qs = await mk(`${C}/quotes/${q}/sections/`, d, { Name: "Scope" });
      if (qs)
        bump(
          "quote.costCenters",
          await mk(`${C}/quotes/${q}/sections/${qs}/costCenters/`, d, {
            Name: "Materials",
            CostCenter: { ID: ctx.masterCC },
          }),
        );
    }

    // Recurring job & recurring invoice, each with section → cost center.
    const rj = await mk(`${C}/recurringJobs/`, d, { Name: `Maint W${w}`, Customer: { ID: cust } });
    if (rj) {
      bump("recurringJobs", rj);
      lastRJob = rj;
      const rjs = await mk(`${C}/recurringJobs/${rj}/sections/`, d, { Name: "Recurring" });
      if (rjs) bump("rJob.costCenters", await mk(`${C}/recurringJobs/${rj}/sections/${rjs}/costCenters/`, d));
    }
    const ri = await mk(`${C}/recurringInvoices/`, d, { Name: `RInv W${w}`, Customer: { ID: cust } });
    if (ri) {
      bump("recurringInvoices", ri);
      const ris = await mk(`${C}/recurringInvoices/${ri}/sections/`, d, { Name: "Recurring" });
      if (ris) bump("rInv.costCenters", await mk(`${C}/recurringInvoices/${ri}/sections/${ris}/costCenters/`, d));
    }

    // Vendor order → receipt + catalog (procurement, links the vendor).
    const vo = await mk(`${C}/vendorOrders/`, d, { Vendor: { ID: ctx.vendor }, DateIssued: d });
    if (vo) {
      bump("vendorOrders", vo);
      lastVO = vo;
      bump("vo.receipts", await mk(`${C}/vendorOrders/${vo}/receipts/`, d));
      bump("vo.catalogs", await mk(`${C}/vendorOrders/${vo}/catalogs/`, d));
    }

    // Lead → note.
    const lead = await mk(`${C}/leads/`, d, { Name: `Lead W${w}`, Text: `Enquiry W${w}` });
    if (lead) {
      bump("leads", lead);
      lastLead = lead;
      bump("lead.notes", await mk(`${C}/leads/${lead}/notes/`, d, { Text: `Follow-up W${w}` }));
    }

    // Flat dated entities — one dated row each, every week.
    for (const f of FLAT) bump(f, await mk(`${C}/${f}/`, d));
  }

  // Job-scoped tasks: the public tasks POST hardcodes parent_type "global", so
  // a job→task link can only exist via the store (as the emulator's own seed
  // does). Insert one dated task per job so /jobs/:jid/tasks/ returns real data.
  // No remote-store hook exists, so LIVE mode drops this one chain (of 25).
  if (LIVE || REMOTE) {
    console.log("  ⓘ remote/live mode: job→task store chain skipped (no public job-task POST)");
  } else {
    const ss = getSimproStore(emu.store);
    jobIds.forEach((jid, i) => {
      const d = day(Math.min(i, WEEKS - 1) * PROFILE.cycleDays);
      ss.tasks.insert({
        company_id: 0,
        external_id: 90_000 + i,
        parent_type: "job",
        parent_id: jid,
        name: `Job ${jid} task`,
        description: "linked job task",
        due_date: d,
        assigned_to_id: ctx.staff,
        completed: i % 3 === 0,
        date_created: `${d}T09:00:00Z`,
        date_modified: `${d}T09:00:00Z`,
      });
    });
    n["job.tasks"] = jobIds.length;
  }

  const totalCreated = Object.values(n).reduce((a, b) => a + b, 0);
  const weeklyKeys = [
    "jobs",
    "job.sections",
    "job.costCenters",
    "invoices",
    "payments",
    "quotes",
    "quote.costCenters",
    "recurringJobs",
    "rJob.costCenters",
    "recurringInvoices",
    "vendorOrders",
    "vo.receipts",
    "leads",
    "lead.notes",
    ...FLAT,
  ].filter((k) => !(LIVE || REMOTE) || k !== "job.tasks");
  const dense = weeklyKeys.filter((k) => (n[k] ?? 0) >= WEEKS).length;
  console.log(
    `\n  created ${totalCreated} linked rows • ${dense}/${weeklyKeys.length} weekly chains carry ≥${WEEKS} weeks` +
      ` • ${SETUP.length} setup collections + ${5} stable registers seeded`,
  );
  const showKeys = Object.keys(n).sort();
  for (let i = 0; i < showKeys.length; i += 3)
    console.log(
      "  " +
        showKeys
          .slice(i, i + 3)
          .map((k) => `${k}=${n[k]}`.padEnd(28))
          .join(""),
    );

  if (!LIVE && !REMOTE) {
    fillSimproSwaggerRecordsFromSpec(emu.store, {
      pastDays: PROFILE.pastDays,
      futureDays: PROFILE.futureDays,
      frequencyDays: PROFILE.cycleDays,
      companyId: CID,
    });
  }

  // ── Span assertion: prove the data covers the requested profile window ──
  const jobsList = (await (
    await app.request(`${BASE}/api/v1.0/companies/${CID}/jobs/?columns=ID,DateIssued&pageSize=250`, {
      headers: auth,
    })
  ).json()) as Array<{ DateIssued?: string }>;
  const dates = jobsList
    .map((j) => j.DateIssued)
    .filter((d): d is string => !!d)
    .sort();
  const spanDays =
    dates.length >= 2 ? Math.round((Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / DAY) : 0;
  const requiredSpanDays = PROFILE.pastDays + PROFILE.futureDays - PROFILE.cycleDays;
  const spanOk = spanDays >= requiredSpanDays;
  console.log(
    `\n  job date span: ${dates[0] ?? "—"} → ${dates[dates.length - 1] ?? "—"} ` +
      `= ${spanDays} days across ${jobsList.length} jobs — ${spanOk ? `ok, ≥${requiredSpanDays}d` : "too narrow"}`,
  );

  // ── Deep-link assertion: nested routes return real *related* data ───────
  const len = async (p: string): Promise<number> => {
    const r = await app.request(`${BASE}${p}`, { headers: auth });
    if (!r.ok) {
      await r.body?.cancel();
      return -1;
    }
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? j.length : Object.keys(j as object).length;
  };
  const links: Array<[string, string]> = [
    ["job → sections", `${C}/jobs/${lastJob}/sections/`],
    ["job section → cost centers", `${C}/jobs/${lastJob}/sections/${lastJobSec}/costCenters/`],
    ["job → tasks", `${C}/jobs/${lastJob}/tasks/`],
    ["job → invoices", `${C}/jobs/${lastJob}/invoices/`],
    ["quote → sections", `${C}/quotes/${lastQuote}/sections/`],
    ["recurringJob → sections", `${C}/recurringJobs/${lastRJob}/sections/`],
    ["vendorOrder → receipts", `${C}/vendorOrders/${lastVO}/receipts/`],
    ["vendor → branches", `${C}/vendors/${ctx.vendor}/branches/`],
    ["vendor → contacts", `${C}/vendors/${ctx.vendor}/contacts/`],
    ["plantType → plants", `${C}/plantTypes/${pType}/plants/`],
    ["customer → contacts", `${C}/customers/${lastCust}/contacts/`],
    ["lead → notes", `${C}/leads/${lastLead}/notes/`],
  ];
  // LIVE has no public job-task POST, so its job→tasks chain is skipped above.
  const linkChecks = links.filter(([label]) => !(LIVE || REMOTE) || label !== "job → tasks");
  let linkedOk = 0;
  console.log("");
  for (const [label, p] of linkChecks) {
    const c = await len(p);
    if (c > 0) linkedOk++;
    console.log(`  ${c > 0 ? "✅" : "❌"} ${label.padEnd(30)} ${c >= 0 ? `${c} related rows` : "not reachable"}`);
  }
  const linksOk = linkedOk === linkChecks.length;
  console.log(
    `\n  ${linkedOk}/${linkChecks.length} nested relationships return related data — ${linksOk ? "✅ fully linked" : "❌ gaps"}`,
  );

  // ── Shape + relational-integrity assertion ──────────────────────────────
  // Not just "rows exist" — every entity must have its full JSON shape AND
  // each relational reference must resolve to a real, linked entity (the FK
  // is cross-checked by fetching the referenced entity and, where the back-
  // reference is observable, asserting it matches).
  heading("Simpro sim — shape + relational integrity (all shapes, resolved FKs)");

  type J = Record<string, unknown>;
  const gj = async (p: string): Promise<J | J[] | null> => {
    const r = await app.request(`${BASE}${p}`, { headers: auth });
    if (!r.ok) {
      await r.body?.cancel();
      return null;
    }
    return (await r.json()) as J | J[];
  };
  const arr = (x: unknown): J[] =>
    Array.isArray(x) ? (x as J[]) : x && typeof x === "object" ? (Object.values(x as object) as J[]) : [];
  const idOf = (x: unknown): number | undefined => {
    if (x && typeof x === "object") {
      const v = (x as J).ID;
      return typeof v === "number" ? v : undefined;
    }
    return typeof x === "number" ? x : undefined;
  };
  const hasKeys = (o: unknown, ks: string[]): boolean =>
    !!o && typeof o === "object" && ks.every((k) => (o as J)[k] !== undefined);
  const checks: Array<[string, boolean, string]> = [];
  const check = (label: string, cond: boolean, detail = ""): void => {
    checks.push([label, cond, detail]);
  };
  const resolves = async (p: string): Promise<boolean> => (await gj(p)) !== null;

  // Job (display=all) — the deepest shape: refs + nested Sections/CostCenters.
  const job = (await gj(`${C}/jobs/${lastJob}?display=all`)) as J | null;
  check(
    "job shape",
    hasKeys(job, ["ID", "Type", "Customer", "Site", "Name", "DateIssued", "Total", "Stage", "Status", "Sections"]),
  );
  const jCust = idOf(job?.Customer);
  check("job.Customer → real customer", !!jCust && (await resolves(`${C}/customers/${jCust}`)), `Customer.ID=${jCust}`);
  check("job.Total shape", hasKeys(job?.Total, ["ExTax", "Tax", "IncTax"]));
  const jSecs = arr(job?.Sections);
  check(
    "job.Sections populated + shaped",
    jSecs.length > 0 && hasKeys(jSecs[0], ["ID", "Name", "CostCenters"]),
    `${jSecs.length} sections`,
  );
  const jCCs = arr(jSecs[0]?.CostCenters);
  check(
    "section.CostCenters populated + shaped",
    jCCs.length > 0 && hasKeys(jCCs[0], ["ID", "CostCenter", "TaxCode", "Total", "Items"]),
    `${jCCs.length} cost centers`,
  );
  check(
    "costCenter.CostCenter → master ref resolves",
    idOf(jCCs[0]?.CostCenter) === ctx.masterCC,
    `master=${idOf(jCCs[0]?.CostCenter)}`,
  );
  check(
    "costCenter.TaxCode → tax ref resolves",
    idOf(jCCs[0]?.TaxCode) === ctx.taxCode,
    `tax=${idOf(jCCs[0]?.TaxCode)}`,
  );
  check(
    "costCenter.Items shape",
    hasKeys(jCCs[0]?.Items, ["CatalogItems", "LabourItems", "OneOffItems", "PrebuildItems"]),
  );

  // Invoice — Jobs[] back-ref must point at a real job; Customer must match.
  const jInvs = arr(await gj(`${C}/jobs/${lastJob}/invoices/`));
  const invId = idOf(jInvs[0]);
  const inv = invId ? ((await gj(`${C}/invoices/${invId}`)) as J | null) : null;
  check("invoice shape", hasKeys(inv, ["ID", "Type", "Customer", "Jobs", "Total", "DateIssued"]));
  const invJob = idOf(arr(inv?.Jobs)[0]);
  check("invoice.Jobs[0] → real job", invJob === lastJob && (await resolves(`${C}/jobs/${invJob}`)), `Job=${invJob}`);
  check("invoice.Customer === job.Customer", idOf(inv?.Customer) === jCust, `inv=${idOf(inv?.Customer)} job=${jCust}`);
  check("invoice.Total shape", hasKeys(inv?.Total, ["ExTax", "IncTax", "Tax", "BalanceDue"]));

  // Payment — Invoices[] must resolve to a real invoice.
  const pays = arr(await gj(`${C}/customerPayments/`));
  const payWithInv = pays.find((p) => arr(p.Invoices).length > 0) ?? pays[0];
  check("payment shape", hasKeys(payWithInv, ["ID", "Customer", "Payment", "Invoices"]));
  check("payment.Payment shape", hasKeys(payWithInv?.Payment, ["PaymentMethod", "Amount", "Date"]));
  const payInv = idOf(arr(payWithInv?.Invoices)[0]);
  check(
    "payment.Invoices[0] → real invoice",
    !!payInv && (await resolves(`${C}/invoices/${payInv}`)),
    `Invoice=${payInv}`,
  );

  // Quote — Customer ref resolves; sections → cost centers chain shaped.
  const quote = (await gj(`${C}/quotes/${lastQuote}`)) as J | null;
  check("quote shape", hasKeys(quote, ["ID", "Name", "Customer", "Site", "Total", "Stage", "Status", "DateIssued"]));
  const qCust = idOf(quote?.Customer);
  check(
    "quote.Customer → real customer",
    !!qCust && (await resolves(`${C}/customers/${qCust}`)),
    `Customer.ID=${qCust}`,
  );
  const qSecs = arr(await gj(`${C}/quotes/${lastQuote}/sections/`));
  const qSecId = idOf(qSecs[0]);
  const qCCs = qSecId ? arr(await gj(`${C}/quotes/${lastQuote}/sections/${qSecId}/costCenters/`)) : [];
  check(
    "quote.Sections → CostCenters chain",
    qSecs.length > 0 && qCCs.length > 0,
    `${qSecs.length} secs / ${qCCs.length} ccs`,
  );

  // Asset — Customer + Site refs.
  const asset = arr(await gj(`${C}/assets/`))[0] ?? null;
  check("asset shape", hasKeys(asset, ["ID", "Name", "Customer", "Site", "DateInstalled"]));
  check(
    "asset.Customer → real customer",
    !!idOf(asset?.Customer) && (await resolves(`${C}/customers/${idOf(asset?.Customer)}`)),
    `Customer.ID=${idOf(asset?.Customer)}`,
  );

  // Schedule — Staff ref + job back-reference.
  const sched = arr(await gj(`${C}/schedules/`))[0] ?? null;
  check("schedule shape", hasKeys(sched, ["ID", "Staff", "Date", "Blocks"]));
  check("schedule.Staff → technician", idOf(sched?.Staff) === ctx.staff, `Staff.ID=${idOf(sched?.Staff)}`);
  const schedJob = Number(sched?.Reference);
  check("schedule.Reference → real job", !!schedJob && (await resolves(`${C}/jobs/${schedJob}`)), `job=${schedJob}`);

  // Credit note — Customer ref resolves.
  const cn = arr(await gj(`${C}/creditNotes/`))[0] ?? null;
  check("creditNote shape", hasKeys(cn, ["ID", "Type", "Customer", "Total", "DateIssued"]));
  check(
    "creditNote.Customer → real customer",
    !!idOf(cn?.Customer) && (await resolves(`${C}/customers/${idOf(cn?.Customer)}`)),
    `Customer.ID=${idOf(cn?.Customer)}`,
  );

  // Vendor order — Vendor ref must resolve to the seeded vendor.
  const vo = (await gj(`${C}/vendorOrders/${lastVO}`)) as J | null;
  check("vendorOrder shape", hasKeys(vo, ["ID", "Vendor", "Totals", "DateIssued"]));
  check(
    "vendorOrder.Vendor → real vendor",
    idOf(vo?.Vendor) === ctx.vendor && (await resolves(`${C}/vendors/${ctx.vendor}`)),
    `Vendor.ID=${idOf(vo?.Vendor)}`,
  );

  // Site — Customer ref resolves (the onboarding back-link).
  const site = arr(await gj(`${C}/sites/`))[0] ?? null;
  check("site shape", hasKeys(site, ["ID", "Name"]));

  // Customer-scoped contact shape.
  const cc = arr(await gj(`${C}/customers/${lastCust}/contacts/`))[0] ?? null;
  check("customer contact shape", hasKeys(cc, ["ID", "GivenName", "FamilyName"]));

  for (const [label, ok, detail] of checks) console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(42)} ${detail}`);
  const passedShapes = checks.filter(([, ok]) => ok).length;
  const shapesOk = passedShapes === checks.length;
  console.log(
    `\n  ${passedShapes}/${checks.length} shape + relational-integrity checks — ${shapesOk ? "✅ all shapes accounted for, FKs resolved" : "❌ gaps"}`,
  );

  // ── Phase B: crawl EVERY endpoint, repeated for several passes ──────────
  const order: Record<string, number> = { POST: 0, GET: 1, PATCH: 2, PUT: 2, DELETE: 3 };
  const routes = [...SIMPRO_ROUTES].sort((a, b) => {
    const o = (order[a[0]] ?? 9) - (order[b[0]] ?? 9);
    if (o !== 0) return o;
    return a[1].split("/").length - b[1].split("/").length;
  });

  const passReports: string[] = [];
  let anyPassFailed = false;
  for (let pass = 1; pass <= PASSES; pass++) {
    heading(`Simpro sim — crawl pass ${pass}/${PASSES}: exercising all ${SIMPRO_ROUTES.length} endpoints`);
    await oauth();
    fiveXX = [];
    listFailures = [];
    idCache = new Map();
    const before = calls;

    for (const [method, path] of routes) await call(method, path);
    for (const p of ["jobs", "customers", "sections", "cost-centers", "invoices", "webhooks"]) {
      const r = await app.request(`${BASE}/inspector/${p}`, { headers: auth });
      covered.add(`GET /inspector/${p}`);
      status[r.status] = (status[r.status] ?? 0) + 1;
      if (r.status !== 200) listFailures.push(`GET /inspector/${p} → ${r.status}`);
      await r.body?.cancel();
    }

    const missing = SIMPRO_ROUTES.filter(([m, p]) => !covered.has(`${m} ${p}`));
    const passOk = missing.length === 0 && fiveXX.length === 0 && listFailures.length === 0;
    anyPassFailed = anyPassFailed || !passOk;
    passReports.push(
      `  pass ${pass}: ${calls - before} calls • coverage ${covered.size}/${SIMPRO_ROUTES.length} • ` +
        `5xx=${fiveXX.length} • listFail=${listFailures.length} — ${passOk ? "✅" : "❌"}`,
    );
    if (fiveXX.length) passReports.push(`    5xx: ${fiveXX.slice(0, 10).join(" | ")}`);
    if (listFailures.length) passReports.push(`    listFail: ${listFailures.slice(0, 10).join(" | ")}`);
  }

  heading("Simpro sim — coverage report");

  const missing = SIMPRO_ROUTES.filter(([m, p]) => !covered.has(`${m} ${p}`));
  const dist = Object.entries(status)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, n]) => `${s}×${n}`)
    .join("  ");
  const twoxx = Object.entries(status)
    .filter(([s]) => Number(s) >= 200 && Number(s) < 400)
    .reduce((a, [, n]) => a + n, 0);
  const ratio = ((twoxx / calls) * 100).toFixed(1);

  console.log(`\n  ${calls} endpoint calls across ${PASSES} passes`);
  console.log(`  status distribution: ${dist}`);
  console.log(`  success (2xx/3xx): ${twoxx}/${calls} (${ratio}%)`);
  console.log(
    `  route-pattern coverage: ${covered.size}/${SIMPRO_ROUTES.length} ` +
      `(${SIMPRO_SWAGGER_OPERATION_COUNT} Swagger operations + local OAuth/inspector routes)`,
  );
  for (const line of passReports) console.log(line);
  if (missing.length) console.log(`  ❌ MISSING (${missing.length}): ${missing.map((r) => r.join(" ")).join(" | ")}`);

  const ok =
    missing.length === 0 &&
    !anyPassFailed &&
    spanOk &&
    linksOk &&
    shapesOk &&
    dense === weeklyKeys.length &&
    Number(ratio) >= 80;
  // ── Optional: export the complete linked quarter as a bootable seed config ──
  // This runs after the Swagger crawl so generic spec-only records are captured
  // under simpro.swagger_records. DELETE routes are skipped in export mode so
  // crawler-created rows survive into the file.
  if (EXPORT_PATH && (LIVE || REMOTE)) {
    console.log(
      `\n  ⓘ export skipped in remote/live mode — the quarter lives in the running server (${REMOTE ?? TARGET}); no static dump needed`,
    );
  } else if (EXPORT_PATH && ok) {
    const seed = storeToSeedConfig(emu.store, BASE);
    writeFileSync(EXPORT_PATH, JSON.stringify({ simpro: seed }, null, 2));
    console.log(`\n  📦 exported linked quarter → ${EXPORT_PATH} (boot: EMULATE_CONFIG_PATH=${EXPORT_PATH})`);
  }
  console.log(
    `\nSimpro ${PROFILE_NAME} simulation ${ok ? `complete — ${SIMPRO_SWAGGER_OPERATION_COUNT} Swagger operations, linked workflow data, all relationships populated` : "INCOMPLETE"}.\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
