import type { Context } from "hono";
import type { Collection, Entity, RouteContext } from "@emulators/core";
import { escapeHtml, renderSettingsPage } from "@emulators/core";
import { getSimproStore, type SimproStore } from "../store.js";

type SimproCollectionKey = {
  [K in keyof SimproStore]: SimproStore[K] extends Collection<Entity> ? K : never;
}[keyof SimproStore];

interface EntityInspector {
  id: string;
  label: string;
  collection: SimproCollectionKey;
  apiPath?: string;
}

// Routes and hrefs are service-relative. The multi-service dispatcher strips
// the `/simpro` segment before forwarding and re-prefixes outbound Location
// headers + HTML href/action attributes, so hardcoding `/simpro` here would
// make the inspector unreachable when mounted at /simpro/* (the default).
const ENTITY_INSPECTORS: EntityInspector[] = [
  { id: "companies", label: "Companies", collection: "companies", apiPath: "/api/v1.0/companies/" },
  { id: "customers", label: "Customers", collection: "customers", apiPath: "/api/v1.0/companies/0/customers/" },
  { id: "sites", label: "Sites", collection: "sites", apiPath: "/api/v1.0/companies/0/sites/" },
  { id: "contacts", label: "Contacts", collection: "contacts", apiPath: "/api/v1.0/companies/0/contacts/" },
  { id: "staff", label: "Staff", collection: "staff", apiPath: "/api/v1.0/companies/0/staff/" },
  { id: "employees", label: "Employees", collection: "employees", apiPath: "/api/v1.0/companies/0/employees/" },
  { id: "contractors", label: "Contractors", collection: "contractors", apiPath: "/api/v1.0/companies/0/contractors/" },
  { id: "jobs", label: "Jobs", collection: "jobs", apiPath: "/api/v1.0/companies/0/jobs/" },
  { id: "sections", label: "Sections", collection: "sections", apiPath: "/api/v1.0/companies/0/jobs/:jobID/sections/" },
  {
    id: "cost-centers",
    label: "Cost Centers",
    collection: "costCenters",
    apiPath: "/api/v1.0/companies/0/jobs/:jobID/sections/:sectionID/costCenters/",
  },
  { id: "catalog-items", label: "Catalog Items", collection: "catalogItems" },
  { id: "labour-items", label: "Labour Items", collection: "labourItems" },
  { id: "one-off-items", label: "One-Off Items", collection: "oneOffItems" },
  { id: "prebuild-items", label: "Prebuild Items", collection: "prebuildItems" },
  { id: "quotes", label: "Quotes", collection: "quotes", apiPath: "/api/v1.0/companies/0/quotes/" },
  { id: "quote-sections", label: "Quote Sections", collection: "quoteSections" },
  { id: "quote-cost-centers", label: "Quote Cost Centers", collection: "quoteCostCenters" },
  { id: "invoices", label: "Invoices", collection: "invoices", apiPath: "/api/v1.0/companies/0/invoices/" },
  {
    id: "customer-payments",
    label: "Customer Payments",
    collection: "customerPayments",
    apiPath: "/api/v1.0/companies/0/customerPayments/",
  },
  {
    id: "credit-notes",
    label: "Credit Notes",
    collection: "creditNotes",
    apiPath: "/api/v1.0/companies/0/creditNotes/",
  },
  { id: "schedules", label: "Schedules", collection: "schedules", apiPath: "/api/v1.0/companies/0/schedules/" },
  { id: "activity-schedules", label: "Activities", collection: "activitySchedules" },
  { id: "tasks", label: "Tasks", collection: "tasks" },
  { id: "notes", label: "Notes", collection: "notes", apiPath: "/api/v1.0/companies/0/notes/jobs/" },
  { id: "timesheets", label: "Timesheets", collection: "timesheets", apiPath: "/api/v1.0/companies/0/timesheets/" },
  { id: "assets", label: "Assets", collection: "assets", apiPath: "/api/v1.0/companies/0/assets/" },
  { id: "zones", label: "Zones", collection: "zones", apiPath: "/api/v1.0/companies/0/zones/" },
  { id: "attachments", label: "Attachments", collection: "attachments" },
  { id: "vendors", label: "Vendors", collection: "vendors", apiPath: "/api/v1.0/companies/0/vendors/" },
  {
    id: "vendor-orders",
    label: "Vendor Orders",
    collection: "vendorOrders",
    apiPath: "/api/v1.0/companies/0/vendorOrders/",
  },
  { id: "vendor-branches", label: "Vendor Branches", collection: "vendorBranches" },
  { id: "vendor-contacts", label: "Vendor Contacts", collection: "vendorContacts" },
  { id: "vendor-receipts", label: "Vendor Receipts", collection: "vendorReceipts" },
  { id: "vendor-order-catalogs", label: "Vendor Catalogs", collection: "vendorOrderCatalogs" },
  { id: "vendor-credits", label: "Vendor Credits", collection: "vendorCredits" },
  { id: "stock-items", label: "Stock Items", collection: "stockItems", apiPath: "/api/v1.0/companies/0/catalogs/" },
  { id: "storage-devices", label: "Storage Devices", collection: "storageDevices" },
  { id: "stock-allocations", label: "Stock Allocations", collection: "stockAllocations" },
  { id: "stock-takes", label: "Stock Takes", collection: "stockTakes" },
  { id: "stock-transfers", label: "Stock Transfers", collection: "stockTransfers" },
  { id: "prebuilds", label: "Prebuilds", collection: "prebuilds", apiPath: "/api/v1.0/companies/0/prebuilds/" },
  { id: "prebuild-groups", label: "Prebuild Groups", collection: "prebuildGroups" },
  { id: "plant-types", label: "Plant Types", collection: "plantTypes" },
  { id: "plants", label: "Plants", collection: "plants" },
  {
    id: "recurring-jobs",
    label: "Recurring Jobs",
    collection: "recurringJobs",
    apiPath: "/api/v1.0/companies/0/recurringJobs/",
  },
  { id: "recurring-job-sections", label: "Recurring Job Sections", collection: "recurringJobSections" },
  { id: "recurring-job-cost-centers", label: "Recurring Job Cost Centers", collection: "recurringJobCostCenters" },
  {
    id: "recurring-invoices",
    label: "Recurring Invoices",
    collection: "recurringInvoices",
    apiPath: "/api/v1.0/companies/0/recurringInvoices/",
  },
  { id: "recurring-invoice-sections", label: "Recurring Invoice Sections", collection: "recurringInvoiceSections" },
  {
    id: "recurring-invoice-cost-centers",
    label: "Recurring Invoice Cost Centers",
    collection: "recurringInvoiceCostCenters",
  },
  { id: "work-orders", label: "Work Orders", collection: "workOrders" },
  { id: "contractor-jobs", label: "Contractor Jobs", collection: "contractorJobs" },
  { id: "contractor-invoices", label: "Contractor Invoices", collection: "contractorInvoices" },
  { id: "custom-fields", label: "Custom Fields", collection: "customFields" },
  { id: "setup-custom-fields", label: "Setup Custom Fields", collection: "setupCustomFieldDefs" },
  { id: "setup-tags", label: "Setup Tags", collection: "setupTags" },
  { id: "setup-customer-groups", label: "Customer Groups", collection: "setupCustomerGroups" },
  { id: "setup-activities", label: "Setup Activities", collection: "setupActivities" },
  { id: "setup-teams", label: "Teams", collection: "setupTeams" },
  { id: "setup-security-groups", label: "Security Groups", collection: "setupSecurityGroups" },
  { id: "setup-status-codes", label: "Status Codes", collection: "setupStatusCodes" },
  { id: "setup-payment-methods", label: "Payment Methods", collection: "setupPaymentMethods" },
  { id: "setup-payment-terms", label: "Payment Terms", collection: "setupPaymentTerms" },
  { id: "setup-archive-reasons", label: "Archive Reasons", collection: "setupArchiveReasons" },
  { id: "setup-memberships", label: "Memberships", collection: "setupMemberships" },
  { id: "setup-response-times", label: "Response Times", collection: "setupResponseTimes" },
  { id: "setup-chart-of-accounts", label: "Chart of Accounts", collection: "setupChartOfAccounts" },
];

const table = (headers: string[], rows: string[][]): string => {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="inspector-empty">No records</td></tr>`;
  return `<table class="inspector-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

function valueLabel(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function columnsFor(items: Entity[]): string[] {
  const preferred = [
    "external_id",
    "type",
    "name",
    "company_name",
    "given_name",
    "family_name",
    "email",
    "customer_id",
    "site_id",
    "job_id",
    "quote_id",
    "invoice_id",
    "vendor_id",
    "section_id",
    "cost_center_id",
    "stage",
    "status",
    "date",
    "date_issued",
    "date_modified",
    "total_ex_tax",
    "total_inc_tax",
    "archived",
  ];
  const seen = new Set<string>();
  for (const item of items.slice(0, 25)) {
    for (const key of Object.keys(item)) {
      if (key === "id" || key === "company_id" || key === "created_at" || key === "updated_at") continue;
      seen.add(key);
    }
  }
  const ordered = preferred.filter((key) => seen.has(key));
  for (const key of seen) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered.slice(0, 8);
}

function renderEntityInspector(ss: SimproStore, config: EntityInspector): string {
  const records = ss[config.collection].all();
  const columns = columnsFor(records);
  const rows = records
    .slice(0, 100)
    .map((item) => columns.map((key) => valueLabel((item as unknown as Record<string, unknown>)[key])));
  const apiPath = config.apiPath ? `<p class="info-text">Primary API path: ${escapeHtml(config.apiPath)}</p>` : "";
  const note =
    records.length > 100
      ? `<p class="info-text">Showing 100 of ${records.length} records. Use the API for full sync pagination.</p>`
      : "";
  return `
    <section class="inspector-section">
      <h2>${escapeHtml(config.label)} (${records.length})</h2>
      ${apiPath}
      ${table(columns.length ? columns : ["records"], rows)}
      ${note}
    </section>
  `;
}

function renderOverview(ss: SimproStore): string {
  const rows = ENTITY_INSPECTORS.map((config) => [
    config.label,
    String(ss[config.collection].all().length),
    config.apiPath ?? "nested or setup route",
  ]);
  const total = rows.reduce((sum, row) => sum + Number(row[1]), 0);
  return `
    <section class="inspector-section">
      <h2>Seeded SimPro Data (${total} records)</h2>
      <p class="info-text">Each tab maps to one seeded emulator collection. Sync clients should read from the matching SimPro API path and use webhook events for change notifications.</p>
      ${table(["Endpoint Group", "Records", "Primary Path"], rows)}
    </section>
  `;
}

function sidebarLink(id: string, label: string, href: string, active: string, count?: number): string {
  const cls = id === active ? ' class="active"' : "";
  const suffix = count == null ? "" : ` <span class="badge badge-requested">${count}</span>`;
  return `<a href="${escapeHtml(href)}"${cls}>${escapeHtml(label)}${suffix}</a>`;
}

function renderSidebar(ss: SimproStore, active: string): string {
  const links = [
    sidebarLink("overview", "Overview", "/inspector", active),
    ...ENTITY_INSPECTORS.map((config) =>
      sidebarLink(config.id, config.label, `/inspector/${config.id}`, active, ss[config.collection].all().length),
    ),
    sidebarLink("webhooks", "Webhooks", "/inspector/webhooks", active, ss.webhookEvents.all().length),
  ];
  return links.join("\n");
}

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ss = getSimproStore(store);

  const render = (active: string, body: string, c: Context) =>
    c.html(
      renderSettingsPage(
        "Simpro Emulator",
        renderSidebar(ss, active),
        `<div class="s-card">
  <div class="s-card-header">
    <div class="s-icon">S</div>
    <div>
      <div class="s-title">SimPro Data</div>
      <div class="s-subtitle">Seeded endpoint groups and sync data</div>
    </div>
  </div>
  ${body}
</div>`,
        "simpro",
      ),
    );

  app.get("/", (c) => c.redirect("/inspector"));

  app.get("/inspector", (c) => render("overview", renderOverview(ss), c));

  for (const config of ENTITY_INSPECTORS) {
    app.get(`/inspector/${config.id}`, (c) => render(config.id, renderEntityInspector(ss, config), c));
  }

  app.get("/inspector/webhooks", (c) => {
    const subRows = ss.webhookSubscriptions
      .all()
      .map((w) => [String(w.external_id), w.url, w.events.join(", "), w.active ? "yes" : "no"]);
    const evRows = ss.webhookEvents.all().map((e) => [String(e.id), e.event, String(e.entity_id), e.status]);
    const body = `
      <h3>Subscriptions</h3>
      ${table(["ID", "URL", "Events", "Active"], subRows)}
      <h3>Recent Events</h3>
      ${table(["ID", "Event", "Entity", "Status"], evRows)}
    `;
    return render("webhooks", body, c);
  });
}
