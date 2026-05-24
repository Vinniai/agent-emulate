import type {
  SimproAsset,
  SimproAttachment,
  SimproCatalogItem,
  SimproContact,
  SimproContractor,
  SimproCostCenter,
  SimproCreditNote,
  SimproCustomer,
  SimproInvoice,
  SimproJob,
  SimproLabourItem,
  SimproLabourRate,
  SimproMasterCostCenter,
  SimproOneOffItem,
  SimproPayment,
  SimproPrebuildItem,
  SimproQuote,
  SimproSchedule,
  SimproSection,
  SimproSite,
  SimproStaff,
  SimproStatus,
  SimproStockItem,
  SimproTaxCode,
  SimproVendor,
  SimproVendorOrder,
} from "./entities.js";
import type { SimproStore } from "./store.js";
import { ccStageToString, jobStageToString } from "./helpers.js";

const dateOnly = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
};

// ─── Refs ────────────────────────────────────────────────────────────────────

export function formatCustomerRef(customer: SimproCustomer | undefined) {
  if (!customer) return null;
  return {
    ID: customer.external_id,
    Type: customer.type === "company" ? "Company" : "Individual",
    CompanyName: customer.company_name,
    GivenName: customer.given_name,
    FamilyName: customer.family_name,
  };
}

export function formatSiteRef(site: SimproSite | undefined) {
  if (!site) return null;
  return { ID: site.external_id, Name: site.name };
}

export function formatContactRef(contact: SimproContact | undefined) {
  if (!contact) return null;
  return {
    ID: contact.external_id,
    GivenName: contact.given_name,
    FamilyName: contact.family_name,
  };
}

export function formatStaffRef(staff: SimproStaff | undefined) {
  if (!staff) return null;
  return {
    ID: staff.external_id,
    Name: `${staff.given_name} ${staff.family_name}`.trim(),
    Type: "employee",
    TypeId: staff.external_id,
  };
}

export function formatStatus(status: SimproStatus | undefined) {
  if (!status) return null;
  return { ID: status.external_id, Name: status.name, Kind: status.kind };
}

export function formatTaxCodeRef(tc: SimproTaxCode | undefined) {
  if (!tc) return null;
  return { ID: tc.external_id, Name: tc.name };
}

export function formatMasterCostCenterRef(cc: SimproMasterCostCenter | undefined) {
  if (!cc) return null;
  return { ID: cc.external_id, Name: cc.name };
}

// ─── Reference data ───────────────────────────────────────────────────────────

export function formatMasterCostCenter(cc: SimproMasterCostCenter) {
  return {
    ID: cc.external_id,
    Name: cc.name,
    Archived: cc.archived,
    IncomeAccount: cc.income_account,
    ExpenseAccount: cc.expense_account,
  };
}

export function formatTaxCode(tc: SimproTaxCode) {
  return { ID: tc.external_id, Name: tc.name, Rate: tc.rate };
}

export function formatLabourRate(lr: SimproLabourRate) {
  return {
    ID: lr.external_id,
    Name: lr.name,
    Rate: lr.rate,
    CostRate: lr.cost_rate ?? null,
    Archived: lr.archived ?? false,
  };
}

export function formatStockItem(item: SimproStockItem) {
  return {
    ID: item.external_id,
    Name: item.name,
    PartNo: item.part_no,
    Description: item.description,
    Group: item.group_name ? { Name: item.group_name } : null,
    SubGroup: item.subgroup_name ? { Name: item.subgroup_name } : null,
    UnitOfMeasure: item.unit_of_measure,
    TradePrice: { ExTax: item.trade_price_ex_tax, IncTax: item.trade_price_inc_tax },
    UnitPrice: item.unit_price,
    TaxCode: item.tax_code_id ? { ID: item.tax_code_id } : null,
    Taxable: item.taxable,
    Supplier: item.supplier_id ? { ID: item.supplier_id, Name: item.supplier_name } : null,
    SupplierPartNo: item.supplier_part_no,
    Archived: item.archived,
  };
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export function formatCustomer(c: SimproCustomer) {
  return {
    ID: c.external_id,
    Type: c.type === "company" ? "Company" : "Individual",
    CompanyName: c.company_name,
    GivenName: c.given_name,
    FamilyName: c.family_name,
    Title: c.title,
    Email: c.email,
    Phone: c.phone_primary ?? null,
    AltPhone: null,
    DoNotCall: false,
    CustomerType: "Customer",
    Website: c.website,
    EIN: c.ein,
    Address: c.address ?? {},
    BillingAddress: {},
    Tags: c.tags.map((t) => ({ ID: 0, Name: t })),
    CustomFields: c.custom_fields.map((cf) => ({
      CustomField: { ID: cf.custom_field_id },
      Value: cf.value,
    })),
    PaymentTerms: c.payment_terms ? { Days: c.payment_terms } : null,
    TaxCode: c.tax_code_id ? { ID: c.tax_code_id } : null,
    Archived: c.archived,
    DateCreated: null,
    DateModified: null,
  };
}

// ─── Site ─────────────────────────────────────────────────────────────────────

export function formatSite(s: SimproSite, contact?: SimproContact) {
  return {
    ID: s.external_id,
    Name: s.name,
    Address: s.address ?? {},
    BillingAddress: {},
    BillingContact: null,
    PrimaryContact: contact
      ? {
          ID: contact.external_id,
          GivenName: contact.given_name,
          FamilyName: contact.family_name,
          Email: contact.email,
          WorkPhone: contact.phone,
        }
      : null,
    PublicNotes: null,
    PrivateNotes: null,
    PreferredTechs: [],
    PreferredTechnicians: [],
    CustomFields: [],
    Archived: s.archived,
    DateModified: null,
  };
}

// ─── Contact ─────────────────────────────────────────────────────────────────

export function formatContact(contact: SimproContact) {
  return {
    ID: contact.external_id,
    Title: contact.salutation,
    GivenName: contact.given_name,
    FamilyName: contact.family_name,
    Email: contact.email,
    WorkPhone: contact.phone,
    Fax: contact.fax,
    CellPhone: contact.cell_phone,
    AltPhone: null,
    Department: contact.department,
    Position: contact.position,
    PrimaryContact: contact.primary_contact,
    Notes: null,
    CustomFields: [],
    Archived: contact.archived,
    Customer: contact.customer_id ? { ID: contact.customer_id } : null,
    Site: contact.site_id ? { ID: contact.site_id } : null,
  };
}

// ─── Staff / Employee ─────────────────────────────────────────────────────────

export function formatStaff(s: SimproStaff) {
  return {
    ID: s.external_id,
    Name: `${s.given_name} ${s.family_name}`.trim(),
    GivenName: s.given_name,
    FamilyName: s.family_name,
    Position: null,
    Availability: null,
    Address: null,
    PrimaryContact: null,
    EmergencyContact: null,
    AccountSetup: { Email: s.email },
    UserProfile: null,
    Active: s.active,
    DateCreated: null,
    DateModified: null,
  };
}

// ─── Contractor ───────────────────────────────────────────────────────────────

export function formatContractor(c: SimproContractor) {
  return {
    ID: c.external_id,
    Name: c.company_name ?? `${c.given_name ?? ""} ${c.family_name ?? ""}`.trim(),
    CompanyName: c.company_name,
    GivenName: c.given_name,
    FamilyName: c.family_name,
    Position: null,
    Availability: null,
    Address: c.address,
    PrimaryContact: null,
    EmergencyContact: null,
    AccountSetup: { Email: c.email },
    UserProfile: null,
    Phone: c.phone,
    CellPhone: c.cell_phone,
    Fax: c.fax,
    Archived: c.archived,
    DateCreated: null,
    DateModified: null,
  };
}

// ─── Job ──────────────────────────────────────────────────────────────────────

export interface FormatJobOptions {
  displayAll?: boolean;
  ss?: SimproStore;
}

export function formatJob(job: SimproJob, opts: FormatJobOptions = {}) {
  const { displayAll = false, ss } = opts;

  const customer = ss?.customers.findOneBy("external_id", job.customer_id);
  const site = job.site_id && ss ? (ss.sites.findOneBy("external_id", job.site_id) ?? undefined) : undefined;
  const customerContact =
    job.customer_contact_id && ss
      ? (ss.contacts.findOneBy("external_id", job.customer_contact_id) ?? undefined)
      : undefined;
  const siteContact =
    job.site_contact_id && ss ? (ss.contacts.findOneBy("external_id", job.site_contact_id) ?? undefined) : undefined;
  const salesperson =
    job.salesperson_id && ss ? (ss.staff.findOneBy("external_id", job.salesperson_id) ?? undefined) : undefined;
  const projectManager =
    job.project_manager_id && ss ? (ss.staff.findOneBy("external_id", job.project_manager_id) ?? undefined) : undefined;
  const status = job.status_id && ss ? (ss.statuses.findOneBy("external_id", job.status_id) ?? undefined) : undefined;
  const technicians = ss
    ? job.technician_ids
        .map((id) => ss.staff.findOneBy("external_id", id))
        .filter((t): t is SimproStaff => !!t)
        .map(formatStaffRef)
    : [];

  const base: Record<string, unknown> = {
    ID: job.external_id,
    Type: job.type,
    Customer: formatCustomerRef(customer) ?? { ID: job.customer_id },
    CustomerContract: { ID: null, Name: null, StartDate: null, EndDate: null, ContractNo: null },
    AdditionalContacts: [],
    Site: formatSiteRef(site) ?? (job.site_id ? { ID: job.site_id, Name: null } : null),
    SiteContact: formatContactRef(siteContact),
    CustomerContact: formatContactRef(customerContact),
    OrderNo: job.order_no,
    RequestNo: job.request_no,
    Name: job.name,
    Description: job.description,
    Notes: null,
    DateIssued: dateOnly(job.date_issued),
    DueDate: dateOnly(job.due_date),
    DueTime: job.due_time,
    Tags: job.tags.map((t) => ({ ID: 0, Name: t })),
    Salesperson: formatStaffRef(salesperson),
    ProjectManager: formatStaffRef(projectManager),
    Technicians: technicians,
    Stage: jobStageToString(job.stage),
    Status: formatStatus(status),
    IsVariation: false,
    LinkedVariations: [],
    ConvertedFromQuote: null,
    ConvertedFrom: null,
    AutoAdjustStatus: false,
    IsRetentionEnabled: false,
    Total: {
      ExTax: job.total_ex_tax,
      Tax: job.total_tax,
      IncTax: job.total_inc_tax,
      InvoicedExTax: job.invoiced_ex_tax,
    },
    Totals: {
      ExTax: job.total_ex_tax,
      Tax: job.total_tax,
      IncTax: job.total_inc_tax,
    },
    CustomFields: job.custom_fields.map((cf) => ({
      CustomField: { ID: cf.custom_field_id },
      Value: cf.value,
    })),
    STC: null,
    DateModified: job.date_modified,
  };

  if (displayAll && ss) {
    const sections = ss.sections
      .findBy("job_id", job.external_id)
      .sort((a, b) => a.display_order - b.display_order)
      .map((section) => formatSection(section, { displayAll: true, ss }));
    base.Sections = sections;
  }

  return base;
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function formatSection(section: SimproSection, opts: FormatJobOptions = {}) {
  const { displayAll = false, ss } = opts;
  const base: Record<string, unknown> = {
    ID: section.external_id,
    Name: section.name,
    Description: section.description,
    IsVariation: false,
    IsVariationRetention: false,
    DisplayOrder: section.display_order,
    DateModified: section.date_modified,
  };
  if (displayAll && ss) {
    base.CostCenters = ss.costCenters
      .findBy("section_id", section.external_id)
      .map((cc) => formatCostCenter(cc, { displayAll: true, ss }));
  }
  return base;
}

// ─── CostCenter ───────────────────────────────────────────────────────────────

export function formatCostCenter(cc: SimproCostCenter, opts: FormatJobOptions = {}) {
  const { displayAll = false, ss } = opts;
  const masterCostCenter =
    cc.master_cost_center_id && ss
      ? (ss.masterCostCenters.findOneBy("external_id", cc.master_cost_center_id) ?? undefined)
      : undefined;
  const taxCode =
    cc.tax_code_id && ss ? (ss.taxCodes.findOneBy("external_id", cc.tax_code_id) ?? undefined) : undefined;

  const base: Record<string, unknown> = {
    ID: cc.external_id,
    CostCenter: formatMasterCostCenterRef(masterCostCenter),
    JobID: cc.job_id,
    Name: cc.name,
    Header: null,
    Site: null,
    Description: cc.description,
    Notes: null,
    OrderNo: null,
    AutoAdjustDates: false,
    BillingType: cc.billing_type,
    Billable: cc.billable,
    Stage: ccStageToString(cc.stage),
    Status: null,
    IsVariation: cc.is_variation,
    ContractorWorkOrder: cc.contractor_work_order_id ? { ID: cc.contractor_work_order_id } : null,
    Total: {
      ExTax: cc.ex_tax,
      Tax: cc.tax,
      IncTax: cc.inc_tax,
      InvoicedExTax: cc.invoiced_ex_tax,
    },
    Markup: cc.markup,
    Discount: cc.discount,
    TaxCode: formatTaxCodeRef(taxCode),
    DateModified: cc.date_modified,
  };

  if (displayAll && ss) {
    base.Items = {
      CatalogItems: ss.catalogItems.findBy("cost_center_id", cc.external_id).map(formatCatalogItem),
      LabourItems: ss.labourItems.findBy("cost_center_id", cc.external_id).map(formatLabourItem),
      OneOffItems: ss.oneOffItems.findBy("cost_center_id", cc.external_id).map(formatOneOffItem),
      PrebuildItems: ss.prebuildItems.findBy("cost_center_id", cc.external_id).map(formatPrebuildItem),
      ServiceFeeItems: [],
      StockItems: [],
    };
  }

  return base;
}

// ─── Line items ───────────────────────────────────────────────────────────────

export function formatCatalogItem(item: SimproCatalogItem) {
  return {
    Type: "Catalog" as const,
    StockItemID: item.stock_item_id,
    Name: item.name,
    PartNo: item.part_no,
    Quantity: item.quantity,
    BasePrice: item.base_price,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

export function formatLabourItem(item: SimproLabourItem) {
  return {
    Type: "Labour" as const,
    LabourID: item.labour_id,
    Name: item.name,
    Hours: item.hours,
    LabourRate: item.labour_rate,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

export function formatOneOffItem(item: SimproOneOffItem) {
  return {
    Type: "OneOff" as const,
    Description: item.description,
    Quantity: item.quantity,
    EstCost: item.est_cost,
    ActCost: item.act_cost,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

export function formatPrebuildItem(item: SimproPrebuildItem) {
  return {
    Type: "Prebuild" as const,
    PrebuildID: item.prebuild_id,
    Name: item.name,
    Quantity: item.quantity,
    CostPrice: item.cost_price,
    Markup: item.markup,
    SellPrice: item.sell_price,
    ExTax: item.ex_tax,
  };
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export function formatQuote(q: SimproQuote, ss?: SimproStore) {
  const customer = ss?.customers.findOneBy("external_id", q.customer_id);
  const site = q.site_id && ss ? (ss.sites.findOneBy("external_id", q.site_id) ?? undefined) : undefined;
  const customerContact =
    q.customer_contact_id && ss
      ? (ss.contacts.findOneBy("external_id", q.customer_contact_id) ?? undefined)
      : undefined;
  const siteContact =
    q.site_contact_id && ss ? (ss.contacts.findOneBy("external_id", q.site_contact_id) ?? undefined) : undefined;
  const salesperson =
    q.salesperson_id && ss ? (ss.staff.findOneBy("external_id", q.salesperson_id) ?? undefined) : undefined;
  const projectManager =
    q.project_manager_id && ss ? (ss.staff.findOneBy("external_id", q.project_manager_id) ?? undefined) : undefined;
  const status = q.status_id && ss ? (ss.statuses.findOneBy("external_id", q.status_id) ?? undefined) : undefined;

  return {
    ID: q.external_id,
    Name: q.name,
    Description: q.description,
    Notes: null,
    Type: "Quote",
    OrderNo: q.order_no,
    Customer: formatCustomerRef(customer) ?? { ID: q.customer_id },
    AdditionalCustomers: [],
    CustomerContact: formatContactRef(customerContact),
    AdditionalContacts: [],
    Site: formatSiteRef(site) ?? (q.site_id ? { ID: q.site_id, Name: null } : null),
    SiteContact: formatContactRef(siteContact),
    ConvertedFromLead: null,
    Salesperson: formatStaffRef(salesperson),
    ProjectManager: formatStaffRef(projectManager),
    Technicians: [],
    Stage: q.stage,
    Status: formatStatus(status),
    Total: { ExTax: q.total_ex_tax, Tax: q.total_tax, IncTax: q.total_inc_tax },
    DateIssued: dateOnly(q.date_issued),
    DueDate: dateOnly(q.due_date),
    Tags: q.tags.map((t) => ({ ID: 0, Name: t })),
    ConvertedJob: q.converted_job_id ? { ID: q.converted_job_id } : null,
    DateModified: q.date_modified,
  };
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export function formatInvoice(i: SimproInvoice, ss?: SimproStore) {
  const job = ss?.jobs.findOneBy("external_id", i.job_id);
  const customer = job && ss ? ss.customers.findOneBy("external_id", job.customer_id) : undefined;
  const balanceDue = Math.max(0, i.total_inc_tax - i.paid);
  return {
    ID: i.external_id,
    InternalID: String(i.external_id),
    Type: i.type,
    Customer: formatCustomerRef(customer) ?? (job ? { ID: job.customer_id } : null),
    Jobs: [
      {
        ID: i.job_id,
        Description: job?.name ?? null,
        Total: { ExTax: i.total_ex_tax, Tax: i.total_inc_tax - i.total_ex_tax, IncTax: i.total_inc_tax },
      },
    ],
    RecurringInvoice: null,
    DateIssued: dateOnly(i.date_issued),
    Period: { StartDate: dateOnly(i.date_issued), EndDate: dateOnly(i.date_issued) },
    PaymentTermID: null,
    PaymentTerms: null,
    ProgressClaimNumber: null,
    IsFinalClaim: false,
    Stage: i.stage === 5 ? "Approved" : "Pending",
    PerItem: false,
    OrderNo: null,
    LatePaymentFee: false,
    ExchangeRate: 1,
    Status: null,
    AutoAdjustStatus: false,
    Description: null,
    Notes: null,
    Total: {
      ExTax: i.total_ex_tax,
      IncTax: i.total_inc_tax,
      Tax: i.total_inc_tax - i.total_ex_tax,
      ReverseChargeTax: 0,
      LatePaymentFee: 0,
      AmountApplied: i.paid,
      BalanceDue: balanceDue,
    },
    IsRetainage: false,
    Retainage: [],
    RetainageRebate: null,
    IsPaid: i.paid >= i.total_inc_tax && i.total_inc_tax > 0,
    DatePaid: null,
    Currency: "AUD",
    DateCreated: dateOnly(i.date_issued),
    DateModified: dateOnly(i.date_issued),
    CustomFields: [],
  };
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export function formatSchedule(s: SimproSchedule) {
  const [h, m] = s.start_time.split(":").map(Number);
  const endMinutes = h * 60 + m + s.duration_minutes;
  const endH = Math.floor(endMinutes / 60) % 24;
  const endM = endMinutes % 60;
  const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  const durationHours = s.duration_minutes / 60;
  return {
    ID: s.external_id,
    Type: "job",
    // Job-type schedules encode the parent as "{jobId}-{costCenterId}" per the
    // SimPro swagger; cost_center_id is optional in seed data.
    Reference: s.cost_center_id != null ? `${s.job_id}-${s.cost_center_id}` : String(s.job_id),
    TotalHours: durationHours,
    Notes: null,
    Staff: { ID: s.technician_id, Name: null, Type: "employee", TypeId: s.technician_id },
    Date: s.date,
    Blocks: [
      {
        Hrs: durationHours,
        StartTime: s.start_time,
        EndTime: endTime,
        ISO8601StartTime: `${s.date}T${s.start_time}:00`,
        ISO8601EndTime: `${s.date}T${endTime}:00`,
        ScheduleRate: { ID: null, Name: "Standard" },
      },
    ],
    _href: `/api/v1.0/companies/${s.company_id}/schedules/${s.external_id}`,
    DateModified: s.date,
    Project: null,
  };
}

// ─── Attachment ───────────────────────────────────────────────────────────────

export function formatAttachment(a: SimproAttachment) {
  return {
    ID: a.external_id,
    Filename: a.filename,
    Description: a.description,
    MimeType: a.mime_type,
    Size: a.size,
    Url: a.url,
    DateAdded: a.date_added,
  };
}

// ─── Asset ────────────────────────────────────────────────────────────────────

export function formatAsset(a: SimproAsset, ss?: SimproStore) {
  const customer = ss?.customers.findOneBy("external_id", a.customer_id);
  const site = a.site_id && ss ? (ss.sites.findOneBy("external_id", a.site_id) ?? undefined) : undefined;
  return {
    ID: a.external_id,
    Name: a.name,
    Description: a.description,
    Customer: formatCustomerRef(customer) ?? { ID: a.customer_id },
    Site: formatSiteRef(site) ?? (a.site_id ? { ID: a.site_id, Name: null } : null),
    AssetType: a.asset_type ? { Name: a.asset_type } : null,
    SerialNo: a.serial_number,
    Notes: a.notes,
    Status: a.status,
    DateInstalled: dateOnly(a.date_installed),
    DateNextService: dateOnly(a.date_next_service),
    DateModified: a.date_modified,
  };
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export function formatPayment(p: SimproPayment, ss?: SimproStore) {
  const customer = ss?.customers.findOneBy("external_id", p.customer_id);
  return {
    ID: p.external_id,
    Customer: formatCustomerRef(customer) ?? { ID: p.customer_id },
    Payment: {
      PaymentMethod: p.payment_method,
      Status: "Approved",
      DepositAccount: null,
      Date: p.date,
      Amount: p.amount,
      FinanceCharge: 0,
      CheckNo: null,
    },
    Invoices: p.invoice_id ? [{ ID: p.invoice_id }] : [],
    Notes: p.notes,
    DateCreated: p.date_created,
    DateModified: p.date_modified,
  };
}

// ─── Credit Note ──────────────────────────────────────────────────────────────

export function formatCreditNote(cn: SimproCreditNote, ss?: SimproStore) {
  const customer = ss?.customers.findOneBy("external_id", cn.customer_id);
  const job = cn.job_id && ss ? ss.jobs.findOneBy("external_id", cn.job_id) : undefined;
  return {
    ID: cn.external_id,
    InternalID: String(cn.external_id),
    Type: "CreditNote",
    Customer: formatCustomerRef(customer) ?? { ID: cn.customer_id },
    InvoiceNo: cn.invoice_id,
    Jobs: job ? [{ ID: job.external_id, Description: job.name }] : [],
    Stage: cn.stage === 5 ? "Approved" : "Pending",
    DateIssued: dateOnly(cn.date_issued),
    Total: {
      ExTax: cn.total_ex_tax,
      IncTax: cn.total_inc_tax,
      Tax: cn.total_inc_tax - cn.total_ex_tax,
    },
    Notes: cn.notes,
    Currency: "AUD",
    DateModified: dateOnly(cn.date_issued),
  };
}

// ─── Vendor ───────────────────────────────────────────────────────────────────

export function formatVendor(v: SimproVendor) {
  return {
    ID: v.external_id,
    Name: v.name,
    EIN: v.ein,
    CompanyNo: v.company_no,
    Website: v.website,
    Email: v.email,
    Phone: v.phone,
    Fax: v.fax,
    Address: v.address ?? {},
    BillingAddress: {},
    Archived: v.archived,
  };
}

// ─── Vendor Order ─────────────────────────────────────────────────────────────

export function formatVendorOrder(vo: SimproVendorOrder, ss?: SimproStore) {
  const vendor = vo.vendor_id && ss ? ss.vendors.findOneBy("external_id", vo.vendor_id) : undefined;
  const job = vo.job_id && ss ? ss.jobs.findOneBy("external_id", vo.job_id) : undefined;
  return {
    ID: vo.external_id,
    Type: null,
    Description: vo.description,
    IsInventoryItem: false,
    Stage: vo.stage,
    Vendor: vendor ? { ID: vendor.external_id, Name: vendor.name } : vo.vendor_id ? { ID: vo.vendor_id } : null,
    Job: job ? { ID: job.external_id, Name: job.name } : vo.job_id ? { ID: vo.job_id } : null,
    Totals: { ExTax: vo.total_ex_tax, IncTax: vo.total_inc_tax },
    DateIssued: dateOnly(vo.date_issued),
    DateModified: dateOnly(vo.date_issued),
  };
}
