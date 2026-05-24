import { Store, type Collection } from "@emulators/core";
import type {
  SimproActivitySchedule,
  SimproAsset,
  SimproAttachment,
  SimproCatalogItem,
  SimproCompany,
  SimproContact,
  SimproContractor,
  SimproContractorInvoice,
  SimproContractorJob,
  SimproCostCenter,
  SimproCreditNote,
  SimproCustomField,
  SimproCustomer,
  SimproEmployee,
  SimproInvoice,
  SimproJob,
  SimproLabourItem,
  SimproLabourRate,
  SimproLead,
  SimproMasterCostCenter,
  SimproNote,
  SimproOAuthCode,
  SimproOAuthToken,
  SimproOneOffItem,
  SimproPayment,
  SimproPlant,
  SimproPlantType,
  SimproPrebuild,
  SimproPrebuildGroup,
  SimproPrebuildItem,
  SimproQuote,
  SimproQuoteCostCenter,
  SimproQuoteSection,
  SimproRecurringInvoice,
  SimproRecurringInvoiceCostCenter,
  SimproRecurringInvoiceSection,
  SimproRecurringJob,
  SimproRecurringJobCostCenter,
  SimproRecurringJobSection,
  SimproSchedule,
  SimproSection,
  SimproSetupActivity,
  SimproSetupArchiveReason,
  SimproSetupChartOfAccounts,
  SimproSetupCustomerGroup,
  SimproSetupCustomField,
  SimproSetupMembership,
  SimproSetupPaymentMethod,
  SimproSetupPaymentTerms,
  SimproSetupResponseTime,
  SimproSetupSecurityGroup,
  SimproSetupStatusCode,
  SimproSetupTag,
  SimproSetupTeam,
  SimproSite,
  SimproStaff,
  SimproStatus,
  SimproStockAllocation,
  SimproStockItem,
  SimproStockTake,
  SimproStockTransfer,
  SimproStorageDevice,
  SimproTask,
  SimproTaxCode,
  SimproTimesheet,
  SimproVendor,
  SimproVendorBranch,
  SimproVendorContact,
  SimproVendorCredit,
  SimproVendorOrder,
  SimproVendorOrderCatalog,
  SimproVendorReceipt,
  SimproWebhookEvent,
  SimproWebhookSubscription,
  SimproWorkOrder,
  SimproZone,
} from "./entities.js";

export interface SimproStore {
  companies: Collection<SimproCompany>;
  masterCostCenters: Collection<SimproMasterCostCenter>;
  taxCodes: Collection<SimproTaxCode>;
  labourRates: Collection<SimproLabourRate>;
  statuses: Collection<SimproStatus>;
  customers: Collection<SimproCustomer>;
  sites: Collection<SimproSite>;
  contacts: Collection<SimproContact>;
  staff: Collection<SimproStaff>;
  contractors: Collection<SimproContractor>;
  jobs: Collection<SimproJob>;
  sections: Collection<SimproSection>;
  costCenters: Collection<SimproCostCenter>;
  catalogItems: Collection<SimproCatalogItem>;
  labourItems: Collection<SimproLabourItem>;
  oneOffItems: Collection<SimproOneOffItem>;
  prebuildItems: Collection<SimproPrebuildItem>;
  stockItems: Collection<SimproStockItem>;
  quotes: Collection<SimproQuote>;
  invoices: Collection<SimproInvoice>;
  customerPayments: Collection<SimproPayment>;
  creditNotes: Collection<SimproCreditNote>;
  vendors: Collection<SimproVendor>;
  vendorOrders: Collection<SimproVendorOrder>;
  schedules: Collection<SimproSchedule>;
  assets: Collection<SimproAsset>;
  zones: Collection<SimproZone>;
  customFields: Collection<SimproCustomField>;
  attachments: Collection<SimproAttachment>;
  oauthCodes: Collection<SimproOAuthCode>;
  oauthTokens: Collection<SimproOAuthToken>;
  webhookSubscriptions: Collection<SimproWebhookSubscription>;
  webhookEvents: Collection<SimproWebhookEvent>;
  employees: Collection<SimproEmployee>;
  leads: Collection<SimproLead>;
  notes: Collection<SimproNote>;
  tasks: Collection<SimproTask>;
  setupCustomFieldDefs: Collection<SimproSetupCustomField>;
  setupTags: Collection<SimproSetupTag>;
  setupCustomerGroups: Collection<SimproSetupCustomerGroup>;
  setupActivities: Collection<SimproSetupActivity>;
  setupTeams: Collection<SimproSetupTeam>;
  setupSecurityGroups: Collection<SimproSetupSecurityGroup>;
  setupStatusCodes: Collection<SimproSetupStatusCode>;
  setupPaymentMethods: Collection<SimproSetupPaymentMethod>;
  setupPaymentTerms: Collection<SimproSetupPaymentTerms>;
  setupArchiveReasons: Collection<SimproSetupArchiveReason>;
  setupMemberships: Collection<SimproSetupMembership>;
  setupResponseTimes: Collection<SimproSetupResponseTime>;
  setupChartOfAccounts: Collection<SimproSetupChartOfAccounts>;
  prebuilds: Collection<SimproPrebuild>;
  prebuildGroups: Collection<SimproPrebuildGroup>;
  plantTypes: Collection<SimproPlantType>;
  plants: Collection<SimproPlant>;
  recurringJobs: Collection<SimproRecurringJob>;
  recurringJobSections: Collection<SimproRecurringJobSection>;
  recurringJobCostCenters: Collection<SimproRecurringJobCostCenter>;
  recurringInvoices: Collection<SimproRecurringInvoice>;
  recurringInvoiceSections: Collection<SimproRecurringInvoiceSection>;
  recurringInvoiceCostCenters: Collection<SimproRecurringInvoiceCostCenter>;
  workOrders: Collection<SimproWorkOrder>;
  contractorInvoices: Collection<SimproContractorInvoice>;
  contractorJobs: Collection<SimproContractorJob>;
  vendorBranches: Collection<SimproVendorBranch>;
  vendorContacts: Collection<SimproVendorContact>;
  vendorReceipts: Collection<SimproVendorReceipt>;
  vendorOrderCatalogs: Collection<SimproVendorOrderCatalog>;
  vendorCredits: Collection<SimproVendorCredit>;
  storageDevices: Collection<SimproStorageDevice>;
  stockAllocations: Collection<SimproStockAllocation>;
  stockTakes: Collection<SimproStockTake>;
  stockTransfers: Collection<SimproStockTransfer>;
  timesheets: Collection<SimproTimesheet>;
  activitySchedules: Collection<SimproActivitySchedule>;
  quoteSections: Collection<SimproQuoteSection>;
  quoteCostCenters: Collection<SimproQuoteCostCenter>;
}

export function getSimproStore(store: Store): SimproStore {
  return {
    companies: store.collection<SimproCompany>("simpro.companies", ["company_id"]),
    masterCostCenters: store.collection<SimproMasterCostCenter>("simpro.master_cost_centers", [
      "company_id",
      "external_id",
    ]),
    taxCodes: store.collection<SimproTaxCode>("simpro.tax_codes", ["company_id", "external_id"]),
    labourRates: store.collection<SimproLabourRate>("simpro.labour_rates", ["company_id", "external_id"]),
    statuses: store.collection<SimproStatus>("simpro.statuses", ["company_id", "external_id", "kind"]),
    customers: store.collection<SimproCustomer>("simpro.customers", ["company_id", "external_id", "type"]),
    sites: store.collection<SimproSite>("simpro.sites", ["company_id", "external_id", "customer_id"]),
    contacts: store.collection<SimproContact>("simpro.contacts", [
      "company_id",
      "external_id",
      "site_id",
      "customer_id",
    ]),
    staff: store.collection<SimproStaff>("simpro.staff", ["company_id", "external_id"]),
    contractors: store.collection<SimproContractor>("simpro.contractors", ["company_id", "external_id"]),
    jobs: store.collection<SimproJob>("simpro.jobs", ["company_id", "external_id", "customer_id", "site_id"]),
    sections: store.collection<SimproSection>("simpro.sections", ["company_id", "external_id", "job_id"]),
    costCenters: store.collection<SimproCostCenter>("simpro.cost_centers", [
      "company_id",
      "external_id",
      "job_id",
      "section_id",
    ]),
    catalogItems: store.collection<SimproCatalogItem>("simpro.catalog_items", [
      "company_id",
      "external_id",
      "cost_center_id",
    ]),
    labourItems: store.collection<SimproLabourItem>("simpro.labour_items", [
      "company_id",
      "external_id",
      "cost_center_id",
    ]),
    oneOffItems: store.collection<SimproOneOffItem>("simpro.oneoff_items", [
      "company_id",
      "external_id",
      "cost_center_id",
    ]),
    prebuildItems: store.collection<SimproPrebuildItem>("simpro.prebuild_items", [
      "company_id",
      "external_id",
      "cost_center_id",
    ]),
    stockItems: store.collection<SimproStockItem>("simpro.stock_items", ["company_id", "external_id"]),
    quotes: store.collection<SimproQuote>("simpro.quotes", ["company_id", "external_id", "customer_id"]),
    invoices: store.collection<SimproInvoice>("simpro.invoices", ["company_id", "external_id", "job_id"]),
    customerPayments: store.collection<SimproPayment>("simpro.customer_payments", [
      "company_id",
      "external_id",
      "customer_id",
      "invoice_id",
    ]),
    creditNotes: store.collection<SimproCreditNote>("simpro.credit_notes", [
      "company_id",
      "external_id",
      "customer_id",
      "invoice_id",
      "job_id",
    ]),
    vendors: store.collection<SimproVendor>("simpro.vendors", ["company_id", "external_id"]),
    vendorOrders: store.collection<SimproVendorOrder>("simpro.vendor_orders", [
      "company_id",
      "external_id",
      "vendor_id",
      "job_id",
    ]),
    schedules: store.collection<SimproSchedule>("simpro.schedules", [
      "company_id",
      "external_id",
      "job_id",
      "technician_id",
    ]),
    assets: store.collection<SimproAsset>("simpro.assets", ["company_id", "external_id", "customer_id"]),
    zones: store.collection<SimproZone>("simpro.zones", ["company_id", "external_id"]),
    customFields: store.collection<SimproCustomField>("simpro.custom_fields", ["company_id", "external_id"]),
    attachments: store.collection<SimproAttachment>("simpro.attachments", [
      "company_id",
      "external_id",
      "parent_type",
      "parent_id",
    ]),
    oauthCodes: store.collection<SimproOAuthCode>("simpro.oauth_codes", ["code"]),
    oauthTokens: store.collection<SimproOAuthToken>("simpro.oauth_tokens", ["access_token", "refresh_token"]),
    webhookSubscriptions: store.collection<SimproWebhookSubscription>("simpro.webhook_subscriptions", [
      "company_id",
      "external_id",
    ]),
    webhookEvents: store.collection<SimproWebhookEvent>("simpro.webhook_events", [
      "company_id",
      "subscription_id",
      "event",
    ]),
    employees: store.collection<SimproEmployee>("simpro.employees", ["company_id", "external_id"]),
    leads: store.collection<SimproLead>("simpro.leads", ["company_id", "external_id"]),
    notes: store.collection<SimproNote>("simpro.notes", ["company_id", "external_id", "parent_type", "parent_id"]),
    tasks: store.collection<SimproTask>("simpro.tasks", ["company_id", "external_id", "parent_type", "parent_id"]),
    setupCustomFieldDefs: store.collection<SimproSetupCustomField>("simpro.setup_custom_field_defs", [
      "company_id",
      "external_id",
      "entity_type",
    ]),
    setupTags: store.collection<SimproSetupTag>("simpro.setup_tags", ["company_id", "external_id", "entity_type"]),
    setupCustomerGroups: store.collection<SimproSetupCustomerGroup>("simpro.setup_customer_groups", [
      "company_id",
      "external_id",
    ]),
    setupActivities: store.collection<SimproSetupActivity>("simpro.setup_activities", ["company_id", "external_id"]),
    setupTeams: store.collection<SimproSetupTeam>("simpro.setup_teams", ["company_id", "external_id"]),
    setupSecurityGroups: store.collection<SimproSetupSecurityGroup>("simpro.setup_security_groups", [
      "company_id",
      "external_id",
    ]),
    setupStatusCodes: store.collection<SimproSetupStatusCode>("simpro.setup_status_codes", [
      "company_id",
      "external_id",
      "entity_type",
    ]),
    setupPaymentMethods: store.collection<SimproSetupPaymentMethod>("simpro.setup_payment_methods", [
      "company_id",
      "external_id",
    ]),
    setupPaymentTerms: store.collection<SimproSetupPaymentTerms>("simpro.setup_payment_terms", [
      "company_id",
      "external_id",
    ]),
    setupArchiveReasons: store.collection<SimproSetupArchiveReason>("simpro.setup_archive_reasons", [
      "company_id",
      "external_id",
      "entity_type",
    ]),
    setupMemberships: store.collection<SimproSetupMembership>("simpro.setup_memberships", [
      "company_id",
      "external_id",
    ]),
    setupResponseTimes: store.collection<SimproSetupResponseTime>("simpro.setup_response_times", [
      "company_id",
      "external_id",
    ]),
    setupChartOfAccounts: store.collection<SimproSetupChartOfAccounts>("simpro.setup_chart_of_accounts", [
      "company_id",
      "external_id",
    ]),
    prebuilds: store.collection<SimproPrebuild>("simpro.prebuilds", ["company_id", "external_id"]),
    prebuildGroups: store.collection<SimproPrebuildGroup>("simpro.prebuild_groups", ["company_id", "external_id"]),
    plantTypes: store.collection<SimproPlantType>("simpro.plant_types", ["company_id", "external_id"]),
    plants: store.collection<SimproPlant>("simpro.plants", ["company_id", "external_id", "plant_type_id"]),
    recurringJobs: store.collection<SimproRecurringJob>("simpro.recurring_jobs", ["company_id", "external_id"]),
    recurringJobSections: store.collection<SimproRecurringJobSection>("simpro.recurring_job_sections", [
      "company_id",
      "external_id",
      "recurring_job_id",
    ]),
    recurringJobCostCenters: store.collection<SimproRecurringJobCostCenter>("simpro.recurring_job_cost_centers", [
      "company_id",
      "external_id",
      "recurring_job_id",
      "section_id",
    ]),
    recurringInvoices: store.collection<SimproRecurringInvoice>("simpro.recurring_invoices", [
      "company_id",
      "external_id",
    ]),
    recurringInvoiceSections: store.collection<SimproRecurringInvoiceSection>("simpro.recurring_invoice_sections", [
      "company_id",
      "external_id",
      "recurring_invoice_id",
    ]),
    recurringInvoiceCostCenters: store.collection<SimproRecurringInvoiceCostCenter>(
      "simpro.recurring_invoice_cost_centers",
      ["company_id", "external_id", "recurring_invoice_id", "section_id"],
    ),
    workOrders: store.collection<SimproWorkOrder>("simpro.work_orders", [
      "company_id",
      "external_id",
      "job_id",
      "cost_center_id",
    ]),
    contractorInvoices: store.collection<SimproContractorInvoice>("simpro.contractor_invoices", [
      "company_id",
      "external_id",
    ]),
    contractorJobs: store.collection<SimproContractorJob>("simpro.contractor_jobs", [
      "company_id",
      "external_id",
      "job_id",
      "cost_center_id",
    ]),
    vendorBranches: store.collection<SimproVendorBranch>("simpro.vendor_branches", [
      "company_id",
      "external_id",
      "vendor_id",
    ]),
    vendorContacts: store.collection<SimproVendorContact>("simpro.vendor_contacts", [
      "company_id",
      "external_id",
      "vendor_id",
    ]),
    vendorReceipts: store.collection<SimproVendorReceipt>("simpro.vendor_receipts", [
      "company_id",
      "external_id",
      "vendor_order_id",
    ]),
    vendorOrderCatalogs: store.collection<SimproVendorOrderCatalog>("simpro.vendor_order_catalogs", [
      "company_id",
      "external_id",
      "vendor_order_id",
    ]),
    vendorCredits: store.collection<SimproVendorCredit>("simpro.vendor_credits", [
      "company_id",
      "external_id",
      "vendor_id",
    ]),
    storageDevices: store.collection<SimproStorageDevice>("simpro.storage_devices", ["company_id", "external_id"]),
    stockAllocations: store.collection<SimproStockAllocation>("simpro.stock_allocations", [
      "company_id",
      "external_id",
    ]),
    stockTakes: store.collection<SimproStockTake>("simpro.stock_takes", ["company_id", "external_id"]),
    stockTransfers: store.collection<SimproStockTransfer>("simpro.stock_transfers", ["company_id", "external_id"]),
    timesheets: store.collection<SimproTimesheet>("simpro.timesheets", ["company_id", "external_id"]),
    activitySchedules: store.collection<SimproActivitySchedule>("simpro.activity_schedules", [
      "company_id",
      "external_id",
    ]),
    quoteSections: store.collection<SimproQuoteSection>("simpro.quote_sections", [
      "company_id",
      "external_id",
      "quote_id",
    ]),
    quoteCostCenters: store.collection<SimproQuoteCostCenter>("simpro.quote_cost_centers", [
      "company_id",
      "external_id",
      "quote_id",
      "section_id",
    ]),
  };
}
