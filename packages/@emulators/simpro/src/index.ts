import type { Hono } from "hono";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { getSimproStore } from "./store.js";
import type { BillingType, CostCenterStage, JobStage, JobType, SimproAddress } from "./entities.js";
import { nowIso } from "./helpers.js";
import { oauthRoutes } from "./routes/oauth.js";
import { jobRoutes } from "./routes/jobs.js";
import { sectionRoutes } from "./routes/sections.js";
import { costCenterRoutes } from "./routes/costCenters.js";
import { customerRoutes } from "./routes/customers.js";
import { siteRoutes } from "./routes/sites.js";
import { staffRoutes } from "./routes/staff.js";
import { quoteRoutes } from "./routes/quotes.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { assetRoutes } from "./routes/assets.js";
import { referenceRoutes } from "./routes/reference.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { contactRoutes } from "./routes/contacts.js";
import { contractorRoutes } from "./routes/contractors.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { companyRoutes } from "./routes/companies.js";
import { paymentRoutes } from "./routes/payments.js";
import { creditNoteRoutes } from "./routes/creditNotes.js";
import { vendorRoutes } from "./routes/vendors.js";
import { vendorOrderRoutes } from "./routes/vendorOrders.js";
import { employeeRoutes } from "./routes/employees.js";
import { leadRoutes } from "./routes/leads.js";
import { noteRoutes } from "./routes/notes.js";
import { taskRoutes } from "./routes/tasks.js";
import { setupResourceRoutes } from "./routes/setupResources.js";
import { contractorResourceRoutes } from "./routes/contractorResources.js";
import { costCenterLineItemRoutes } from "./routes/costCenterLineItems.js";
import { plantRoutes } from "./routes/plants.js";
import { prebuildRoutes } from "./routes/prebuilds.js";
import { recurringInvoiceRoutes } from "./routes/recurringInvoices.js";
import { recurringJobRoutes } from "./routes/recurringJobs.js";
import { activityScheduleRoutes } from "./routes/activitySchedules.js";
import { logsAndMiscRoutes } from "./routes/logsAndMisc.js";
import { quoteSectionRoutes } from "./routes/quoteSections.js";
import { stockRoutes } from "./routes/stock.js";
import { timesheetRoutes } from "./routes/timesheets.js";
import { vendorSubResourceRoutes } from "./routes/vendorSubResources.js";
import {
  exportSimproSwaggerRecords,
  fillSimproSwaggerRecordsFromSpec,
  seedSimproSwaggerRecords,
  simproSpecFallbackRoutes,
  type SimproSwaggerRecords,
} from "./routes/specFallback.js";
import type { SimproAttachmentParentType } from "./entities.js";

export { getSimproStore, type SimproStore } from "./store.js";
export { fireWebhook } from "./routes/webhooks.js";
export { fillSimproSwaggerRecordsFromSpec } from "./routes/specFallback.js";
// Canonical REST formatters — re-exported so the server-layer Nango bridge can
// emit the exact same JSON the /simpro REST routes return.
export { formatCustomer, formatInvoice, formatQuote } from "./formatters.js";
export * from "./entities.js";

export interface SimproSeedConfig {
  port?: number;
  rate_limit_enabled?: boolean;
  oauth?: {
    client_id?: string;
    client_secret?: string;
  };
  companies?: Array<{ id: number; name: string }>;
  tax_codes?: Array<{ id: number; company_id?: number; name: string; rate: number }>;
  statuses?: Array<{
    id: number;
    company_id?: number;
    kind: "job" | "quote";
    name: string;
  }>;
  master_cost_centers?: Array<{
    id: number;
    company_id?: number;
    name: string;
    income_account?: string | null;
    expense_account?: string | null;
  }>;
  staff?: Array<{
    id: number;
    company_id?: number;
    given_name: string;
    family_name: string;
    email?: string | null;
  }>;
  customers?: Array<{
    id: number;
    company_id?: number;
    type: "company" | "individual";
    company_name?: string | null;
    given_name?: string | null;
    family_name?: string | null;
    email?: string | null;
    phone_primary?: string | null;
    website?: string | null;
    ein?: string | null;
    address?: SimproAddress | null;
    tax_code_id?: number | null;
    payment_terms?: number | null;
    archived?: boolean;
    tags?: string[];
    sites?: Array<{ id: number; name: string; address?: SimproAddress | null }>;
  }>;
  jobs?: Array<{
    id: number;
    company_id?: number;
    type?: JobType;
    name: string;
    description?: string | null;
    customer_id: number;
    site_id?: number | null;
    stage?: JobStage;
    order_no?: string | null;
    project_manager_id?: number | null;
    salesperson_id?: number | null;
    status_id?: number | null;
    date_issued?: string | null;
    due_date?: string | null;
    total_ex_tax?: number;
    total_tax?: number;
    total_inc_tax?: number;
    sections?: Array<{
      id: number;
      name: string;
      description?: string | null;
      cost_centers?: Array<{
        id: number;
        master_cost_center_id?: number | null;
        tax_code_id?: number | null;
        name?: string;
        description?: string | null;
        billing_type?: BillingType;
        stage?: CostCenterStage;
        ex_tax?: number;
        inc_tax?: number;
        catalog_items?: Array<{
          id: number;
          stock_item_id?: number | null;
          name: string;
          part_no?: string | null;
          quantity?: number;
          base_price?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        labour_items?: Array<{
          id: number;
          labour_id: number;
          name: string;
          hours?: number;
          labour_rate?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        one_off_items?: Array<{
          id: number;
          description: string;
          quantity?: number;
          est_cost?: number;
          act_cost?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        prebuild_items?: Array<{
          id: number;
          prebuild_id: number;
          name: string;
          quantity?: number;
          cost_price?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
      }>;
    }>;
  }>;
  quotes?: Array<{
    id: number;
    company_id?: number;
    name: string;
    description?: string | null;
    order_no?: string | null;
    customer_id: number;
    site_id?: number | null;
    salesperson_id?: number | null;
    project_manager_id?: number | null;
    status_id?: number | null;
    stage?: "InProgress" | "Complete" | "Approved" | "Cancelled" | "Converted";
    total_ex_tax?: number;
    total_tax?: number;
    total_inc_tax?: number;
    date_issued?: string | null;
    due_date?: string | null;
    tags?: string[];
    converted_job_id?: number | null;
    sections?: Array<{
      id: number;
      name: string;
      description?: string | null;
      cost_centers?: Array<{
        id: number;
        master_cost_center_id?: number | null;
        tax_code_id?: number | null;
        name?: string;
        description?: string | null;
        billing_type?: BillingType;
        stage?: CostCenterStage;
        ex_tax?: number;
        inc_tax?: number;
        catalog_items?: Array<{
          id: number;
          stock_item_id?: number | null;
          name: string;
          part_no?: string | null;
          quantity?: number;
          base_price?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        labour_items?: Array<{
          id: number;
          labour_id: number;
          name: string;
          hours?: number;
          labour_rate?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        one_off_items?: Array<{
          id: number;
          description: string;
          quantity?: number;
          est_cost?: number;
          act_cost?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
        prebuild_items?: Array<{
          id: number;
          prebuild_id: number;
          name: string;
          quantity?: number;
          cost_price?: number;
          markup?: number;
          sell_price?: number;
          ex_tax?: number;
        }>;
      }>;
    }>;
  }>;
  assets?: Array<{
    id: number;
    company_id?: number;
    customer_id: number;
    site_id?: number | null;
    name: string;
    description?: string | null;
    asset_type?: string | null;
    serial_number?: string | null;
    status?: string | null;
    notes?: string | null;
    date_installed?: string | null;
    date_next_service?: string | null;
  }>;
  invoices?: Array<{
    id: number;
    company_id?: number;
    job_id: number;
    type?: "TaxInvoice" | "ProgressInvoice" | "Deposit" | "RequestForClaim";
    stage?: 2 | 5;
    total_ex_tax?: number;
    total_inc_tax?: number;
    paid?: number;
    date_issued?: string | null;
  }>;
  contacts?: Array<{
    id: number;
    company_id?: number;
    type?: "Customer" | "Site";
    customer_id?: number | null;
    site_id?: number | null;
    salutation?: string | null;
    given_name: string;
    family_name: string;
    position?: string | null;
    department?: string | null;
    email?: string | null;
    alt_email?: string | null;
    phone?: string | null;
    cell_phone?: string | null;
    fax?: string | null;
    primary_contact?: boolean;
    archived?: boolean;
  }>;
  contractors?: Array<{
    id: number;
    company_id?: number;
    company_name?: string | null;
    given_name?: string | null;
    family_name?: string | null;
    email?: string | null;
    phone?: string | null;
    cell_phone?: string | null;
    fax?: string | null;
    archived?: boolean;
  }>;
  employees?: Array<{
    id: number;
    company_id?: number;
    given_name: string;
    family_name: string;
    email?: string | null;
    phone?: string | null;
    active?: boolean;
    archived?: boolean;
  }>;
  schedules?: Array<{
    id: number;
    company_id?: number;
    job_id: number;
    section_id?: number | null;
    cost_center_id?: number | null;
    technician_id: number;
    date: string;
    start_time: string;
    duration_minutes: number;
  }>;
  stock_items?: Array<{
    id: number;
    company_id?: number;
    name: string;
    part_no: string;
    description?: string | null;
    group_name?: string | null;
    subgroup_name?: string | null;
    unit_of_measure?: string | null;
    trade_price_ex_tax?: number;
    trade_price_inc_tax?: number;
    unit_price?: number;
    tax_code_id?: number | null;
    supplier_id?: number | null;
    supplier_name?: string | null;
    supplier_part_no?: string | null;
    taxable?: boolean;
    archived?: boolean;
  }>;
  vendors?: Array<{
    id: number;
    company_id?: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    archived?: boolean;
  }>;
  vendor_orders?: Array<{
    id: number;
    company_id?: number;
    vendor_id?: number | null;
    job_id?: number | null;
    stage?: "Draft" | "Sent" | "PartReceived" | "Received";
    description?: string | null;
    total_ex_tax?: number;
    total_inc_tax?: number;
    date_issued?: string | null;
  }>;
  customer_payments?: Array<{
    id: number;
    company_id?: number;
    customer_id: number;
    invoice_id?: number | null;
    amount: number;
    date?: string | null;
    payment_method?: string | null;
    notes?: string | null;
  }>;
  attachments?: Array<{
    id: number;
    company_id?: number;
    parent_type: SimproAttachmentParentType;
    parent_id: number;
    filename: string;
    description?: string | null;
    mime_type?: string | null;
    size?: number;
    url?: string;
    date_added?: string;
  }>;
  labour_rates?: Array<{
    id: number;
    company_id?: number;
    name: string;
    rate: number;
    cost_rate?: number;
    archived?: boolean;
  }>;
  zones?: Array<{
    id: number;
    company_id?: number;
    name: string;
  }>;
  custom_fields?: Array<{
    id: number;
    company_id?: number;
    name: string;
    entity: "job" | "customer" | "site" | "asset";
    field_type?: "text" | "number" | "date" | "dropdown";
  }>;
  prebuilds?: Array<{
    id: number;
    company_id?: number;
    name: string;
    description?: string | null;
    archived?: boolean;
    date_modified?: string;
  }>;
  plant_types?: Array<{
    id: number;
    company_id?: number;
    name: string;
    description?: string | null;
    archived?: boolean;
  }>;
  plants?: Array<{
    id: number;
    company_id?: number;
    plant_type_id: number;
    name: string;
    serial_number?: string | null;
    description?: string | null;
    archived?: boolean;
    date_modified?: string;
  }>;
  credit_notes?: Array<{
    id: number;
    company_id?: number;
    customer_id: number;
    invoice_id?: number | null;
    job_id?: number | null;
    total_ex_tax?: number;
    total_inc_tax?: number;
    date_issued?: string;
    stage?: 2 | 5;
    notes?: string | null;
  }>;
  leads?: Array<{
    id: number;
    company_id?: number;
    name: string;
    description?: string | null;
    customer_id?: number | null;
    site_id?: number | null;
    stage?: "New" | "InProgress" | "Won" | "Lost";
    salesperson_id?: number | null;
    date_issued?: string | null;
    date_modified?: string;
    tags?: string[];
  }>;
  timesheets?: Array<{
    id: number;
    company_id?: number;
    employee_id?: number | null;
    contractor_id?: number | null;
    job_id?: number | null;
    cost_center_id?: number | null;
    date: string;
    start_time: string;
    end_time?: string | null;
    duration_minutes?: number;
    notes?: string | null;
  }>;
  activity_schedules?: Array<{
    id: number;
    company_id?: number;
    technician_id: number;
    date: string;
    start_time: string;
    duration_minutes?: number;
    activity_type: string;
    notes?: string | null;
  }>;
  recurring_jobs?: Array<{
    id: number;
    company_id?: number;
    name: string;
    description?: string | null;
    customer_id: number;
    site_id?: number | null;
    stage?: "Active" | "Cancelled" | "Completed";
    billing_type?: "TimeAndMaterials" | "Fixed" | "FlatRate";
    frequency?: string;
    start_date?: string;
    end_date?: string | null;
    date_modified?: string;
  }>;
  notes?: Array<{
    id: number;
    company_id?: number;
    parent_type: "job" | "quote" | "customer" | "invoice" | "creditNote" | "recurringJob" | "lead";
    parent_id: number;
    text: string;
    date_created?: string;
    date_modified?: string;
    author_id?: number | null;
  }>;
  swagger_records?: SimproSwaggerRecords;
}

const DEFAULT_COMPANY_ID = 0;
type SeedCostCenter = NonNullable<
  NonNullable<NonNullable<NonNullable<SimproSeedConfig["jobs"]>[number]["sections"]>[number]["cost_centers"]>[number]
>;

function seedCostCenterLineItems(
  ss: ReturnType<typeof getSimproStore>,
  companyId: number,
  costCenterId: number,
  cc: SeedCostCenter,
): void {
  for (const item of cc.catalog_items ?? []) {
    const row = {
      company_id: companyId,
      external_id: item.id,
      cost_center_id: costCenterId,
      stock_item_id: item.stock_item_id ?? null,
      name: item.name,
      part_no: item.part_no ?? null,
      quantity: item.quantity ?? 1,
      base_price: item.base_price ?? 0,
      markup: item.markup ?? 0,
      sell_price: item.sell_price ?? 0,
      ex_tax: item.ex_tax ?? 0,
    };
    const existing = ss.catalogItems.findOneBy("external_id", item.id);
    if (existing) ss.catalogItems.update(existing.id, row);
    else ss.catalogItems.insert(row);
  }
  for (const item of cc.labour_items ?? []) {
    const row = {
      company_id: companyId,
      external_id: item.id,
      cost_center_id: costCenterId,
      labour_id: item.labour_id,
      name: item.name,
      hours: item.hours ?? 0,
      labour_rate: item.labour_rate ?? 0,
      markup: item.markup ?? 0,
      sell_price: item.sell_price ?? 0,
      ex_tax: item.ex_tax ?? 0,
    };
    const existing = ss.labourItems.findOneBy("external_id", item.id);
    if (existing) ss.labourItems.update(existing.id, row);
    else ss.labourItems.insert(row);
  }
  for (const item of cc.one_off_items ?? []) {
    const row = {
      company_id: companyId,
      external_id: item.id,
      cost_center_id: costCenterId,
      description: item.description,
      quantity: item.quantity ?? 1,
      est_cost: item.est_cost ?? 0,
      act_cost: item.act_cost ?? 0,
      markup: item.markup ?? 0,
      sell_price: item.sell_price ?? 0,
      ex_tax: item.ex_tax ?? 0,
    };
    const existing = ss.oneOffItems.findOneBy("external_id", item.id);
    if (existing) ss.oneOffItems.update(existing.id, row);
    else ss.oneOffItems.insert(row);
  }
  for (const item of cc.prebuild_items ?? []) {
    const row = {
      company_id: companyId,
      external_id: item.id,
      cost_center_id: costCenterId,
      prebuild_id: item.prebuild_id,
      name: item.name,
      quantity: item.quantity ?? 1,
      cost_price: item.cost_price ?? 0,
      markup: item.markup ?? 0,
      sell_price: item.sell_price ?? 0,
      ex_tax: item.ex_tax ?? 0,
    };
    const existing = ss.prebuildItems.findOneBy("external_id", item.id);
    if (existing) ss.prebuildItems.update(existing.id, row);
    else ss.prebuildItems.insert(row);
  }
}

export function seedFromConfig(store: Store, _baseUrl: string, config: SimproSeedConfig): void {
  const ss = getSimproStore(store);
  const now = nowIso();

  store.setData("simpro.rate_limit_enabled", Boolean(config.rate_limit_enabled));
  if (config.oauth) store.setData("simpro.oauth", config.oauth);

  for (const co of config.companies ?? []) {
    const existing = ss.companies.findOneBy("company_id", co.id);
    if (existing) ss.companies.update(existing.id, { name: co.name });
    else ss.companies.insert({ company_id: co.id, name: co.name });
  }

  for (const tc of config.tax_codes ?? []) {
    const row = {
      company_id: tc.company_id ?? DEFAULT_COMPANY_ID,
      external_id: tc.id,
      name: tc.name,
      rate: tc.rate,
    };
    const existing = ss.taxCodes.findOneBy("external_id", tc.id);
    if (existing) ss.taxCodes.update(existing.id, row);
    else ss.taxCodes.insert(row);
  }

  for (const st of config.statuses ?? []) {
    const row = {
      company_id: st.company_id ?? DEFAULT_COMPANY_ID,
      external_id: st.id,
      kind: st.kind,
      name: st.name,
    };
    const existing = ss.statuses.findOneBy("external_id", st.id);
    if (existing) ss.statuses.update(existing.id, row);
    else ss.statuses.insert(row);
  }

  for (const mcc of config.master_cost_centers ?? []) {
    const row = {
      company_id: mcc.company_id ?? DEFAULT_COMPANY_ID,
      external_id: mcc.id,
      name: mcc.name,
      archived: false,
      income_account: mcc.income_account ?? null,
      expense_account: mcc.expense_account ?? null,
    };
    const existing = ss.masterCostCenters.findOneBy("external_id", mcc.id);
    if (existing) ss.masterCostCenters.update(existing.id, row);
    else ss.masterCostCenters.insert(row);
  }

  for (const s of config.staff ?? []) {
    const row = {
      company_id: s.company_id ?? DEFAULT_COMPANY_ID,
      external_id: s.id,
      given_name: s.given_name,
      family_name: s.family_name,
      email: s.email ?? null,
      active: true,
    };
    const existing = ss.staff.findOneBy("external_id", s.id);
    if (existing) ss.staff.update(existing.id, row);
    else ss.staff.insert(row);
  }

  for (const cust of config.customers ?? []) {
    const row = {
      company_id: cust.company_id ?? DEFAULT_COMPANY_ID,
      external_id: cust.id,
      type: cust.type,
      company_name: cust.company_name ?? null,
      given_name: cust.given_name ?? null,
      family_name: cust.family_name ?? null,
      title: null,
      email: cust.email ?? null,
      phone_primary: cust.phone_primary ?? null,
      website: cust.website ?? null,
      ein: cust.ein ?? null,
      address: cust.address ?? null,
      tax_code_id: cust.tax_code_id ?? null,
      payment_terms: cust.payment_terms ?? null,
      archived: cust.archived ?? false,
      tags: cust.tags ?? ([] as string[]),
      custom_fields: [],
    };
    const existing = ss.customers.findOneBy("external_id", cust.id);
    if (existing) ss.customers.update(existing.id, row);
    else ss.customers.insert(row);

    for (const site of cust.sites ?? []) {
      const siteRow = {
        company_id: cust.company_id ?? DEFAULT_COMPANY_ID,
        external_id: site.id,
        customer_id: cust.id,
        name: site.name,
        address: site.address ?? null,
        contact_id: null,
        archived: false,
      };
      const existingSite = ss.sites.findOneBy("external_id", site.id);
      if (existingSite) ss.sites.update(existingSite.id, siteRow);
      else ss.sites.insert(siteRow);
    }
  }

  for (const job of config.jobs ?? []) {
    const jobRow = {
      company_id: job.company_id ?? DEFAULT_COMPANY_ID,
      external_id: job.id,
      type: job.type ?? "Project",
      name: job.name,
      description: job.description ?? null,
      order_no: job.order_no ?? null,
      request_no: null,
      customer_id: job.customer_id,
      customer_contact_id: null,
      site_id: job.site_id ?? null,
      site_contact_id: null,
      salesperson_id: job.salesperson_id ?? null,
      project_manager_id: job.project_manager_id ?? null,
      technician_ids: [] as number[],
      stage: job.stage ?? 2,
      status_id: job.status_id ?? null,
      date_issued: job.date_issued ?? now.slice(0, 10),
      due_date: job.due_date ?? null,
      due_time: null,
      tags: [] as string[],
      custom_fields: [],
      total_ex_tax: job.total_ex_tax ?? 0,
      total_tax: job.total_tax ?? 0,
      total_inc_tax: job.total_inc_tax ?? 0,
      invoiced_ex_tax: 0,
      date_modified: now,
    };
    const existingJob = ss.jobs.findOneBy("external_id", job.id);
    if (existingJob) ss.jobs.update(existingJob.id, jobRow);
    else ss.jobs.insert(jobRow);

    let order = 1;
    for (const section of job.sections ?? []) {
      const sectionRow = {
        company_id: job.company_id ?? DEFAULT_COMPANY_ID,
        external_id: section.id,
        job_id: job.id,
        name: section.name,
        description: section.description ?? null,
        display_order: order,
        date_modified: now,
      };
      const existingSection = ss.sections.findOneBy("external_id", section.id);
      if (existingSection) ss.sections.update(existingSection.id, sectionRow);
      else ss.sections.insert(sectionRow);
      order++;

      for (const cc of section.cost_centers ?? []) {
        const ccRow = {
          company_id: job.company_id ?? DEFAULT_COMPANY_ID,
          external_id: cc.id,
          job_id: job.id,
          section_id: section.id,
          master_cost_center_id: cc.master_cost_center_id ?? null,
          tax_code_id: cc.tax_code_id ?? null,
          name: cc.name ?? `Cost Center ${cc.id}`,
          description: cc.description ?? null,
          billing_type: cc.billing_type ?? "TimeAndMaterials",
          billable: true,
          stage: cc.stage ?? 2,
          ex_tax: cc.ex_tax ?? 0,
          tax: 0,
          inc_tax: cc.inc_tax ?? 0,
          invoiced_ex_tax: 0,
          markup: 0,
          discount: 0,
          is_variation: false,
          contractor_work_order_id: null,
          date_modified: now,
        };
        const existingCc = ss.costCenters.findOneBy("external_id", cc.id);
        if (existingCc) ss.costCenters.update(existingCc.id, ccRow);
        else ss.costCenters.insert(ccRow);
        seedCostCenterLineItems(ss, job.company_id ?? DEFAULT_COMPANY_ID, cc.id, cc);
      }
    }
  }

  for (const q of config.quotes ?? []) {
    const quoteRow = {
      company_id: q.company_id ?? DEFAULT_COMPANY_ID,
      external_id: q.id,
      name: q.name,
      description: q.description ?? null,
      order_no: q.order_no ?? null,
      customer_id: q.customer_id,
      customer_contact_id: null,
      site_id: q.site_id ?? null,
      site_contact_id: null,
      salesperson_id: q.salesperson_id ?? null,
      project_manager_id: q.project_manager_id ?? null,
      status_id: q.status_id ?? null,
      stage: q.stage ?? "InProgress",
      total_ex_tax: q.total_ex_tax ?? 0,
      total_tax: q.total_tax ?? 0,
      total_inc_tax: q.total_inc_tax ?? 0,
      date_issued: q.date_issued ?? now.slice(0, 10),
      due_date: q.due_date ?? null,
      tags: q.tags ?? [],
      converted_job_id: q.converted_job_id ?? null,
      date_modified: now,
    };
    const existingQuote = ss.quotes.findOneBy("external_id", q.id);
    if (existingQuote) ss.quotes.update(existingQuote.id, quoteRow);
    else ss.quotes.insert(quoteRow);

    let qOrder = 1;
    for (const section of q.sections ?? []) {
      const qSectionRow = {
        company_id: q.company_id ?? DEFAULT_COMPANY_ID,
        external_id: section.id,
        quote_id: q.id,
        name: section.name,
        description: section.description ?? null,
        display_order: qOrder,
        date_modified: now,
      };
      const existingQSection = ss.quoteSections.findOneBy("external_id", section.id);
      if (existingQSection) ss.quoteSections.update(existingQSection.id, qSectionRow);
      else ss.quoteSections.insert(qSectionRow);
      qOrder++;

      for (const cc of section.cost_centers ?? []) {
        const qCcRow = {
          company_id: q.company_id ?? DEFAULT_COMPANY_ID,
          external_id: cc.id,
          quote_id: q.id,
          section_id: section.id,
          master_cost_center_id: cc.master_cost_center_id ?? null,
          tax_code_id: cc.tax_code_id ?? null,
          name: cc.name ?? `Cost Center ${cc.id}`,
          description: cc.description ?? null,
          billing_type: cc.billing_type ?? "TimeAndMaterials",
          billable: true,
          stage: cc.stage ?? 2,
          ex_tax: cc.ex_tax ?? 0,
          tax: 0,
          inc_tax: cc.inc_tax ?? 0,
          invoiced_ex_tax: 0,
          markup: 0,
          discount: 0,
          is_variation: false,
          date_modified: now,
        };
        const existingQCc = ss.quoteCostCenters.findOneBy("external_id", cc.id);
        if (existingQCc) ss.quoteCostCenters.update(existingQCc.id, qCcRow);
        else ss.quoteCostCenters.insert(qCcRow);
        seedCostCenterLineItems(ss, q.company_id ?? DEFAULT_COMPANY_ID, cc.id, cc);
      }
    }
  }

  for (const a of config.assets ?? []) {
    const assetRow = {
      company_id: a.company_id ?? DEFAULT_COMPANY_ID,
      external_id: a.id,
      customer_id: a.customer_id,
      site_id: a.site_id ?? null,
      name: a.name,
      description: a.description ?? null,
      asset_type: a.asset_type ?? null,
      serial_number: a.serial_number ?? null,
      status: a.status ?? null,
      notes: a.notes ?? null,
      date_installed: a.date_installed ?? null,
      date_next_service: a.date_next_service ?? null,
      date_modified: now,
    };
    const existingAsset = ss.assets.findOneBy("external_id", a.id);
    if (existingAsset) ss.assets.update(existingAsset.id, assetRow);
    else ss.assets.insert(assetRow);
  }

  for (const inv of config.invoices ?? []) {
    const invRow = {
      company_id: inv.company_id ?? DEFAULT_COMPANY_ID,
      external_id: inv.id,
      job_id: inv.job_id,
      type: inv.type ?? "TaxInvoice",
      stage: inv.stage ?? 2,
      total_ex_tax: inv.total_ex_tax ?? 0,
      total_inc_tax: inv.total_inc_tax ?? 0,
      paid: inv.paid ?? 0,
      date_issued: inv.date_issued ?? now.slice(0, 10),
    };
    const existingInv = ss.invoices.findOneBy("external_id", inv.id);
    if (existingInv) ss.invoices.update(existingInv.id, invRow);
    else ss.invoices.insert(invRow);
  }

  for (const ct of config.contacts ?? []) {
    const row = {
      company_id: ct.company_id ?? DEFAULT_COMPANY_ID,
      external_id: ct.id,
      type: ct.type ?? "Customer",
      customer_id: ct.customer_id ?? null,
      site_id: ct.site_id ?? null,
      salutation: ct.salutation ?? null,
      given_name: ct.given_name,
      family_name: ct.family_name,
      position: ct.position ?? null,
      department: ct.department ?? null,
      email: ct.email ?? null,
      alt_email: ct.alt_email ?? null,
      phone: ct.phone ?? null,
      cell_phone: ct.cell_phone ?? null,
      fax: ct.fax ?? null,
      primary_contact: ct.primary_contact ?? false,
      archived: ct.archived ?? false,
    };
    const existing = ss.contacts.findOneBy("external_id", ct.id);
    if (existing) ss.contacts.update(existing.id, row);
    else ss.contacts.insert(row);
  }

  for (const cr of config.contractors ?? []) {
    const row = {
      company_id: cr.company_id ?? DEFAULT_COMPANY_ID,
      external_id: cr.id,
      company_name: cr.company_name ?? null,
      given_name: cr.given_name ?? null,
      family_name: cr.family_name ?? null,
      email: cr.email ?? null,
      phone: cr.phone ?? null,
      cell_phone: cr.cell_phone ?? null,
      fax: cr.fax ?? null,
      address: null,
      archived: cr.archived ?? false,
    };
    const existing = ss.contractors.findOneBy("external_id", cr.id);
    if (existing) ss.contractors.update(existing.id, row);
    else ss.contractors.insert(row);
  }

  for (const e of config.employees ?? []) {
    const row = {
      company_id: e.company_id ?? DEFAULT_COMPANY_ID,
      external_id: e.id,
      given_name: e.given_name,
      family_name: e.family_name,
      email: e.email ?? null,
      phone: e.phone ?? null,
      active: e.active ?? true,
      archived: e.archived ?? false,
    };
    const existing = ss.employees.findOneBy("external_id", e.id);
    if (existing) ss.employees.update(existing.id, row);
    else ss.employees.insert(row);
  }

  for (const sc of config.schedules ?? []) {
    const row = {
      company_id: sc.company_id ?? DEFAULT_COMPANY_ID,
      external_id: sc.id,
      job_id: sc.job_id,
      section_id: sc.section_id ?? null,
      cost_center_id: sc.cost_center_id ?? null,
      technician_id: sc.technician_id,
      date: sc.date,
      start_time: sc.start_time,
      duration_minutes: sc.duration_minutes,
    };
    const existing = ss.schedules.findOneBy("external_id", sc.id);
    if (existing) ss.schedules.update(existing.id, row);
    else ss.schedules.insert(row);
  }

  for (const at of config.attachments ?? []) {
    const row = {
      company_id: at.company_id ?? DEFAULT_COMPANY_ID,
      external_id: at.id,
      parent_type: at.parent_type,
      parent_id: at.parent_id,
      filename: at.filename,
      description: at.description ?? null,
      mime_type: at.mime_type ?? null,
      size: at.size ?? 0,
      url: at.url ?? `https://agent-emulate.dev/attachments/${at.parent_type}/${at.parent_id}/${at.id}`,
      date_added: at.date_added ?? now,
    };
    const existing = ss.attachments
      .all()
      .find((a) => a.parent_type === at.parent_type && a.parent_id === at.parent_id && a.external_id === at.id);
    if (existing) ss.attachments.update(existing.id, row);
    else ss.attachments.insert(row);
  }

  for (const si of config.stock_items ?? []) {
    const row = {
      company_id: si.company_id ?? DEFAULT_COMPANY_ID,
      external_id: si.id,
      name: si.name,
      part_no: si.part_no,
      description: si.description ?? null,
      group_name: si.group_name ?? null,
      subgroup_name: si.subgroup_name ?? null,
      trade_price_ex_tax: si.trade_price_ex_tax ?? 0,
      trade_price_inc_tax: si.trade_price_inc_tax ?? si.trade_price_ex_tax ?? 0,
      unit_price: si.unit_price ?? si.trade_price_ex_tax ?? 0,
      unit_of_measure: si.unit_of_measure ?? null,
      tax_code_id: si.tax_code_id ?? null,
      supplier_id: si.supplier_id ?? null,
      supplier_name: si.supplier_name ?? null,
      supplier_part_no: si.supplier_part_no ?? null,
      taxable: si.taxable ?? true,
      archived: si.archived ?? false,
    };
    const existing = ss.stockItems.findOneBy("external_id", si.id);
    if (existing) ss.stockItems.update(existing.id, row);
    else ss.stockItems.insert(row);
  }

  for (const v of config.vendors ?? []) {
    const row = {
      company_id: v.company_id ?? DEFAULT_COMPANY_ID,
      external_id: v.id,
      name: v.name,
      ein: null,
      company_no: null,
      website: null,
      email: v.email ?? null,
      phone: v.phone ?? null,
      fax: null,
      address: null,
      archived: v.archived ?? false,
    };
    const existing = ss.vendors.findOneBy("external_id", v.id);
    if (existing) ss.vendors.update(existing.id, row);
    else ss.vendors.insert(row);
  }

  for (const vo of config.vendor_orders ?? []) {
    const row = {
      company_id: vo.company_id ?? DEFAULT_COMPANY_ID,
      external_id: vo.id,
      vendor_id: vo.vendor_id ?? null,
      job_id: vo.job_id ?? null,
      stage: vo.stage ?? "Draft",
      description: vo.description ?? null,
      total_ex_tax: vo.total_ex_tax ?? 0,
      total_inc_tax: vo.total_inc_tax ?? vo.total_ex_tax ?? 0,
      date_issued: vo.date_issued ?? null,
    };
    const existing = ss.vendorOrders.findOneBy("external_id", vo.id);
    if (existing) ss.vendorOrders.update(existing.id, row);
    else ss.vendorOrders.insert(row);
  }

  for (const cp of config.customer_payments ?? []) {
    const row = {
      company_id: cp.company_id ?? DEFAULT_COMPANY_ID,
      external_id: cp.id,
      customer_id: cp.customer_id,
      invoice_id: cp.invoice_id ?? null,
      amount: cp.amount,
      date: cp.date ?? now.slice(0, 10),
      payment_method: cp.payment_method ?? null,
      notes: cp.notes ?? null,
      date_created: now,
      date_modified: now,
    };
    const existing = ss.customerPayments.findOneBy("external_id", cp.id);
    if (existing) ss.customerPayments.update(existing.id, row);
    else ss.customerPayments.insert(row);
  }

  for (const lr of config.labour_rates ?? []) {
    const row = {
      company_id: lr.company_id ?? DEFAULT_COMPANY_ID,
      external_id: lr.id,
      name: lr.name,
      rate: lr.rate,
      cost_rate: lr.cost_rate,
      archived: lr.archived ?? false,
    };
    const existing = ss.labourRates.findOneBy("external_id", lr.id);
    if (existing) ss.labourRates.update(existing.id, row);
    else ss.labourRates.insert(row);
  }

  for (const z of config.zones ?? []) {
    const row = {
      company_id: z.company_id ?? DEFAULT_COMPANY_ID,
      external_id: z.id,
      name: z.name,
    };
    const existing = ss.zones.findOneBy("external_id", z.id);
    if (existing) ss.zones.update(existing.id, row);
    else ss.zones.insert(row);
  }

  for (const cf of config.custom_fields ?? []) {
    const row = {
      company_id: cf.company_id ?? DEFAULT_COMPANY_ID,
      external_id: cf.id,
      name: cf.name,
      entity: cf.entity,
      field_type: cf.field_type ?? "text",
    };
    const existing = ss.customFields.findOneBy("external_id", cf.id);
    if (existing) ss.customFields.update(existing.id, row);
    else ss.customFields.insert(row);
  }

  for (const pb of config.prebuilds ?? []) {
    const row = {
      company_id: pb.company_id ?? DEFAULT_COMPANY_ID,
      external_id: pb.id,
      name: pb.name,
      description: pb.description ?? null,
      archived: pb.archived ?? false,
      date_modified: pb.date_modified ?? now,
    };
    const existing = ss.prebuilds.findOneBy("external_id", pb.id);
    if (existing) ss.prebuilds.update(existing.id, row);
    else ss.prebuilds.insert(row);
  }

  for (const pt of config.plant_types ?? []) {
    const row = {
      company_id: pt.company_id ?? DEFAULT_COMPANY_ID,
      external_id: pt.id,
      name: pt.name,
      description: pt.description ?? null,
      archived: pt.archived ?? false,
    };
    const existing = ss.plantTypes.findOneBy("external_id", pt.id);
    if (existing) ss.plantTypes.update(existing.id, row);
    else ss.plantTypes.insert(row);
  }

  for (const p of config.plants ?? []) {
    const row = {
      company_id: p.company_id ?? DEFAULT_COMPANY_ID,
      external_id: p.id,
      plant_type_id: p.plant_type_id,
      name: p.name,
      serial_number: p.serial_number ?? null,
      description: p.description ?? null,
      archived: p.archived ?? false,
      date_modified: p.date_modified ?? now,
    };
    const existing = ss.plants.findOneBy("external_id", p.id);
    if (existing) ss.plants.update(existing.id, row);
    else ss.plants.insert(row);
  }

  for (const cn of config.credit_notes ?? []) {
    const row = {
      company_id: cn.company_id ?? DEFAULT_COMPANY_ID,
      external_id: cn.id,
      customer_id: cn.customer_id,
      invoice_id: cn.invoice_id ?? null,
      job_id: cn.job_id ?? null,
      total_ex_tax: cn.total_ex_tax ?? 0,
      total_inc_tax: cn.total_inc_tax ?? 0,
      date_issued: cn.date_issued ?? now.slice(0, 10),
      stage: cn.stage ?? 2,
      notes: cn.notes ?? null,
    };
    const existing = ss.creditNotes.findOneBy("external_id", cn.id);
    if (existing) ss.creditNotes.update(existing.id, row);
    else ss.creditNotes.insert(row);
  }

  for (const lead of config.leads ?? []) {
    const row = {
      company_id: lead.company_id ?? DEFAULT_COMPANY_ID,
      external_id: lead.id,
      name: lead.name,
      description: lead.description ?? null,
      customer_id: lead.customer_id ?? null,
      site_id: lead.site_id ?? null,
      status_id: null,
      stage: lead.stage ?? "New",
      salesperson_id: lead.salesperson_id ?? null,
      date_issued: lead.date_issued ?? now.slice(0, 10),
      date_modified: lead.date_modified ?? now,
      tags: lead.tags ?? [],
    };
    const existing = ss.leads.findOneBy("external_id", lead.id);
    if (existing) ss.leads.update(existing.id, row);
    else ss.leads.insert(row);
  }

  for (const ts of config.timesheets ?? []) {
    const row = {
      company_id: ts.company_id ?? DEFAULT_COMPANY_ID,
      external_id: ts.id,
      employee_id: ts.employee_id ?? null,
      contractor_id: ts.contractor_id ?? null,
      job_id: ts.job_id ?? null,
      cost_center_id: ts.cost_center_id ?? null,
      date: ts.date,
      start_time: ts.start_time,
      end_time: ts.end_time ?? null,
      duration_minutes: ts.duration_minutes ?? 0,
      notes: ts.notes ?? null,
    };
    const existing = ss.timesheets.findOneBy("external_id", ts.id);
    if (existing) ss.timesheets.update(existing.id, row);
    else ss.timesheets.insert(row);
  }

  for (const as_ of config.activity_schedules ?? []) {
    const row = {
      company_id: as_.company_id ?? DEFAULT_COMPANY_ID,
      external_id: as_.id,
      technician_id: as_.technician_id,
      date: as_.date,
      start_time: as_.start_time,
      duration_minutes: as_.duration_minutes ?? 60,
      activity_type: as_.activity_type,
      notes: as_.notes ?? null,
    };
    const existing = ss.activitySchedules.findOneBy("external_id", as_.id);
    if (existing) ss.activitySchedules.update(existing.id, row);
    else ss.activitySchedules.insert(row);
  }

  for (const rj of config.recurring_jobs ?? []) {
    const row = {
      company_id: rj.company_id ?? DEFAULT_COMPANY_ID,
      external_id: rj.id,
      name: rj.name,
      description: rj.description ?? null,
      customer_id: rj.customer_id,
      site_id: rj.site_id ?? null,
      stage: rj.stage ?? "Active",
      billing_type: rj.billing_type ?? "TimeAndMaterials",
      frequency: rj.frequency ?? "Monthly",
      start_date: rj.start_date ?? now.slice(0, 10),
      end_date: rj.end_date ?? null,
      date_modified: rj.date_modified ?? now,
    };
    const existing = ss.recurringJobs.findOneBy("external_id", rj.id);
    if (existing) ss.recurringJobs.update(existing.id, row);
    else ss.recurringJobs.insert(row);
  }

  for (const n of config.notes ?? []) {
    const row = {
      company_id: n.company_id ?? DEFAULT_COMPANY_ID,
      external_id: n.id,
      parent_type: n.parent_type,
      parent_id: n.parent_id,
      text: n.text,
      date_created: n.date_created ?? now,
      date_modified: n.date_modified ?? now,
      author_id: n.author_id ?? null,
    };
    const existing = ss.notes
      .all()
      .find((x) => x.parent_type === n.parent_type && x.parent_id === n.parent_id && x.external_id === n.id);
    if (existing) ss.notes.update(existing.id, row);
    else ss.notes.insert(row);
  }

  if (config.swagger_records) seedSimproSwaggerRecords(store, config.swagger_records);
}

/**
 * Project live Simpro state back into the `SimproSeedConfig` shape so the
 * export round-trips through `seedFromConfig` verbatim. Store rows carry an
 * internal auto-`id` plus the config-facing `external_id`; this reverses that
 * mapping (`external_id` → `id`) and re-nests sites under customers and
 * sections/cost_centers under jobs. `company_id` is omitted when it equals the
 * default company, matching the compact seed-file style (`seedFromConfig`
 * re-defaults it). Only the config-supported subset of the ~80 store
 * collections is emitted; OAuth tokens/codes are never exported.
 */
export function storeToSeedConfig(store: Store, _baseUrl: string): SimproSeedConfig {
  const ss = getSimproStore(store);
  const out: SimproSeedConfig = {};

  const oauth = store.getData<{ client_id?: string; client_secret?: string }>("simpro.oauth");
  if (oauth) out.oauth = oauth;
  if (store.getData<boolean>("simpro.rate_limit_enabled")) out.rate_limit_enabled = true;

  // Drop company_id when it is the default company so the export matches the
  // compact seed-file style; seedFromConfig re-defaults missing ids to 0.
  const co = (companyId: number): { company_id?: number } =>
    companyId === DEFAULT_COMPANY_ID ? {} : { company_id: companyId };

  const companies = ss.companies.all();
  if (companies.length) out.companies = companies.map((c) => ({ id: c.company_id, name: c.name }));

  const taxCodes = ss.taxCodes.all();
  if (taxCodes.length)
    out.tax_codes = taxCodes.map((t) => ({ id: t.external_id, ...co(t.company_id), name: t.name, rate: t.rate }));

  const statuses = ss.statuses.all();
  if (statuses.length)
    out.statuses = statuses.map((s) => ({ id: s.external_id, ...co(s.company_id), kind: s.kind, name: s.name }));

  const mccs = ss.masterCostCenters.all();
  if (mccs.length)
    out.master_cost_centers = mccs.map((m) => ({
      id: m.external_id,
      ...co(m.company_id),
      name: m.name,
      income_account: m.income_account,
      expense_account: m.expense_account,
    }));

  const staff = ss.staff.all();
  if (staff.length)
    out.staff = staff.map((s) => ({
      id: s.external_id,
      ...co(s.company_id),
      given_name: s.given_name,
      family_name: s.family_name,
      email: s.email,
    }));

  const customers = ss.customers.all();
  if (customers.length)
    out.customers = customers.map((cu) => {
      const sites = ss.sites.all().filter((st) => st.customer_id === cu.external_id);
      return {
        id: cu.external_id,
        ...co(cu.company_id),
        type: cu.type,
        company_name: cu.company_name,
        given_name: cu.given_name,
        family_name: cu.family_name,
        email: cu.email,
        phone_primary: cu.phone_primary,
        website: cu.website,
        ein: cu.ein,
        address: cu.address,
        tax_code_id: cu.tax_code_id,
        payment_terms: cu.payment_terms,
        archived: cu.archived,
        tags: cu.tags,
        ...(sites.length
          ? { sites: sites.map((st) => ({ id: st.external_id, name: st.name, address: st.address })) }
          : {}),
      };
    });

  const lineItemsFor = (costCenterId: number) => {
    const catalogItems = ss.catalogItems.all().filter((item) => item.cost_center_id === costCenterId);
    const labourItems = ss.labourItems.all().filter((item) => item.cost_center_id === costCenterId);
    const oneOffItems = ss.oneOffItems.all().filter((item) => item.cost_center_id === costCenterId);
    const prebuildItems = ss.prebuildItems.all().filter((item) => item.cost_center_id === costCenterId);
    return {
      ...(catalogItems.length
        ? {
            catalog_items: catalogItems.map((item) => ({
              id: item.external_id,
              stock_item_id: item.stock_item_id,
              name: item.name,
              part_no: item.part_no,
              quantity: item.quantity,
              base_price: item.base_price,
              markup: item.markup,
              sell_price: item.sell_price,
              ex_tax: item.ex_tax,
            })),
          }
        : {}),
      ...(labourItems.length
        ? {
            labour_items: labourItems.map((item) => ({
              id: item.external_id,
              labour_id: item.labour_id,
              name: item.name,
              hours: item.hours,
              labour_rate: item.labour_rate,
              markup: item.markup,
              sell_price: item.sell_price,
              ex_tax: item.ex_tax,
            })),
          }
        : {}),
      ...(oneOffItems.length
        ? {
            one_off_items: oneOffItems.map((item) => ({
              id: item.external_id,
              description: item.description,
              quantity: item.quantity,
              est_cost: item.est_cost,
              act_cost: item.act_cost,
              markup: item.markup,
              sell_price: item.sell_price,
              ex_tax: item.ex_tax,
            })),
          }
        : {}),
      ...(prebuildItems.length
        ? {
            prebuild_items: prebuildItems.map((item) => ({
              id: item.external_id,
              prebuild_id: item.prebuild_id,
              name: item.name,
              quantity: item.quantity,
              cost_price: item.cost_price,
              markup: item.markup,
              sell_price: item.sell_price,
              ex_tax: item.ex_tax,
            })),
          }
        : {}),
    };
  };

  const jobs = ss.jobs.all();
  if (jobs.length)
    out.jobs = jobs.map((j) => {
      const sections = ss.sections.all().filter((sec) => sec.job_id === j.external_id);
      return {
        id: j.external_id,
        ...co(j.company_id),
        type: j.type,
        name: j.name,
        description: j.description,
        customer_id: j.customer_id,
        site_id: j.site_id,
        stage: j.stage,
        order_no: j.order_no,
        project_manager_id: j.project_manager_id,
        salesperson_id: j.salesperson_id,
        status_id: j.status_id,
        date_issued: j.date_issued,
        due_date: j.due_date,
        total_ex_tax: j.total_ex_tax,
        total_tax: j.total_tax,
        total_inc_tax: j.total_inc_tax,
        ...(sections.length
          ? {
              sections: sections.map((sec) => {
                const ccs = ss.costCenters
                  .all()
                  .filter((c) => c.job_id === j.external_id && c.section_id === sec.external_id);
                return {
                  id: sec.external_id,
                  name: sec.name,
                  description: sec.description,
                  ...(ccs.length
                    ? {
                        cost_centers: ccs.map((c) => ({
                          id: c.external_id,
                          master_cost_center_id: c.master_cost_center_id,
                          tax_code_id: c.tax_code_id,
                          name: c.name,
                          description: c.description,
                          billing_type: c.billing_type,
                          stage: c.stage as CostCenterStage,
                          ex_tax: c.ex_tax,
                          inc_tax: c.inc_tax,
                          ...lineItemsFor(c.external_id),
                        })),
                      }
                    : {}),
                };
              }),
            }
          : {}),
      };
    });

  const quotes = ss.quotes.all();
  if (quotes.length)
    out.quotes = quotes.map((q) => {
      const sections = ss.quoteSections.all().filter((sec) => sec.quote_id === q.external_id);
      return {
        id: q.external_id,
        ...co(q.company_id),
        name: q.name,
        description: q.description,
        order_no: q.order_no,
        customer_id: q.customer_id,
        site_id: q.site_id,
        salesperson_id: q.salesperson_id,
        project_manager_id: q.project_manager_id,
        status_id: q.status_id,
        stage: q.stage,
        total_ex_tax: q.total_ex_tax,
        total_tax: q.total_tax,
        total_inc_tax: q.total_inc_tax,
        date_issued: q.date_issued,
        due_date: q.due_date,
        tags: q.tags,
        converted_job_id: q.converted_job_id,
        ...(sections.length
          ? {
              sections: sections.map((sec) => {
                const ccs = ss.quoteCostCenters
                  .all()
                  .filter((c) => c.quote_id === q.external_id && c.section_id === sec.external_id);
                return {
                  id: sec.external_id,
                  name: sec.name,
                  description: sec.description,
                  ...(ccs.length
                    ? {
                        cost_centers: ccs.map((c) => ({
                          id: c.external_id,
                          master_cost_center_id: c.master_cost_center_id,
                          tax_code_id: c.tax_code_id,
                          name: c.name,
                          description: c.description,
                          billing_type: c.billing_type,
                          stage: c.stage as CostCenterStage,
                          ex_tax: c.ex_tax,
                          inc_tax: c.inc_tax,
                          ...lineItemsFor(c.external_id),
                        })),
                      }
                    : {}),
                };
              }),
            }
          : {}),
      };
    });

  const assets = ss.assets.all();
  if (assets.length)
    out.assets = assets.map((a) => ({
      id: a.external_id,
      ...co(a.company_id),
      customer_id: a.customer_id,
      site_id: a.site_id,
      name: a.name,
      description: a.description,
      asset_type: a.asset_type,
      serial_number: a.serial_number,
      status: a.status,
      notes: a.notes,
      date_installed: a.date_installed,
      date_next_service: a.date_next_service,
    }));

  const invoices = ss.invoices.all();
  if (invoices.length)
    out.invoices = invoices.map((iv) => ({
      id: iv.external_id,
      ...co(iv.company_id),
      job_id: iv.job_id,
      type: iv.type,
      stage: iv.stage,
      total_ex_tax: iv.total_ex_tax,
      total_inc_tax: iv.total_inc_tax,
      paid: iv.paid,
      date_issued: iv.date_issued,
    }));

  const contacts = ss.contacts.all();
  if (contacts.length)
    out.contacts = contacts.map((ct) => ({
      id: ct.external_id,
      ...co(ct.company_id),
      type: ct.type,
      customer_id: ct.customer_id,
      site_id: ct.site_id,
      salutation: ct.salutation,
      given_name: ct.given_name,
      family_name: ct.family_name,
      position: ct.position,
      department: ct.department,
      email: ct.email,
      alt_email: ct.alt_email,
      phone: ct.phone,
      cell_phone: ct.cell_phone,
      fax: ct.fax,
      primary_contact: ct.primary_contact,
      archived: ct.archived,
    }));

  const contractors = ss.contractors.all();
  if (contractors.length)
    out.contractors = contractors.map((cr) => ({
      id: cr.external_id,
      ...co(cr.company_id),
      company_name: cr.company_name,
      given_name: cr.given_name,
      family_name: cr.family_name,
      email: cr.email,
      phone: cr.phone,
      cell_phone: cr.cell_phone,
      fax: cr.fax,
      archived: cr.archived,
    }));

  const schedules = ss.schedules.all();
  if (schedules.length)
    out.schedules = schedules.map((sc) => ({
      id: sc.external_id,
      ...co(sc.company_id),
      job_id: sc.job_id,
      section_id: sc.section_id,
      cost_center_id: sc.cost_center_id,
      technician_id: sc.technician_id,
      date: sc.date,
      start_time: sc.start_time,
      duration_minutes: sc.duration_minutes,
    }));

  const attachments = ss.attachments.all();
  if (attachments.length)
    out.attachments = attachments.map((at) => ({
      id: at.external_id,
      ...co(at.company_id),
      parent_type: at.parent_type,
      parent_id: at.parent_id,
      filename: at.filename,
      description: at.description,
      mime_type: at.mime_type,
      size: at.size,
      url: at.url,
      date_added: at.date_added,
    }));

  const stockItems = ss.stockItems.all();
  if (stockItems.length)
    out.stock_items = stockItems.map((si) => ({
      id: si.external_id,
      ...co(si.company_id),
      name: si.name,
      part_no: si.part_no,
      description: si.description,
      group_name: si.group_name,
      subgroup_name: si.subgroup_name,
      unit_of_measure: si.unit_of_measure,
      trade_price_ex_tax: si.trade_price_ex_tax,
      trade_price_inc_tax: si.trade_price_inc_tax,
      unit_price: si.unit_price,
      tax_code_id: si.tax_code_id,
      supplier_id: si.supplier_id,
      supplier_name: si.supplier_name,
      supplier_part_no: si.supplier_part_no,
      taxable: si.taxable,
      archived: si.archived,
    }));

  const vendors = ss.vendors.all();
  if (vendors.length)
    out.vendors = vendors.map((v) => ({
      id: v.external_id,
      ...co(v.company_id),
      name: v.name,
      email: v.email,
      phone: v.phone,
      archived: v.archived,
    }));

  const vendorOrders = ss.vendorOrders.all();
  if (vendorOrders.length)
    out.vendor_orders = vendorOrders.map((vo) => ({
      id: vo.external_id,
      ...co(vo.company_id),
      vendor_id: vo.vendor_id,
      job_id: vo.job_id,
      stage: vo.stage,
      description: vo.description,
      total_ex_tax: vo.total_ex_tax,
      total_inc_tax: vo.total_inc_tax,
      date_issued: vo.date_issued,
    }));

  const customerPayments = ss.customerPayments.all();
  if (customerPayments.length)
    out.customer_payments = customerPayments.map((p) => ({
      id: p.external_id,
      ...co(p.company_id),
      customer_id: p.customer_id,
      invoice_id: p.invoice_id,
      amount: p.amount,
      date: p.date,
      payment_method: p.payment_method,
      notes: p.notes,
    }));

  const labourRates = ss.labourRates.all();
  if (labourRates.length)
    out.labour_rates = labourRates.map((lr) => ({
      id: lr.external_id,
      ...co(lr.company_id),
      name: lr.name,
      rate: lr.rate,
    }));

  const zones = ss.zones.all();
  if (zones.length) out.zones = zones.map((z) => ({ id: z.external_id, ...co(z.company_id), name: z.name }));

  const customFields = ss.customFields.all();
  if (customFields.length)
    out.custom_fields = customFields.map((cf) => ({
      id: cf.external_id,
      ...co(cf.company_id),
      name: cf.name,
      entity: cf.entity,
      field_type: cf.field_type,
    }));

  const prebuilds = ss.prebuilds.all();
  if (prebuilds.length)
    out.prebuilds = prebuilds.map((pb) => ({
      id: pb.external_id,
      ...co(pb.company_id),
      name: pb.name,
      description: pb.description,
      archived: pb.archived,
      date_modified: pb.date_modified,
    }));

  const plantTypes = ss.plantTypes.all();
  if (plantTypes.length)
    out.plant_types = plantTypes.map((pt) => ({
      id: pt.external_id,
      ...co(pt.company_id),
      name: pt.name,
      description: pt.description,
      archived: pt.archived,
    }));

  const plants = ss.plants.all();
  if (plants.length)
    out.plants = plants.map((p) => ({
      id: p.external_id,
      ...co(p.company_id),
      plant_type_id: p.plant_type_id,
      name: p.name,
      serial_number: p.serial_number,
      description: p.description,
      archived: p.archived,
      date_modified: p.date_modified,
    }));

  const creditNotes = ss.creditNotes.all();
  if (creditNotes.length)
    out.credit_notes = creditNotes.map((cn) => ({
      id: cn.external_id,
      ...co(cn.company_id),
      customer_id: cn.customer_id,
      invoice_id: cn.invoice_id,
      job_id: cn.job_id,
      total_ex_tax: cn.total_ex_tax,
      total_inc_tax: cn.total_inc_tax,
      date_issued: cn.date_issued,
      stage: cn.stage,
      notes: cn.notes,
    }));

  const leads = ss.leads.all();
  if (leads.length)
    out.leads = leads.map((lead) => ({
      id: lead.external_id,
      ...co(lead.company_id),
      name: lead.name,
      description: lead.description,
      customer_id: lead.customer_id,
      site_id: lead.site_id,
      stage: lead.stage,
      salesperson_id: lead.salesperson_id,
      date_issued: lead.date_issued,
      date_modified: lead.date_modified,
      tags: lead.tags,
    }));

  const timesheets = ss.timesheets.all();
  if (timesheets.length)
    out.timesheets = timesheets.map((ts) => ({
      id: ts.external_id,
      ...co(ts.company_id),
      employee_id: ts.employee_id,
      contractor_id: ts.contractor_id,
      job_id: ts.job_id,
      cost_center_id: ts.cost_center_id,
      date: ts.date,
      start_time: ts.start_time,
      end_time: ts.end_time,
      duration_minutes: ts.duration_minutes,
      notes: ts.notes,
    }));

  const activitySchedules = ss.activitySchedules.all();
  if (activitySchedules.length)
    out.activity_schedules = activitySchedules.map((a) => ({
      id: a.external_id,
      ...co(a.company_id),
      technician_id: a.technician_id,
      date: a.date,
      start_time: a.start_time,
      duration_minutes: a.duration_minutes,
      activity_type: a.activity_type,
      notes: a.notes,
    }));

  const recurringJobs = ss.recurringJobs.all();
  if (recurringJobs.length)
    out.recurring_jobs = recurringJobs.map((rj) => ({
      id: rj.external_id,
      ...co(rj.company_id),
      name: rj.name,
      description: rj.description,
      customer_id: rj.customer_id,
      site_id: rj.site_id,
      stage: rj.stage,
      billing_type: rj.billing_type,
      frequency: rj.frequency,
      start_date: rj.start_date,
      end_date: rj.end_date,
      date_modified: rj.date_modified,
    }));

  const notes = ss.notes.all();
  if (notes.length)
    out.notes = notes.map((n) => ({
      id: n.external_id,
      ...co(n.company_id),
      parent_type: n.parent_type,
      parent_id: n.parent_id,
      text: n.text,
      date_created: n.date_created,
      date_modified: n.date_modified,
      author_id: n.author_id,
    }));

  const employees = ss.employees.all();
  if (employees.length)
    out.employees = employees.map((e) => ({
      id: e.external_id,
      ...co(e.company_id),
      given_name: e.given_name,
      family_name: e.family_name,
      email: e.email,
      phone: e.phone,
      active: e.active,
      archived: e.archived,
    }));

  const swaggerRecords = exportSimproSwaggerRecords(store);
  if (swaggerRecords) out.swagger_records = swaggerRecords;

  return out;
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const ss = getSimproStore(store);
  if (ss.companies.all().length > 0) return;

  seedFromConfig(store, _baseUrl, {
    companies: [{ id: 0, name: "Emulator Co" }],
    tax_codes: [
      { id: 1, name: "GST", rate: 10 },
      { id: 2, name: "GST Free", rate: 0 },
    ],
    statuses: [
      { id: 1, kind: "job", name: "Pending" },
      { id: 2, kind: "job", name: "In Progress" },
      { id: 3, kind: "job", name: "Complete" },
    ],
    master_cost_centers: [
      { id: 12, name: "Plumbing Materials", income_account: "4-1000" },
      { id: 15, name: "Electrical Labour", income_account: "4-1010" },
    ],
    staff: [{ id: 1, given_name: "Taylor", family_name: "Rivera", email: "taylor@agent-emulate.dev" }],
    customers: [
      {
        id: 200,
        type: "company",
        company_name: "Acme Facilities Pty Ltd",
        email: "ops@agent-emulate.dev",
        sites: [{ id: 55, name: "North Campus Building A" }],
      },
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
            id: 1001,
            name: "Zone 1 – Ground Floor",
            cost_centers: [
              { id: 5001, master_cost_center_id: 12, billing_type: "TimeAndMaterials", stage: 3 },
              { id: 5002, master_cost_center_id: 15, billing_type: "Fixed", stage: 2 },
            ],
          },
          {
            id: 1002,
            name: "Zone 2 – Level 1",
            cost_centers: [
              { id: 5003, master_cost_center_id: 12, billing_type: "TimeAndMaterials", stage: 2 },
              { id: 5004, master_cost_center_id: 15, billing_type: "FlatRate", stage: 2 },
            ],
          },
        ],
      },
    ],
    attachments: [
      {
        id: 9001,
        parent_type: "job",
        parent_id: 12345,
        filename: "sprinkler-scope.pdf",
        description: "Scope of works",
        mime_type: "application/pdf",
        size: 184_320,
      },
      {
        id: 9002,
        parent_type: "customer",
        parent_id: 200,
        filename: "acme-master-service-agreement.pdf",
        description: "MSA (signed)",
        mime_type: "application/pdf",
        size: 231_000,
      },
    ],
  });
}

export const simproPlugin: ServicePlugin = {
  name: "simpro",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    companyRoutes(ctx);
    oauthRoutes(ctx);
    jobRoutes(ctx);
    sectionRoutes(ctx);
    costCenterRoutes(ctx);
    customerRoutes(ctx);
    siteRoutes(ctx);
    staffRoutes(ctx);
    quoteRoutes(ctx);
    invoiceRoutes(ctx);
    scheduleRoutes(ctx);
    assetRoutes(ctx);
    referenceRoutes(ctx);
    contactRoutes(ctx);
    contractorRoutes(ctx);
    attachmentRoutes(ctx);
    paymentRoutes(ctx);
    creditNoteRoutes(ctx);
    vendorRoutes(ctx);
    vendorOrderRoutes(ctx);
    employeeRoutes(ctx);
    leadRoutes(ctx);
    noteRoutes(ctx);
    taskRoutes(ctx);
    setupResourceRoutes(ctx);
    contractorResourceRoutes(ctx);
    costCenterLineItemRoutes(ctx);
    plantRoutes(ctx);
    prebuildRoutes(ctx);
    recurringJobRoutes(ctx);
    recurringInvoiceRoutes(ctx);
    activityScheduleRoutes(ctx);
    quoteSectionRoutes(ctx);
    stockRoutes(ctx);
    timesheetRoutes(ctx);
    vendorSubResourceRoutes(ctx);
    logsAndMiscRoutes(ctx);
    webhookRoutes(ctx);
    simproSpecFallbackRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default simproPlugin;
