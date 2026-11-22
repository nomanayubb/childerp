// Central definition of every ERP entity. The UI, database tables and
// CRUD logic are all generated from this file.

export type FieldType =
  | "text" | "number" | "money" | "date" | "select"
  | "ref" | "textarea" | "bool" | "email" | "phone";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  ref?: string;          // entity key for type "ref"
  refWhere?: string;     // extra SQL filter for ref dropdown
  default?: string | number;
  list?: boolean;        // show as column in list view
  readonly?: boolean;    // computed / system managed
  hidden?: boolean;      // stored but not shown in form
  help?: string;
}

export interface Action {
  key: string;
  label: string;
  from?: string[];       // statuses the button is available in
  style?: "primary" | "danger";
  confirm?: string;
}

export interface Entity {
  key: string;
  table?: string;
  module: string;
  also?: string[];
  label: string;
  plural: string;
  fields: Field[];
  lines?: Field[];
  linesLabel?: string;
  linesReadonly?: boolean;
  labelSql?: string;
  numbered?: string;
  trade?: boolean;
  lock?: string[];
  actions?: Action[];
  listActions?: Action[];
  where?: string;
  defaults?: Record<string, string | number>;
  searchFields?: string[];
  noCreate?: boolean;
  print?: boolean;
  panel?: string;
  sort?: string;
}

// ---- field helpers -------------------------------------------------------
type O = Partial<Field>;
const t = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "text", ...o });
const ta = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "textarea", ...o });
const n = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "number", ...o });
const m = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "money", ...o });
const d = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "date", ...o });
const s = (name: string, label: string, options: string[], o: O = {}): Field => ({ name, label, type: "select", options, default: options[0], ...o });
const r = (name: string, label: string, ref: string, o: O = {}): Field => ({ name, label, type: "ref", ref, ...o });
const b = (name: string, label: string, o: O = {}): Field => ({ name, label, type: "bool", ...o });
const status = (options: string[]): Field => s("status", "Status", options, { readonly: true, list: true });

const tradeTotals = (): Field[] => [
  m("subtotal", "Subtotal", { readonly: true }),
  m("discount", "Discount", { default: 0 }),
  m("tax_amount", "Tax", { readonly: true }),
  m("total", "Total", { readonly: true, list: true }),
];

const tradeLines = (): Field[] => [
  r("item_id", "Item", "items"),
  t("description", "Description"),
  n("qty", "Qty", { default: 1 }),
  m("rate", "Rate", { default: 0 }),
  n("tax_percent", "Tax %", { default: 0 }),
  m("amount", "Amount", { readonly: true }),
];

// FBR reference values (Technical Specification for DI API v1.12).
export const FBR_PROVINCES = ["", "PUNJAB", "SINDH", "KHYBER PAKHTUNKHWA", "BALOCHISTAN", "CAPITAL TERRITORY", "AZAD JAMMU AND KASHMIR", "GILGIT BALTISTAN"];
export const FBR_SALE_TYPES = ["Goods at Standard Rate (default)", "Goods at Reduced Rate", "Exempt Goods", "Goods at zero-rate"];
export const FBR_SCENARIOS = ["SN001", "SN002", "SN005", "SN006", "SN007", "SN026", "SN027", "SN028"];

export const MODULES: { key: string; label: string; icon: string; desc: string }[] = [
  { key: "sales", label: "Sales", icon: "🧾", desc: "Quotations, orders, invoicing and payment recovery" },
  { key: "procurement", label: "Procurement", icon: "🛒", desc: "Vendors, purchase orders, bills and approvals" },
  { key: "inventory", label: "Inventory & Warehouse", icon: "📦", desc: "Multi-warehouse stock, barcodes and transfers" },
  { key: "manufacturing", label: "Assembling & Production", icon: "🏭", desc: "Bills of materials, production orders and job costing" },
  { key: "accounting", label: "Financial Management", icon: "📒", desc: "General ledger, budgets and cash flow" },
  { key: "hr", label: "HRM & Payroll", icon: "👥", desc: "Employees, attendance, leave, shifts and payroll" },
  { key: "crm", label: "CRM", icon: "🤝", desc: "Leads, customers, activities and campaigns" },
  { key: "projects", label: "Project Management", icon: "📐", desc: "Planning, BOQ, time tracking and project budgets" },
  { key: "assets", label: "Asset Management", icon: "🏗️", desc: "Registration, depreciation, disposal, revaluation" },
  { key: "pos", label: "POS", icon: "🏪", desc: "Multi-outlet retail billing and outlet stock" },
  { key: "reports", label: "Reports", icon: "📊", desc: "P&L, balance sheet, inventory, sales and purchase reports" },
];

export const ENTITIES: Entity[] = [
  // ------------------------------------------------------------- CRM / parties
  {
    key: "customers", module: "crm", also: ["sales"], label: "Customer", plural: "Customers",
    fields: [
      t("name", "Name", { required: true, list: true }),
      phone("phone", "Phone", { list: true }),
      { name: "email", label: "Email", type: "email" },
      t("ntn", "NTN / CNIC", { list: true, help: "7-digit NTN or 13-digit CNIC (dashes are ignored). Needed on FBR invoices for registered buyers." }),
      s("registration_type", "Sales tax registration", ["Registered", "Unregistered"], { help: "Sent to FBR as the buyer registration type." }),
      s("province", "Province", FBR_PROVINCES, { help: "Required on FBR invoices." }),
      t("city", "City", { list: true }),
      ta("address", "Address"),
      m("credit_limit", "Credit limit", { default: 0 }),
    ],
    labelSql: "name", searchFields: ["name", "phone", "ntn"], panel: "customer",
  },
  {
    key: "leads", module: "crm", label: "Lead", plural: "Leads",
    fields: [
      t("name", "Contact name", { required: true, list: true }),
      t("company", "Company", { list: true }),
      phone("phone", "Phone"),
      { name: "email", label: "Email", type: "email" },
      s("source", "Source", ["WhatsApp", "Website", "Referral", "Facebook", "Exhibition", "Cold call", "Other"], { list: true }),
      s("status", "Status", ["New", "Contacted", "Qualified", "Won", "Lost"], { list: true }),
      m("expected_value", "Expected value", { default: 0, list: true }),
      t("owner", "Assigned to"),
      ta("notes", "Notes"),
    ],
    labelSql: "name", searchFields: ["name", "company", "phone"],
    actions: [{ key: "convert", label: "Convert to customer", from: ["New", "Contacted", "Qualified"], style: "primary" }],
  },
  {
    key: "activities", module: "crm", label: "Sales activity", plural: "Sales Activities",
    fields: [
      s("type", "Type", ["Call", "Meeting", "Email", "Visit", "Task"], { list: true }),
      t("subject", "Subject", { required: true, list: true }),
      r("lead_id", "Lead", "leads"),
      r("customer_id", "Customer", "customers", { list: true }),
      d("date", "Date", { required: true, list: true }),
      b("done", "Completed", { list: true }),
      ta("notes", "Notes"),
    ],
    labelSql: "subject", sort: "date DESC",
  },
  {
    key: "campaigns", module: "crm", label: "Campaign", plural: "CRM Campaigns",
    fields: [
      t("name", "Campaign name", { required: true, list: true }),
      s("channel", "Channel", ["WhatsApp", "Email", "SMS", "Social media", "Events", "Print"], { list: true }),
      d("start_date", "Start", { list: true }),
      d("end_date", "End"),
      m("budget", "Budget", { default: 0, list: true }),
      m("spent", "Spent", { default: 0 }),
      n("leads_generated", "Leads generated", { default: 0, list: true }),
      s("status", "Status", ["Planned", "Active", "Completed"], { list: true }),
      ta("notes", "Notes"),
    ],
    labelSql: "name",
  },

  // -------------------------------------------------------------- Inventory
  {
    key: "items", module: "inventory", also: ["sales", "procurement", "manufacturing"], label: "Item", plural: "Items",
    fields: [
      t("code", "Code / SKU", { required: true, list: true }),
      t("name", "Name", { required: true, list: true }),
      t("barcode", "Barcode", { help: "Scan or type; used by the POS terminal" }),
      t("category", "Category", { list: true }),
      s("unit", "Unit", ["Pcs", "Kg", "Meter", "Box", "Ltr", "Ton", "Set"]),
      s("type", "Type", ["Stock item", "Raw material", "Finished good", "Service"], { list: true }),
      m("sale_price", "Sale price", { default: 0, list: true }),
      m("avg_cost", "Average cost", { default: 0, readonly: true, list: true }),
      n("reorder_level", "Reorder level", { default: 0 }),
      n("tax_percent", "Sales tax %", { default: 18, help: "Default rate filled in when this item is added to a document." }),
      t("hs_code", "HS code (FBR)", { help: "Format 0000.0000, e.g. 0101.2100. Required for FBR invoices." }),
      t("fbr_uom", "FBR unit of measure", { default: "Numbers, pieces, units", help: "Must match FBR's list for the HS code exactly (e.g. KG, Square Metre)." }),
      s("fbr_sale_type", "FBR sale type", FBR_SALE_TYPES),
      t("fbr_rate_desc", "FBR rate text (optional)", { help: "Overrides the rate text sent to FBR, e.g. an exact FBR rate description. Leave blank to send the tax % (e.g. 18%)." }),
      t("sro_schedule_no", "SRO schedule no. (optional)"),
      t("sro_item_serial_no", "SRO item serial no. (optional)"),
    ],
    labelSql: "code || ' - ' || name", searchFields: ["code", "name", "barcode", "category"], panel: "item",
  },
  {
    key: "warehouses", module: "inventory", label: "Warehouse", plural: "Warehouses",
    fields: [
      t("name", "Name", { required: true, list: true }),
      s("type", "Type", ["Warehouse", "Outlet"], { list: true }),
      ta("address", "Address"),
    ],
    labelSql: "name", where: "type='Warehouse'", defaults: { type: "Warehouse" },
  },
  {
    key: "stock_transfers", module: "inventory", label: "Stock transfer", plural: "Internal Transfers",
    numbered: "TRF", lock: ["Posted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      r("from_warehouse_id", "From", "warehouses", { required: true, list: true, refWhere: "1=1" }),
      r("to_warehouse_id", "To", "warehouses", { required: true, list: true, refWhere: "1=1" }),
      status(["Draft", "Posted"]),
      ta("notes", "Notes"),
    ],
    lines: [r("item_id", "Item", "items"), n("qty", "Qty", { default: 1 })],
    actions: [{ key: "post", label: "Post transfer", from: ["Draft"], style: "primary", confirm: "Post this transfer and move the stock?" }],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "stock_adjustments", module: "inventory", label: "Stock adjustment", plural: "Stock Adjustments",
    numbered: "ADJ", lock: ["Posted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      r("warehouse_id", "Warehouse", "warehouses", { required: true, list: true, refWhere: "1=1" }),
      t("reason", "Reason", { list: true }),
      status(["Draft", "Posted"]),
    ],
    lines: [r("item_id", "Item", "items"), n("qty", "Qty change (+/-)", { default: 0 })],
    actions: [{ key: "post", label: "Post adjustment", from: ["Draft"], style: "primary", confirm: "Post this adjustment?" }],
    labelSql: "number", sort: "id DESC",
  },

  // ----------------------------------------------------------------- Sales
  {
    key: "quotations", module: "sales", label: "Quotation", plural: "Quotations",
    numbered: "QT", trade: true, print: true, lock: ["Converted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      r("party_id", "Customer", "customers", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      d("due_date", "Valid until"),
      status(["Draft", "Sent", "Accepted", "Rejected", "Converted"]),
      ...tradeTotals(),
      ta("notes", "Notes"),
    ],
    lines: tradeLines(),
    actions: [
      { key: "send", label: "Mark as sent", from: ["Draft"] },
      { key: "convert", label: "Convert to sales order", from: ["Draft", "Sent", "Accepted"], style: "primary" },
      { key: "reject", label: "Reject", from: ["Draft", "Sent"], style: "danger" },
    ],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "sales_orders", module: "sales", label: "Sales order", plural: "Sales Orders",
    numbered: "SO", trade: true, print: true, lock: ["Invoiced", "Cancelled"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      r("party_id", "Customer", "customers", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      d("due_date", "Delivery date"),
      r("warehouse_id", "Warehouse", "warehouses", { refWhere: "1=1" }),
      status(["Draft", "Confirmed", "Invoiced", "Cancelled"]),
      ...tradeTotals(),
      ta("notes", "Notes"),
    ],
    lines: tradeLines(),
    actions: [
      { key: "confirm", label: "Confirm order", from: ["Draft"] },
      { key: "convert", label: "Create invoice", from: ["Draft", "Confirmed"], style: "primary" },
      { key: "cancel", label: "Cancel", from: ["Draft", "Confirmed"], style: "danger" },
    ],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "sales_invoices", module: "sales", label: "Sales invoice", plural: "Sales Invoices",
    numbered: "INV", trade: true, print: true, lock: ["Posted", "Partially Paid", "Paid"],
    fields: [
      t("number", "Invoice no.", { readonly: true, list: true }),
      r("party_id", "Customer", "customers", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      d("due_date", "Due date", { list: true }),
      r("warehouse_id", "Deliver from", "warehouses", { refWhere: "1=1", help: "Stock is issued from this warehouse when posted" }),
      status(["Draft", "Posted", "Partially Paid", "Paid"]),
      ...tradeTotals(),
      m("paid", "Received", { readonly: true, default: 0, list: true }),
      s("fbr_status", "FBR status", ["Not submitted", "Accepted", "Rejected"], { readonly: true, list: true }),
      t("fbr_invoice_no", "FBR invoice no. (IRN)", { readonly: true }),
      t("fbr_submitted_at", "FBR date", { readonly: true }),
      ta("fbr_error", "FBR message", { readonly: true }),
      s("fbr_scenario", "Sandbox scenario", ["", ...FBR_SCENARIOS], { help: "Sandbox only. Blank uses the default scenario from Settings." }),
      ta("notes", "Notes"),
    ],
    lines: tradeLines(),
    panel: "fbr",
    actions: [{ key: "post", label: "Post invoice", from: ["Draft"], style: "primary", confirm: "Post this invoice? Stock and ledger entries will be created." }],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "receipts", module: "sales", label: "Payment received", plural: "Payment Recovery",
    numbered: "RCT", lock: ["Posted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      r("invoice_id", "Invoice", "sales_invoices", { required: true, list: true, refWhere: "status IN ('Posted','Partially Paid')" }),
      m("amount", "Amount", { required: true, list: true }),
      s("method", "Method", ["Cash", "Bank", "Cheque"], { list: true }),
      t("reference", "Reference / cheque no."),
      status(["Draft", "Posted"]),
    ],
    actions: [{ key: "post", label: "Post receipt", from: ["Draft"], style: "primary" }],
    labelSql: "number", sort: "id DESC",
  },

  // ----------------------------------------------------------- Procurement
  {
    key: "vendors", module: "procurement", label: "Vendor", plural: "Vendors",
    fields: [
      t("name", "Name", { required: true, list: true }),
      phone("phone", "Phone", { list: true }),
      { name: "email", label: "Email", type: "email" },
      t("ntn", "NTN / Tax ID", { list: true }),
      t("city", "City", { list: true }),
      ta("address", "Address"),
    ],
    labelSql: "name", searchFields: ["name", "phone", "ntn"], panel: "vendor",
  },
  {
    key: "purchase_orders", module: "procurement", label: "Purchase order", plural: "Purchase Orders",
    numbered: "PO", trade: true, print: true, lock: ["Pending Approval", "Approved", "Billed", "Rejected"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      r("party_id", "Vendor", "vendors", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      d("due_date", "Expected delivery"),
      r("warehouse_id", "Receive into", "warehouses", { refWhere: "1=1" }),
      status(["Draft", "Pending Approval", "Approved", "Rejected", "Billed"]),
      ...tradeTotals(),
      ta("notes", "Notes"),
    ],
    lines: tradeLines(),
    actions: [
      { key: "submit", label: "Submit for approval", from: ["Draft"], style: "primary" },
      { key: "approve", label: "Approve", from: ["Pending Approval"], style: "primary" },
      { key: "reject", label: "Reject", from: ["Pending Approval"], style: "danger" },
      { key: "convert", label: "Create purchase bill", from: ["Approved"], style: "primary" },
    ],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "purchase_bills", module: "procurement", label: "Purchase bill", plural: "Purchase Bills",
    numbered: "BILL", trade: true, print: true, lock: ["Posted", "Partially Paid", "Paid"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      r("party_id", "Vendor", "vendors", { required: true, list: true }),
      t("vendor_ref", "Vendor invoice no."),
      d("date", "Date", { required: true, list: true }),
      d("due_date", "Due date", { list: true }),
      r("warehouse_id", "Receive into", "warehouses", { refWhere: "1=1" }),
      status(["Draft", "Posted", "Partially Paid", "Paid"]),
      ...tradeTotals(),
      m("paid", "Paid", { readonly: true, default: 0, list: true }),
      ta("notes", "Notes"),
    ],
    lines: tradeLines(),
    actions: [{ key: "post", label: "Post bill", from: ["Draft"], style: "primary", confirm: "Post this bill? Stock (cost) and ledger entries will be created." }],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "vendor_payments", module: "procurement", label: "Vendor payment", plural: "Vendor Payments",
    numbered: "PAY", lock: ["Posted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      r("bill_id", "Bill", "purchase_bills", { required: true, list: true, refWhere: "status IN ('Posted','Partially Paid')" }),
      m("amount", "Amount", { required: true, list: true }),
      s("method", "Method", ["Cash", "Bank", "Cheque"], { list: true }),
      t("reference", "Reference"),
      status(["Draft", "Posted"]),
    ],
    actions: [{ key: "post", label: "Post payment", from: ["Draft"], style: "primary" }],
    labelSql: "number", sort: "id DESC",
  },

  // --------------------------------------------------------- Manufacturing
  {
    key: "boms", module: "manufacturing", label: "Bill of materials", plural: "Bills of Materials (BOM)",
    fields: [
      t("name", "BOM name", { required: true, list: true }),
      r("item_id", "Finished product", "items", { required: true, list: true }),
      n("output_qty", "Output qty", { default: 1, list: true }),
      ta("notes", "Notes"),
    ],
    lines: [r("item_id", "Component", "items"), n("qty", "Qty needed", { default: 1 })],
    linesLabel: "Components", labelSql: "name",
  },
  {
    key: "production_orders", module: "manufacturing", label: "Production order", plural: "Production Orders",
    numbered: "PRD", lock: ["Completed"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      r("bom_id", "BOM", "boms", { required: true, list: true }),
      n("qty", "Quantity to produce", { required: true, default: 1, list: true }),
      r("warehouse_id", "Warehouse", "warehouses", { required: true, refWhere: "1=1" }),
      m("labor_cost", "Labor cost", { default: 0 }),
      m("overhead_cost", "Overhead cost", { default: 0 }),
      m("material_cost", "Material cost", { readonly: true, default: 0 }),
      m("total_cost", "Total job cost", { readonly: true, default: 0, list: true }),
      m("unit_cost", "Cost per unit", { readonly: true, default: 0 }),
      status(["Planned", "In Progress", "Completed"]),
    ],
    actions: [
      { key: "start", label: "Start production", from: ["Planned"] },
      { key: "complete", label: "Complete production", from: ["Planned", "In Progress"], style: "primary", confirm: "Complete? Raw materials are consumed and finished goods added to stock." },
    ],
    labelSql: "number", sort: "id DESC", panel: "production",
  },

  // ------------------------------------------------------------ Accounting
  {
    key: "accounts", module: "accounting", label: "Account", plural: "Chart of Accounts",
    fields: [
      t("code", "Code", { required: true, list: true }),
      t("name", "Account name", { required: true, list: true }),
      s("type", "Type", ["Asset", "Liability", "Equity", "Income", "Expense"], { list: true }),
    ],
    labelSql: "code || ' - ' || name", searchFields: ["code", "name"], sort: "code",
  },
  {
    key: "journal_entries", module: "accounting", label: "Journal entry", plural: "Journal Entries (General Ledger)",
    numbered: "JE", lock: ["Posted"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      t("memo", "Memo", { list: true }),
      t("source", "Source", { readonly: true, list: true }),
      status(["Draft", "Posted"]),
      m("total_debit", "Total debit", { readonly: true, list: true }),
    ],
    lines: [r("account_id", "Account", "accounts"), m("debit", "Debit", { default: 0 }), m("credit", "Credit", { default: 0 }), t("memo", "Memo")],
    actions: [{ key: "post", label: "Post entry", from: ["Draft"], style: "primary", confirm: "Post? Debits must equal credits." }],
    labelSql: "number", sort: "id DESC",
  },
  {
    key: "budgets", module: "accounting", label: "Budget", plural: "Budget Management",
    fields: [
      t("period", "Month (YYYY-MM)", { required: true, list: true, help: "e.g. 2026-11" }),
      r("account_id", "Account", "accounts", { required: true, list: true }),
      m("amount", "Budget amount", { required: true, list: true }),
      t("note", "Note"),
    ],
    labelSql: "period", sort: "period DESC",
  },

  // -------------------------------------------------------------------- HR
  {
    key: "shifts", module: "hr", label: "Shift", plural: "Shift Management",
    fields: [
      t("name", "Shift name", { required: true, list: true }),
      t("start_time", "Start (HH:MM)", { list: true, default: "09:00" }),
      t("end_time", "End (HH:MM)", { list: true, default: "18:00" }),
      n("grace_minutes", "Grace minutes", { default: 15 }),
    ],
    labelSql: "name",
  },
  {
    key: "employees", module: "hr", label: "Employee", plural: "Employees",
    fields: [
      t("code", "Employee code", { required: true, list: true }),
      t("name", "Name", { required: true, list: true }),
      t("cnic", "CNIC / ID"),
      phone("phone", "Phone"),
      t("designation", "Designation", { list: true }),
      t("department", "Department", { list: true }),
      d("join_date", "Joining date"),
      r("shift_id", "Shift", "shifts"),
      m("basic_salary", "Basic salary", { default: 0, list: true }),
      m("allowances", "Allowances", { default: 0 }),
      n("tax_percent", "Tax / deductions %", { default: 0 }),
      s("status", "Status", ["Active", "Inactive"], { list: true }),
    ],
    labelSql: "code || ' - ' || name", searchFields: ["code", "name", "department"],
  },
  {
    key: "attendance", module: "hr", label: "Attendance", plural: "Attendance",
    fields: [
      r("employee_id", "Employee", "employees", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      s("status", "Status", ["Present", "Absent", "Late", "On Leave"], { list: true }),
      t("check_in", "Check in (HH:MM)", { list: true }),
      t("check_out", "Check out (HH:MM)", { list: true }),
    ],
    labelSql: "date", sort: "date DESC, id DESC",
  },
  {
    key: "leave_requests", module: "hr", label: "Leave request", plural: "Leave Management",
    lock: ["Approved", "Rejected"],
    fields: [
      r("employee_id", "Employee", "employees", { required: true, list: true }),
      s("type", "Leave type", ["Annual", "Sick", "Casual", "Unpaid"], { list: true }),
      d("from_date", "From", { required: true, list: true }),
      d("to_date", "To", { required: true, list: true }),
      n("days", "Days", { default: 1, list: true }),
      ta("reason", "Reason"),
      status(["Pending", "Approved", "Rejected"]),
    ],
    actions: [
      { key: "approve", label: "Approve", from: ["Pending"], style: "primary" },
      { key: "reject", label: "Reject", from: ["Pending"], style: "danger" },
    ],
    labelSql: "id", sort: "id DESC",
  },
  {
    key: "payroll_runs", module: "hr", label: "Payroll run", plural: "Payroll",
    numbered: "PR", lock: ["Posted", "Paid"],
    fields: [
      t("number", "Number", { readonly: true, list: true }),
      t("period", "Month (YYYY-MM)", { required: true, list: true }),
      status(["Draft", "Posted", "Paid"]),
      m("gross", "Gross", { readonly: true, list: true }),
      m("deductions", "Deductions", { readonly: true, list: true }),
      m("net", "Net payable", { readonly: true, list: true }),
    ],
    lines: [
      r("employee_id", "Employee", "employees"),
      m("basic", "Basic"), m("allowances", "Allowances"),
      n("absent_days", "Absent days"),
      m("deductions", "Deductions"), m("net", "Net pay"),
    ],
    linesLabel: "Payslips", linesReadonly: true,
    actions: [
      { key: "generate", label: "Generate payslips", from: ["Draft"], style: "primary" },
      { key: "post", label: "Post payroll", from: ["Draft"], confirm: "Post payroll to the ledger?" },
      { key: "pay", label: "Mark as paid", from: ["Posted"], style: "primary" },
    ],
    labelSql: "number", sort: "id DESC",
  },

  // ------------------------------------------------------------- Projects
  {
    key: "projects", module: "projects", label: "Project", plural: "Planning & Scheduling (Projects)",
    numbered: "PRJ",
    fields: [
      t("number", "Code", { readonly: true, list: true }),
      t("name", "Project name", { required: true, list: true }),
      r("customer_id", "Customer", "customers", { list: true }),
      d("start_date", "Start", { list: true }),
      d("end_date", "End", { list: true }),
      m("budget", "Project budget", { default: 0, list: true }),
      s("status", "Status", ["Planning", "Active", "On Hold", "Completed"], { list: true }),
      ta("notes", "Notes"),
    ],
    labelSql: "number || ' - ' || name", searchFields: ["number", "name"], panel: "project", sort: "id DESC",
  },
  {
    key: "tasks", module: "projects", label: "Task", plural: "Tasks",
    fields: [
      r("project_id", "Project", "projects", { required: true, list: true }),
      t("title", "Task", { required: true, list: true }),
      r("employee_id", "Assigned to", "employees", { list: true }),
      d("start_date", "Start"),
      d("due_date", "Due", { list: true }),
      n("progress", "Progress %", { default: 0, list: true }),
      s("status", "Status", ["To Do", "In Progress", "Done"], { list: true }),
    ],
    labelSql: "title", sort: "due_date",
  },
  {
    key: "boq_items", module: "projects", label: "BOQ item", plural: "BOQ (Bill of Quantities)",
    fields: [
      r("project_id", "Project", "projects", { required: true, list: true }),
      t("item_no", "Item no.", { list: true }),
      t("description", "Description", { required: true, list: true }),
      t("unit", "Unit", { list: true }),
      n("qty", "Qty", { default: 1, list: true }),
      m("rate", "Rate", { default: 0, list: true }),
      m("amount", "Amount", { readonly: true, list: true }),
    ],
    labelSql: "description",
  },
  {
    key: "time_entries", module: "projects", label: "Time entry", plural: "Time Tracking",
    fields: [
      r("project_id", "Project", "projects", { required: true, list: true }),
      r("employee_id", "Employee", "employees", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      n("hours", "Hours", { required: true, list: true }),
      m("hourly_rate", "Hourly rate", { default: 0 }),
      m("cost", "Cost", { readonly: true, list: true }),
      t("description", "Work done"),
    ],
    labelSql: "date", sort: "date DESC",
  },
  {
    key: "project_expenses", module: "projects", label: "Project expense", plural: "Project Expenses",
    fields: [
      r("project_id", "Project", "projects", { required: true, list: true }),
      d("date", "Date", { required: true, list: true }),
      t("description", "Description", { required: true, list: true }),
      m("amount", "Amount", { required: true, list: true }),
    ],
    labelSql: "description", sort: "date DESC",
  },

  // --------------------------------------------------------------- Assets
  {
    key: "assets", module: "assets", label: "Asset", plural: "Asset Registration",
    numbered: "AST",
    fields: [
      t("number", "Asset no.", { readonly: true, list: true }),
      t("name", "Asset name", { required: true, list: true }),
      t("category", "Category", { list: true }),
      d("purchase_date", "Purchase date", { required: true, list: true }),
      m("cost", "Cost", { required: true, list: true }),
      m("salvage_value", "Salvage value", { default: 0 }),
      n("life_years", "Useful life (years)", { default: 5 }),
      s("funding", "Paid from", ["Bank", "Cash", "Owner's Capital", "Payable"], { help: "Used for the purchase journal when the asset is first registered. Cost cannot be edited afterwards; use Asset Revaluation." }),
      m("accumulated_depreciation", "Accumulated depreciation", { readonly: true, default: 0, list: true }),
      m("book_value", "Book value", { readonly: true, default: 0, list: true }),
      t("location", "Location"),
      s("status", "Status", ["Active", "Disposed"], { readonly: true, list: true }),
    ],
    listActions: [{ key: "depreciate_all", label: "Run depreciation for this month", style: "primary", confirm: "Post one month of depreciation for all active assets?" }],
    labelSql: "number || ' - ' || name", searchFields: ["number", "name", "category"], sort: "id DESC",
  },
  {
    key: "asset_depreciations", module: "assets", label: "Depreciation", plural: "Depreciation",
    noCreate: true,
    fields: [
      r("asset_id", "Asset", "assets", { list: true }),
      t("period", "Month", { list: true }),
      m("amount", "Amount", { list: true }),
    ],
    labelSql: "period", sort: "id DESC",
  },
  {
    key: "asset_disposals", module: "assets", label: "Asset disposal", plural: "Asset Disposal",
    lock: ["Posted"],
    fields: [
      r("asset_id", "Asset", "assets", { required: true, list: true, refWhere: "status='Active'" }),
      d("date", "Date", { required: true, list: true }),
      m("sale_price", "Sale price", { default: 0, list: true }),
      s("method", "Received in", ["Cash", "Bank"]),
      m("gain_loss", "Gain / (loss)", { readonly: true, list: true }),
      status(["Draft", "Posted"]),
    ],
    actions: [{ key: "post", label: "Post disposal", from: ["Draft"], style: "primary", confirm: "Dispose this asset?" }],
    labelSql: "id", sort: "id DESC",
  },
  {
    key: "asset_revaluations", module: "assets", label: "Asset revaluation", plural: "Asset Revaluation",
    lock: ["Posted"],
    fields: [
      r("asset_id", "Asset", "assets", { required: true, list: true, refWhere: "status='Active'" }),
      d("date", "Date", { required: true, list: true }),
      m("new_value", "New book value", { required: true, list: true }),
      m("difference", "Change", { readonly: true, list: true }),
      status(["Draft", "Posted"]),
    ],
    actions: [{ key: "post", label: "Post revaluation", from: ["Draft"], style: "primary" }],
    labelSql: "id", sort: "id DESC",
  },

  // ------------------------------------------------------------------ POS
  {
    key: "outlets", table: "warehouses", module: "pos", label: "Outlet", plural: "Multi Outlet Setup",
    fields: [
      t("name", "Outlet name", { required: true, list: true }),
      s("type", "Type", ["Outlet", "Warehouse"], { list: true }),
      ta("address", "Address"),
    ],
    labelSql: "name", where: "type='Outlet'", defaults: { type: "Outlet" },
  },
  {
    key: "pos_sales", module: "pos", label: "POS sale", plural: "Retail Billing (POS Sales)",
    numbered: "POS", noCreate: true, print: true, lock: ["Completed"],
    fields: [
      t("number", "Receipt no.", { readonly: true, list: true }),
      d("date", "Date", { list: true }),
      r("warehouse_id", "Outlet", "warehouses", { list: true, refWhere: "1=1" }),
      t("customer_name", "Customer"),
      s("method", "Payment", ["Cash", "Card", "Bank"], { list: true }),
      m("subtotal", "Subtotal", { readonly: true }),
      m("discount", "Discount", { default: 0 }),
      m("tax_amount", "Tax", { readonly: true }),
      m("total", "Total", { readonly: true, list: true }),
      status(["Completed"]),
    ],
    lines: tradeLines(),
    labelSql: "number", sort: "id DESC",
  },
];

function phone(name: string, label: string, o: O = {}): Field {
  return { name, label, type: "phone", ...o };
}

export const entityMap: Record<string, Entity> = Object.fromEntries(ENTITIES.map((e) => [e.key, e]));
export const tableOf = (e: Entity) => e.table ?? e.key;
export const entitiesOf = (module: string) =>
  ENTITIES.filter((e) => e.module === module || e.also?.includes(module));

// Chart of accounts seeded for every new company.
export const DEFAULT_ACCOUNTS: [string, string, string][] = [
  ["1000", "Cash in Hand", "Asset"],
  ["1010", "Bank Account", "Asset"],
  ["1100", "Accounts Receivable", "Asset"],
  ["1200", "Inventory", "Asset"],
  ["1500", "Fixed Assets", "Asset"],
  ["1590", "Accumulated Depreciation", "Asset"],
  ["2000", "Accounts Payable", "Liability"],
  ["2100", "Sales Tax (Payable)", "Liability"],
  ["2200", "Salaries Payable", "Liability"],
  ["2210", "Payroll Deductions Payable", "Liability"],
  ["3000", "Owner's Capital", "Equity"],
  ["3100", "Retained Earnings", "Equity"],
  ["3200", "Revaluation Surplus", "Equity"],
  ["4000", "Sales Revenue", "Income"],
  ["4900", "Gain on Asset Disposal", "Income"],
  ["5000", "Cost of Goods Sold", "Expense"],
  ["5200", "Production Costs Absorbed", "Expense"],
  ["6000", "Salaries Expense", "Expense"],
  ["6100", "Depreciation Expense", "Expense"],
  ["6200", "General Expenses", "Expense"],
  ["6900", "Loss on Asset Disposal", "Expense"],
];
