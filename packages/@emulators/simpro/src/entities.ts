import type { Entity } from "@emulators/core";

/**
 * All Simpro API responses use PascalCase. The in-store entities use snake_case
 * to match the rest of the emulate codebase; formatters translate at the boundary.
 */

export type JobType = "Service" | "Project" | "Prepaid";
export type JobStage = 2 | 3 | 4 | 5 | 6;
export type CostCenterStage = 2 | 3 | 4 | 5;
export type BillingType = "TimeAndMaterials" | "Fixed" | "FlatRate";

export interface SimproCompany extends Entity {
  company_id: number;
  name: string;
}

export interface SimproMasterCostCenter extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  archived: boolean;
  income_account: string | null;
  expense_account: string | null;
}

export interface SimproTaxCode extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  rate: number;
}

export interface SimproLabourRate extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  rate: number;
  cost_rate?: number;
  archived?: boolean;
}

export interface SimproStatus extends Entity {
  company_id: number;
  external_id: number;
  kind: "job" | "quote";
  name: string;
}

export interface SimproCustomer extends Entity {
  company_id: number;
  external_id: number;
  type: "company" | "individual";
  company_name: string | null;
  given_name: string | null;
  family_name: string | null;
  title: string | null;
  email: string | null;
  phone_primary: string | null;
  website: string | null;
  ein: string | null;
  address: SimproAddress | null;
  tax_code_id: number | null;
  payment_terms: number | null;
  archived: boolean;
  tags: string[];
  custom_fields: SimproCustomFieldValue[];
}

export interface SimproAddress {
  Address?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
}

export interface SimproCustomFieldValue {
  custom_field_id: number;
  value: string;
}

export interface SimproSite extends Entity {
  company_id: number;
  external_id: number;
  customer_id: number;
  name: string;
  address: SimproAddress | null;
  contact_id: number | null;
  archived: boolean;
}

export interface SimproContact extends Entity {
  company_id: number;
  external_id: number;
  site_id: number | null;
  customer_id: number | null;
  type: "Customer" | "Site";
  salutation: string | null;
  given_name: string;
  family_name: string;
  position: string | null;
  department: string | null;
  email: string | null;
  alt_email: string | null;
  phone: string | null;
  cell_phone: string | null;
  fax: string | null;
  primary_contact: boolean;
  archived: boolean;
}

export interface SimproStaff extends Entity {
  company_id: number;
  external_id: number;
  given_name: string;
  family_name: string;
  email: string | null;
  active: boolean;
}

export interface SimproContractor extends Entity {
  company_id: number;
  external_id: number;
  company_name: string | null;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone: string | null;
  cell_phone: string | null;
  fax: string | null;
  address: SimproAddress | null;
  archived: boolean;
}

export interface SimproJob extends Entity {
  company_id: number;
  external_id: number;
  type: JobType;
  name: string;
  description: string | null;
  order_no: string | null;
  request_no: string | null;
  customer_id: number;
  customer_contact_id: number | null;
  site_id: number | null;
  site_contact_id: number | null;
  salesperson_id: number | null;
  project_manager_id: number | null;
  technician_ids: number[];
  stage: JobStage;
  status_id: number | null;
  date_issued: string | null;
  due_date: string | null;
  due_time: string | null;
  tags: string[];
  custom_fields: SimproCustomFieldValue[];
  total_ex_tax: number;
  total_tax: number;
  total_inc_tax: number;
  invoiced_ex_tax: number;
  date_modified: string;
}

export interface SimproSection extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  name: string;
  description: string | null;
  display_order: number;
  date_modified: string;
}

export interface SimproCostCenter extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  section_id: number;
  master_cost_center_id: number | null;
  tax_code_id: number | null;
  name: string;
  description: string | null;
  billing_type: BillingType;
  billable: boolean;
  stage: CostCenterStage;
  ex_tax: number;
  tax: number;
  inc_tax: number;
  invoiced_ex_tax: number;
  markup: number;
  discount: number;
  is_variation: boolean;
  contractor_work_order_id: number | null;
  date_modified: string;
}

export interface SimproCatalogItem extends Entity {
  company_id: number;
  external_id: number;
  cost_center_id: number;
  stock_item_id: number | null;
  name: string;
  part_no: string | null;
  quantity: number;
  base_price: number;
  markup: number;
  sell_price: number;
  ex_tax: number;
}

export interface SimproLabourItem extends Entity {
  company_id: number;
  external_id: number;
  cost_center_id: number;
  labour_id: number;
  name: string;
  hours: number;
  labour_rate: number;
  markup: number;
  sell_price: number;
  ex_tax: number;
}

export interface SimproOneOffItem extends Entity {
  company_id: number;
  external_id: number;
  cost_center_id: number;
  description: string;
  quantity: number;
  est_cost: number;
  act_cost: number;
  markup: number;
  sell_price: number;
  ex_tax: number;
}

export interface SimproPrebuildItem extends Entity {
  company_id: number;
  external_id: number;
  cost_center_id: number;
  prebuild_id: number;
  name: string;
  quantity: number;
  cost_price: number;
  markup: number;
  sell_price: number;
  ex_tax: number;
}

export interface SimproStockItem extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  part_no: string;
  description: string | null;
  group_name: string | null;
  subgroup_name: string | null;
  trade_price_ex_tax: number;
  trade_price_inc_tax: number;
  unit_price: number;
  unit_of_measure: string | null;
  tax_code_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_part_no: string | null;
  taxable: boolean;
  archived: boolean;
}

export interface SimproQuote extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  description: string | null;
  order_no: string | null;
  customer_id: number;
  customer_contact_id: number | null;
  site_id: number | null;
  site_contact_id: number | null;
  salesperson_id: number | null;
  project_manager_id: number | null;
  status_id: number | null;
  stage: "InProgress" | "Complete" | "Approved" | "Cancelled" | "Converted";
  total_ex_tax: number;
  total_tax: number;
  total_inc_tax: number;
  date_issued: string | null;
  due_date: string | null;
  tags: string[];
  converted_job_id: number | null;
  date_modified: string;
}

export interface SimproInvoice extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  type: "TaxInvoice" | "ProgressInvoice" | "Deposit" | "RequestForClaim";
  stage: 2 | 5;
  total_ex_tax: number;
  total_inc_tax: number;
  paid: number;
  date_issued: string | null;
}

export interface SimproPayment extends Entity {
  company_id: number;
  external_id: number;
  customer_id: number;
  invoice_id: number | null;
  amount: number;
  date: string;
  payment_method: string | null;
  notes: string | null;
  date_created: string;
  date_modified: string;
}

export interface SimproCreditNote extends Entity {
  company_id: number;
  external_id: number;
  customer_id: number;
  invoice_id: number | null;
  job_id: number | null;
  total_ex_tax: number;
  total_inc_tax: number;
  date_issued: string;
  stage: 2 | 5;
  notes: string | null;
}

export interface SimproVendor extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  ein: string | null;
  company_no: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  address: Record<string, string> | null;
  archived: boolean;
}

export interface SimproVendorOrder extends Entity {
  company_id: number;
  external_id: number;
  vendor_id: number | null;
  job_id: number | null;
  stage: "Draft" | "Sent" | "PartReceived" | "Received";
  description: string | null;
  total_ex_tax: number;
  total_inc_tax: number;
  date_issued: string | null;
}

export interface SimproSchedule extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  section_id: number | null;
  cost_center_id: number | null;
  technician_id: number;
  date: string;
  start_time: string;
  duration_minutes: number;
}

export interface SimproAsset extends Entity {
  company_id: number;
  external_id: number;
  customer_id: number;
  site_id: number | null;
  name: string;
  description: string | null;
  asset_type: string | null;
  serial_number: string | null;
  status: string | null;
  notes: string | null;
  date_installed: string | null;
  date_next_service: string | null;
  date_modified: string;
}

export interface SimproZone extends Entity {
  company_id: number;
  external_id: number;
  name: string;
}

/**
 * Attachment row. Simpro exposes attachments as nested collections under each
 * parent entity (job, quote, invoice, customer, site, asset). We store them in
 * a single collection keyed by (parent_type, parent_id, external_id) — the
 * parent_type discriminator lets one list endpoint serve all parents without
 * introducing five parallel tables.
 */
export type SimproAttachmentParentType = "job" | "quote" | "invoice" | "customer" | "site" | "asset";

export interface SimproAttachment extends Entity {
  company_id: number;
  external_id: number;
  parent_type: SimproAttachmentParentType;
  parent_id: number;
  filename: string;
  description: string | null;
  mime_type: string | null;
  size: number;
  url: string;
  date_added: string;
}

export interface SimproCustomField extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  entity: "job" | "customer" | "site" | "asset";
  field_type: "text" | "number" | "date" | "dropdown";
}

export interface SimproOAuthCode extends Entity {
  code: string;
  client_id: string;
  redirect_uri: string;
  user_id: number;
  expires_at: number;
}

export interface SimproOAuthToken extends Entity {
  access_token: string;
  refresh_token: string;
  client_id: string;
  user_id: number;
  expires_at: number;
  refresh_expires_at: number;
  revoked: boolean;
}

export interface SimproWebhookSubscription extends Entity {
  company_id: number;
  external_id: number;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
}

export interface SimproWebhookEvent extends Entity {
  company_id: number;
  subscription_id: number | null;
  event: string;
  entity_id: number;
  status: "pending" | "delivered" | "failed";
}

export interface SimproEmployee extends Entity {
  company_id: number;
  external_id: number;
  given_name: string;
  family_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  archived: boolean;
}

export interface SimproLead extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  description: string | null;
  customer_id: number | null;
  site_id: number | null;
  status_id: number | null;
  stage: "New" | "InProgress" | "Won" | "Lost";
  salesperson_id: number | null;
  date_issued: string | null;
  date_modified: string;
  tags: string[];
}

export interface SimproNote extends Entity {
  company_id: number;
  external_id: number;
  parent_type: "job" | "quote" | "customer" | "invoice" | "creditNote" | "recurringJob" | "lead";
  parent_id: number;
  text: string;
  date_created: string;
  date_modified: string;
  author_id: number | null;
}

export interface SimproTask extends Entity {
  company_id: number;
  external_id: number;
  parent_type: "job" | "quote" | "customer" | "global";
  parent_id: number;
  name: string;
  description: string | null;
  due_date: string | null;
  assigned_to_id: number | null;
  completed: boolean;
  date_created: string;
  date_modified: string;
}

export interface SimproSetupCustomField extends Entity {
  company_id: number;
  external_id: number;
  entity_type: string;
  name: string;
  field_type: "text" | "number" | "date" | "dropdown";
  options: string[];
}

export interface SimproSetupTag extends Entity {
  company_id: number;
  external_id: number;
  entity_type: string;
  name: string;
}

export interface SimproSetupCustomerGroup extends Entity {
  company_id: number;
  external_id: number;
  name: string;
}

export interface SimproSetupActivity extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  color: string | null;
  archived: boolean;
}

export interface SimproSetupTeam extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  member_ids: number[];
}

export interface SimproSetupSecurityGroup extends Entity {
  company_id: number;
  external_id: number;
  name: string;
}

export interface SimproSetupStatusCode extends Entity {
  company_id: number;
  external_id: number;
  entity_type: string;
  name: string;
  color: string | null;
}

export interface SimproSetupPaymentMethod extends Entity {
  company_id: number;
  external_id: number;
  name: string;
}

export interface SimproSetupPaymentTerms extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  days: number;
}

export interface SimproSetupArchiveReason extends Entity {
  company_id: number;
  external_id: number;
  entity_type: string;
  name: string;
}

export interface SimproSetupMembership extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  duration_months: number;
  price: number;
}

export interface SimproSetupResponseTime extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  hours: number;
}

export interface SimproSetupChartOfAccounts extends Entity {
  company_id: number;
  external_id: number;
  code: string;
  name: string;
  account_type: string;
}

export interface SimproPrebuild extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  description: string | null;
  archived: boolean;
  date_modified: string;
}

export interface SimproPrebuildGroup extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  parent_group_id: number | null;
}

export interface SimproPlantType extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  description: string | null;
  archived: boolean;
}

export interface SimproPlant extends Entity {
  company_id: number;
  external_id: number;
  plant_type_id: number;
  name: string;
  serial_number: string | null;
  description: string | null;
  archived: boolean;
  date_modified: string;
}

export interface SimproRecurringJob extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  description: string | null;
  customer_id: number;
  site_id: number | null;
  stage: "Active" | "Cancelled" | "Completed";
  billing_type: "TimeAndMaterials" | "Fixed" | "FlatRate";
  frequency: string;
  start_date: string;
  end_date: string | null;
  date_modified: string;
}

export interface SimproRecurringJobSection extends Entity {
  company_id: number;
  external_id: number;
  recurring_job_id: number;
  name: string;
  display_order: number;
}

export interface SimproRecurringJobCostCenter extends Entity {
  company_id: number;
  external_id: number;
  recurring_job_id: number;
  section_id: number;
  name: string;
  billing_type: "TimeAndMaterials" | "Fixed" | "FlatRate";
  ex_tax: number;
  inc_tax: number;
}

export interface SimproRecurringInvoice extends Entity {
  company_id: number;
  external_id: number;
  customer_id: number;
  site_id: number | null;
  stage: "Active" | "Cancelled" | "Completed";
  frequency: string;
  start_date: string;
  next_invoice_date: string | null;
  date_modified: string;
}

export interface SimproRecurringInvoiceSection extends Entity {
  company_id: number;
  external_id: number;
  recurring_invoice_id: number;
  name: string;
  display_order: number;
}

export interface SimproRecurringInvoiceCostCenter extends Entity {
  company_id: number;
  external_id: number;
  recurring_invoice_id: number;
  section_id: number;
  name: string;
  billing_type: "TimeAndMaterials" | "Fixed" | "FlatRate";
  ex_tax: number;
  inc_tax: number;
}

export interface SimproWorkOrder extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  section_id: number | null;
  cost_center_id: number | null;
  name: string;
  description: string | null;
  date_modified: string;
}

export interface SimproContractorInvoice extends Entity {
  company_id: number;
  external_id: number;
  contractor_id: number;
  job_id: number | null;
  stage: "Draft" | "Approved" | "Paid";
  total_ex_tax: number;
  total_inc_tax: number;
  date_issued: string;
  date_modified: string;
}

export interface SimproContractorJob extends Entity {
  company_id: number;
  external_id: number;
  job_id: number;
  section_id: number | null;
  cost_center_id: number | null;
  contractor_id: number;
  description: string | null;
  total_ex_tax: number;
  total_inc_tax: number;
  date_modified: string;
}

export interface SimproVendorBranch extends Entity {
  company_id: number;
  external_id: number;
  vendor_id: number;
  name: string;
  address: Record<string, string> | null;
  phone: string | null;
  email: string | null;
}

export interface SimproVendorContact extends Entity {
  company_id: number;
  external_id: number;
  vendor_id: number;
  given_name: string;
  family_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
}

export interface SimproVendorReceipt extends Entity {
  company_id: number;
  external_id: number;
  vendor_order_id: number;
  date_received: string;
  notes: string | null;
}

export interface SimproVendorOrderCatalog extends Entity {
  company_id: number;
  external_id: number;
  vendor_order_id: number;
  catalog_id: number | null;
  name: string;
  quantity: number;
  unit_price: number;
  total_ex_tax: number;
}

export interface SimproVendorCredit extends Entity {
  company_id: number;
  external_id: number;
  vendor_id: number;
  vendor_order_id: number | null;
  total_ex_tax: number;
  total_inc_tax: number;
  date_issued: string;
}

export interface SimproStorageDevice extends Entity {
  company_id: number;
  external_id: number;
  name: string;
  location: string | null;
  archived: boolean;
}

export interface SimproStockAllocation extends Entity {
  company_id: number;
  external_id: number;
  catalog_id: number;
  job_id: number | null;
  cost_center_id: number | null;
  quantity: number;
  date_allocated: string;
}

export interface SimproStockTake extends Entity {
  company_id: number;
  external_id: number;
  storage_device_id: number | null;
  date_taken: string;
  notes: string | null;
}

export interface SimproStockTransfer extends Entity {
  company_id: number;
  external_id: number;
  from_device_id: number | null;
  to_device_id: number | null;
  catalog_id: number;
  quantity: number;
  date_transferred: string;
}

export interface SimproTimesheet extends Entity {
  company_id: number;
  external_id: number;
  employee_id: number | null;
  contractor_id: number | null;
  job_id: number | null;
  cost_center_id: number | null;
  date: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  notes: string | null;
}

export interface SimproActivitySchedule extends Entity {
  company_id: number;
  external_id: number;
  technician_id: number;
  date: string;
  start_time: string;
  duration_minutes: number;
  activity_type: string;
  notes: string | null;
}

export interface SimproQuoteSection extends Entity {
  company_id: number;
  external_id: number;
  quote_id: number;
  name: string;
  description: string | null;
  display_order: number;
  date_modified: string;
}

export interface SimproQuoteCostCenter extends Entity {
  company_id: number;
  external_id: number;
  quote_id: number;
  section_id: number;
  master_cost_center_id: number | null;
  tax_code_id: number | null;
  name: string;
  description: string | null;
  billing_type: "TimeAndMaterials" | "Fixed" | "FlatRate";
  billable: boolean;
  stage: number;
  ex_tax: number;
  tax: number;
  inc_tax: number;
  invoiced_ex_tax: number;
  markup: number;
  discount: number;
  is_variation: boolean;
  date_modified: string;
}
