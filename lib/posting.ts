// Business logic that connects the modules: stock movements, ledger
// journals, status changes and document conversions.
import { all, get, run, tx, nextNumber } from "./db";
import { entityOrThrow, getRow, num } from "./crud";
import { tableOf } from "./schema";

type Row = Record<string, any>;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- accounts
const ACC = {
  cash: "1000", bank: "1010", ar: "1100", inventory: "1200", fixed: "1500", accdep: "1590",
  ap: "2000", tax: "2100", salaries: "2200", deductions: "2210", reval: "3200",
  sales: "4000", gain: "4900", cogs: "5000", prodcost: "5200",
  salariesExp: "6000", depExp: "6100", generalExp: "6200", loss: "6900",
} as const;

const ACC_NAMES: Record<string, [string, string]> = {
  "1000": ["Cash in Hand", "Asset"], "1010": ["Bank Account", "Asset"], "1100": ["Accounts Receivable", "Asset"],
  "1200": ["Inventory", "Asset"], "1500": ["Fixed Assets", "Asset"], "1590": ["Accumulated Depreciation", "Asset"],
  "2000": ["Accounts Payable", "Liability"], "2100": ["Sales Tax (Payable)", "Liability"],
  "2200": ["Salaries Payable", "Liability"], "2210": ["Payroll Deductions Payable", "Liability"],
  "3200": ["Revaluation Surplus", "Equity"], "4000": ["Sales Revenue", "Income"], "4900": ["Gain on Asset Disposal", "Income"],
  "5000": ["Cost of Goods Sold", "Expense"], "5200": ["Production Costs Absorbed", "Expense"],
  "6000": ["Salaries Expense", "Expense"], "6100": ["Depreciation Expense", "Expense"],
  "6200": ["General Expenses", "Expense"], "6900": ["Loss on Asset Disposal", "Expense"],
};

function accountId(companyId: number, code: string): number {
  const a = get<Row>(`SELECT id FROM accounts WHERE company_id=? AND code=?`, companyId, code);
  if (a) return a.id;
  const [name, type] = ACC_NAMES[code] ?? [`Account ${code}`, "Expense"];
  return run(`INSERT INTO accounts (company_id, code, name, type) VALUES (?,?,?,?)`, companyId, code, name, type).id;
}

interface JLine { code: string; debit?: number; credit?: number; memo?: string }

export function postJournal(companyId: number, j: { date: string; memo: string; source: string; sourceId?: number; lines: JLine[] }) {
  const lines = j.lines.filter((l) => round2(num(l.debit)) > 0 || round2(num(l.credit)) > 0);
  const dr = round2(lines.reduce((s, l) => s + num(l.debit), 0));
  const cr = round2(lines.reduce((s, l) => s + num(l.credit), 0));
  if (Math.abs(dr - cr) > 0.01) throw new Error(`Journal is not balanced (debit ${dr}, credit ${cr}).`);
  if (!lines.length) return null;
  const number = nextNumber(companyId, "journal_entries", "JE");
  const je = run(
    `INSERT INTO journal_entries (company_id, number, date, memo, source, status, total_debit, source_ref, source_id)
     VALUES (?,?,?,?,?,'Posted',?,?,?)`,
    companyId, number, j.date, j.memo, j.source, dr, j.source, j.sourceId ?? null,
  ).id;
  for (const l of lines) {
    run(
      `INSERT INTO journal_entries_lines (doc_id, account_id, debit, credit, memo) VALUES (?,?,?,?,?)`,
      je, accountId(companyId, l.code), round2(num(l.debit)), round2(num(l.credit)), l.memo ?? null,
    );
  }
  return je;
}

// ------------------------------------------------------------------- stock
export const isStockItem = (item: Row | undefined) => !!item && item.type !== "Service";

export function stockOnHand(companyId: number, itemId: number, warehouseId?: number | null): number {
  const r = warehouseId
    ? get<Row>(`SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE company_id=? AND item_id=? AND warehouse_id=?`, companyId, itemId, warehouseId)
    : get<Row>(`SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE company_id=? AND item_id=?`, companyId, itemId);
  return round2(num(r?.q));
}

export function defaultWarehouse(companyId: number): number {
  const w = get<Row>(`SELECT id FROM warehouses WHERE company_id=? AND type='Warehouse' ORDER BY id LIMIT 1`, companyId)
    ?? get<Row>(`SELECT id FROM warehouses WHERE company_id=? ORDER BY id LIMIT 1`, companyId);
  if (w) return w.id;
  return run(`INSERT INTO warehouses (company_id, name, type) VALUES (?,?,?)`, companyId, "Main Warehouse", "Warehouse").id;
}

/** Add stock; recalculates weighted-average cost. */
export function stockIn(companyId: number, p: { item: Row; warehouseId: number; qty: number; unitCost: number; date: string; refType: string; refId: number }) {
  const onHand = Math.max(stockOnHand(companyId, p.item.id), 0);
  const newQty = onHand + p.qty;
  const avg = newQty > 0 ? (onHand * num(p.item.avg_cost) + p.qty * p.unitCost) / newQty : p.unitCost;
  run(`UPDATE items SET avg_cost=? WHERE id=? AND company_id=?`, round2(avg), p.item.id, companyId);
  p.item.avg_cost = round2(avg);
  run(
    `INSERT INTO stock_moves (company_id,item_id,warehouse_id,qty,unit_cost,date,ref_type,ref_id) VALUES (?,?,?,?,?,?,?,?)`,
    companyId, p.item.id, p.warehouseId, p.qty, p.unitCost, p.date, p.refType, p.refId,
  );
}

/** Remove stock at average cost. Throws if stock is insufficient. Returns cost value removed. */
export function stockOut(companyId: number, p: { item: Row; warehouseId: number; qty: number; date: string; refType: string; refId: number }): number {
  const have = stockOnHand(companyId, p.item.id, p.warehouseId);
  if (have < p.qty - 1e-9) {
    throw new Error(`Insufficient stock for "${p.item.name}": need ${p.qty}, only ${have} available in the selected warehouse.`);
  }
  const cost = num(p.item.avg_cost);
  run(
    `INSERT INTO stock_moves (company_id,item_id,warehouse_id,qty,unit_cost,date,ref_type,ref_id) VALUES (?,?,?,?,?,?,?,?)`,
    companyId, p.item.id, p.warehouseId, -p.qty, cost, p.date, p.refType, p.refId,
  );
  return round2(cost * p.qty);
}

const itemById = (companyId: number, id: number) => get<Row>(`SELECT * FROM items WHERE id=? AND company_id=?`, id, companyId);

// ------------------------------------------------------- generic doc helpers
function setStatus(table: string, companyId: number, id: number, status: string) {
  run(`UPDATE "${table}" SET status=? WHERE id=? AND company_id=?`, status, id, companyId);
}

function createLinked(companyId: number, fromKey: string, toKey: string, fromId: number, extra: Row = {}) {
  const from = entityOrThrow(fromKey);
  const to = entityOrThrow(toKey);
  const src = getRow(companyId, from, fromId)!;
  const number = nextNumber(companyId, to.key, to.numbered!);
  const cols = ["company_id", "number", "status", "party_id", "date", "due_date", "warehouse_id", "subtotal", "discount", "tax_amount", "total", "notes", "ref_doc"];
  const vals = [
    companyId, number, "Draft", src.row.party_id, today(), src.row.due_date ?? null,
    src.row.warehouse_id ?? extra.warehouse_id ?? null, src.row.subtotal, src.row.discount,
    src.row.tax_amount, src.row.total, src.row.notes, src.row.number,
  ];
  const newId = run(
    `INSERT INTO "${tableOf(to)}" (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...vals,
  ).id;
  for (const l of src.lines) {
    run(
      `INSERT INTO "${tableOf(to)}_lines" (doc_id,item_id,description,qty,rate,tax_percent,amount) VALUES (?,?,?,?,?,?,?)`,
      newId, l.item_id, l.description, l.qty, l.rate, l.tax_percent ?? 0, l.amount,
    );
  }
  return newId;
}

// ------------------------------------------------------------ action router
export interface ActionResult { message: string; redirect?: string }

export function runAction(companyId: number, entityKey: string, id: number, action: string, extra: Row = {}): ActionResult {
  return tx(() => {
    const e = entityOrThrow(entityKey);
    const table = tableOf(e);
    const doc = getRow(companyId, e, id);
    if (!doc) throw new Error("Record not found.");
    const def = e.actions?.find((a) => a.key === action);
    if (!def) throw new Error("Unknown action.");
    if (def.from && !def.from.includes(doc.row.status)) throw new Error(`Not allowed while status is ${doc.row.status}.`);

    const fn = HANDLERS[`${entityKey}.${action}`];
    if (!fn) throw new Error("Action not implemented.");
    return fn({ companyId, e, table, id, row: doc.row, lines: doc.lines, extra });
  });
}

interface Ctx { companyId: number; e: any; table: string; id: number; row: Row; lines: Row[]; extra: Row }
type Handler = (c: Ctx) => ActionResult;

const simpleStatus = (status: string, message: string): Handler => (c) => {
  setStatus(c.table, c.companyId, c.id, status);
  return { message };
};

function requireLines(c: Ctx) {
  if (!c.lines.length) throw new Error("Add at least one line before posting.");
}

const HANDLERS: Record<string, Handler> = {
  // ---------------------------------------------------------------- CRM
  "leads.convert": (c) => {
    const cust = run(
      `INSERT INTO customers (company_id,name,phone,email,address,credit_limit) VALUES (?,?,?,?,?,0)`,
      c.companyId, c.row.company || c.row.name, c.row.phone, c.row.email, null,
    ).id;
    setStatus("leads", c.companyId, c.id, "Won");
    return { message: "Lead converted to customer.", redirect: `/e/customers/${cust}` };
  },

  // --------------------------------------------------------------- Sales
  "quotations.send": simpleStatus("Sent", "Marked as sent."),
  "quotations.reject": simpleStatus("Rejected", "Quotation rejected."),
  "quotations.convert": (c) => {
    requireLines(c);
    const so = createLinked(c.companyId, "quotations", "sales_orders", c.id);
    setStatus(c.table, c.companyId, c.id, "Converted");
    return { message: "Sales order created.", redirect: `/e/sales_orders/${so}` };
  },
  "sales_orders.confirm": simpleStatus("Confirmed", "Order confirmed."),
  "sales_orders.cancel": simpleStatus("Cancelled", "Order cancelled."),
  "sales_orders.convert": (c) => {
    requireLines(c);
    const inv = createLinked(c.companyId, "sales_orders", "sales_invoices", c.id, { warehouse_id: defaultWarehouse(c.companyId) });
    setStatus(c.table, c.companyId, c.id, "Invoiced");
    return { message: "Draft invoice created.", redirect: `/e/sales_invoices/${inv}` };
  },
  "sales_invoices.post": (c) => {
    requireLines(c);
    const wh = c.row.warehouse_id ?? defaultWarehouse(c.companyId);
    let cogs = 0;
    for (const l of c.lines) {
      const item = l.item_id ? itemById(c.companyId, l.item_id) : undefined;
      if (isStockItem(item)) {
        cogs += stockOut(c.companyId, { item: item!, warehouseId: wh, qty: num(l.qty), date: c.row.date, refType: "sales_invoices", refId: c.id });
      }
    }
    const net = round2(num(c.row.subtotal) - num(c.row.discount));
    postJournal(c.companyId, {
      date: c.row.date, memo: `Sales invoice ${c.row.number}`, source: `Invoice ${c.row.number}`, sourceId: c.id,
      lines: [
        { code: ACC.ar, debit: num(c.row.total) },
        { code: ACC.sales, credit: net },
        { code: ACC.tax, credit: num(c.row.tax_amount) },
        { code: ACC.cogs, debit: cogs },
        { code: ACC.inventory, credit: cogs },
      ],
    });
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: `Invoice ${c.row.number} posted.` };
  },
  "receipts.post": (c) => {
    const inv = get<Row>(`SELECT * FROM sales_invoices WHERE id=? AND company_id=?`, c.row.invoice_id, c.companyId);
    if (!inv || !["Posted", "Partially Paid"].includes(inv.status)) throw new Error("Invoice is not open for payment.");
    const amount = round2(num(c.row.amount));
    const due = round2(num(inv.total) - num(inv.paid));
    if (amount > due + 0.005) throw new Error(`Amount exceeds the outstanding balance of ${due}.`);
    postJournal(c.companyId, {
      date: c.row.date, memo: `Receipt ${c.row.number} for ${inv.number}`, source: `Receipt ${c.row.number}`, sourceId: c.id,
      lines: [{ code: c.row.method === "Cash" ? ACC.cash : ACC.bank, debit: amount }, { code: ACC.ar, credit: amount }],
    });
    const paid = round2(num(inv.paid) + amount);
    run(`UPDATE sales_invoices SET paid=?, status=? WHERE id=?`, paid, paid >= num(inv.total) - 0.005 ? "Paid" : "Partially Paid", inv.id);
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: "Receipt posted." };
  },

  // --------------------------------------------------------- Procurement
  "purchase_orders.submit": (c) => { requireLines(c); setStatus(c.table, c.companyId, c.id, "Pending Approval"); return { message: "Submitted for approval." }; },
  "purchase_orders.approve": simpleStatus("Approved", "Purchase order approved."),
  "purchase_orders.reject": simpleStatus("Rejected", "Purchase order rejected."),
  "purchase_orders.convert": (c) => {
    const bill = createLinked(c.companyId, "purchase_orders", "purchase_bills", c.id, { warehouse_id: defaultWarehouse(c.companyId) });
    setStatus(c.table, c.companyId, c.id, "Billed");
    return { message: "Draft purchase bill created.", redirect: `/e/purchase_bills/${bill}` };
  },
  "purchase_bills.post": (c) => {
    requireLines(c);
    const wh = c.row.warehouse_id ?? defaultWarehouse(c.companyId);
    const discountFactor = num(c.row.subtotal) > 0 ? 1 - num(c.row.discount) / num(c.row.subtotal) : 1;
    let stockValue = 0;
    let expenseValue = 0;
    for (const l of c.lines) {
      const item = l.item_id ? itemById(c.companyId, l.item_id) : undefined;
      const amount = round2(num(l.amount) * discountFactor);
      if (isStockItem(item) && num(l.qty) > 0) {
        stockIn(c.companyId, { item: item!, warehouseId: wh, qty: num(l.qty), unitCost: amount / num(l.qty), date: c.row.date, refType: "purchase_bills", refId: c.id });
        stockValue += amount;
      } else {
        expenseValue += amount;
      }
    }
    // Put rounding differences on expense so the journal always balances.
    const net = round2(num(c.row.subtotal) - num(c.row.discount));
    expenseValue = round2(net - stockValue);
    postJournal(c.companyId, {
      date: c.row.date, memo: `Purchase bill ${c.row.number}`, source: `Bill ${c.row.number}`, sourceId: c.id,
      lines: [
        { code: ACC.inventory, debit: round2(stockValue) },
        { code: ACC.generalExp, debit: expenseValue },
        { code: ACC.tax, debit: num(c.row.tax_amount) },
        { code: ACC.ap, credit: num(c.row.total) },
      ],
    });
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: `Bill ${c.row.number} posted.` };
  },
  "vendor_payments.post": (c) => {
    const bill = get<Row>(`SELECT * FROM purchase_bills WHERE id=? AND company_id=?`, c.row.bill_id, c.companyId);
    if (!bill || !["Posted", "Partially Paid"].includes(bill.status)) throw new Error("Bill is not open for payment.");
    const amount = round2(num(c.row.amount));
    const due = round2(num(bill.total) - num(bill.paid));
    if (amount > due + 0.005) throw new Error(`Amount exceeds the outstanding balance of ${due}.`);
    postJournal(c.companyId, {
      date: c.row.date, memo: `Payment ${c.row.number} for ${bill.number}`, source: `Payment ${c.row.number}`, sourceId: c.id,
      lines: [{ code: ACC.ap, debit: amount }, { code: c.row.method === "Cash" ? ACC.cash : ACC.bank, credit: amount }],
    });
    const paid = round2(num(bill.paid) + amount);
    run(`UPDATE purchase_bills SET paid=?, status=? WHERE id=?`, paid, paid >= num(bill.total) - 0.005 ? "Paid" : "Partially Paid", bill.id);
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: "Payment posted." };
  },

  // ----------------------------------------------------------- Inventory
  "stock_transfers.post": (c) => {
    requireLines(c);
    for (const l of c.lines) {
      const item = itemById(c.companyId, l.item_id);
      if (!isStockItem(item)) throw new Error(`"${item?.name ?? "Item"}" is not a stock item.`);
      stockOut(c.companyId, { item: item!, warehouseId: c.row.from_warehouse_id, qty: num(l.qty), date: c.row.date, refType: "stock_transfers", refId: c.id });
      run(
        `INSERT INTO stock_moves (company_id,item_id,warehouse_id,qty,unit_cost,date,ref_type,ref_id) VALUES (?,?,?,?,?,?,?,?)`,
        c.companyId, item!.id, c.row.to_warehouse_id, num(l.qty), num(item!.avg_cost), c.row.date, "stock_transfers", c.id,
      );
    }
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: "Transfer posted." };
  },
  "stock_adjustments.post": (c) => {
    requireLines(c);
    let value = 0;
    for (const l of c.lines) {
      const item = itemById(c.companyId, l.item_id);
      if (!isStockItem(item)) throw new Error(`"${item?.name ?? "Item"}" is not a stock item.`);
      const q = num(l.qty);
      if (q > 0) {
        stockIn(c.companyId, { item: item!, warehouseId: c.row.warehouse_id, qty: q, unitCost: num(item!.avg_cost), date: c.row.date, refType: "stock_adjustments", refId: c.id });
        value += q * num(item!.avg_cost);
      } else if (q < 0) {
        value -= stockOut(c.companyId, { item: item!, warehouseId: c.row.warehouse_id, qty: -q, date: c.row.date, refType: "stock_adjustments", refId: c.id });
      }
    }
    value = round2(value);
    postJournal(c.companyId, {
      date: c.row.date, memo: `Stock adjustment ${c.row.number}`, source: `Adjustment ${c.row.number}`, sourceId: c.id,
      lines: [
        { code: ACC.inventory, debit: value > 0 ? value : 0, credit: value < 0 ? -value : 0 },
        { code: ACC.generalExp, debit: value < 0 ? -value : 0, credit: value > 0 ? value : 0 },
      ],
    });
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: "Adjustment posted." };
  },

  // ------------------------------------------------------- Manufacturing
  "production_orders.start": simpleStatus("In Progress", "Production started."),
  "production_orders.complete": (c) => {
    const bom = getRow(c.companyId, entityOrThrow("boms"), c.row.bom_id);
    if (!bom || !bom.lines.length) throw new Error("The selected BOM has no components.");
    const outQty = Math.max(num(bom.row.output_qty), 0.0001);
    const factor = num(c.row.qty) / outQty;
    let material = 0;
    for (const l of bom.lines) {
      const item = itemById(c.companyId, l.item_id);
      if (!isStockItem(item)) continue;
      material += stockOut(c.companyId, { item: item!, warehouseId: c.row.warehouse_id, qty: round2(num(l.qty) * factor), date: c.row.date, refType: "production_orders", refId: c.id });
    }
    material = round2(material);
    const conversion = round2(num(c.row.labor_cost) + num(c.row.overhead_cost));
    const total = round2(material + conversion);
    const unit = num(c.row.qty) > 0 ? round2(total / num(c.row.qty)) : 0;
    const product = itemById(c.companyId, bom.row.item_id);
    if (!isStockItem(product)) throw new Error("The BOM's finished product must be a stock item.");
    stockIn(c.companyId, { item: product!, warehouseId: c.row.warehouse_id, qty: num(c.row.qty), unitCost: unit, date: c.row.date, refType: "production_orders", refId: c.id });
    postJournal(c.companyId, {
      date: c.row.date, memo: `Production ${c.row.number}`, source: `Production ${c.row.number}`, sourceId: c.id,
      lines: [
        { code: ACC.inventory, debit: total },
        { code: ACC.inventory, credit: material },
        { code: ACC.prodcost, credit: conversion },
      ],
    });
    run(`UPDATE production_orders SET material_cost=?, total_cost=?, unit_cost=?, status='Completed' WHERE id=?`, material, total, unit, c.id);
    return { message: `Production complete. Unit cost ${unit}.` };
  },

  // ---------------------------------------------------------- Accounting
  "journal_entries.post": (c) => {
    if (c.lines.length < 2) throw new Error("A journal needs at least two lines.");
    const dr = round2(c.lines.reduce((s, l) => s + num(l.debit), 0));
    const cr = round2(c.lines.reduce((s, l) => s + num(l.credit), 0));
    if (dr <= 0 || Math.abs(dr - cr) > 0.01) throw new Error(`Debits (${dr}) must equal credits (${cr}).`);
    if (c.lines.some((l) => !l.account_id)) throw new Error("Every line needs an account.");
    run(`UPDATE journal_entries SET status='Posted', total_debit=?, source='Manual' WHERE id=?`, dr, c.id);
    return { message: "Journal posted." };
  },

  // ------------------------------------------------------------------ HR
  "leave_requests.approve": (c) => {
    setStatus(c.table, c.companyId, c.id, "Approved");
    // Mark attendance as On Leave for each day in range.
    const from = new Date(c.row.from_date);
    const to = new Date(c.row.to_date);
    for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
      const day = dt.toISOString().slice(0, 10);
      const ex = get(`SELECT id FROM attendance WHERE company_id=? AND employee_id=? AND date=?`, c.companyId, c.row.employee_id, day);
      if (ex) run(`UPDATE attendance SET status='On Leave' WHERE id=?`, (ex as Row).id);
      else run(`INSERT INTO attendance (company_id,employee_id,date,status) VALUES (?,?,?,'On Leave')`, c.companyId, c.row.employee_id, day);
    }
    return { message: "Leave approved and attendance updated." };
  },
  "leave_requests.reject": simpleStatus("Rejected", "Leave rejected."),

  "payroll_runs.generate": (c) => {
    if (!/^\d{4}-\d{2}$/.test(String(c.row.period))) throw new Error("Period must look like 2026-11.");
    const dup = get(`SELECT id FROM payroll_runs WHERE company_id=? AND period=? AND id<>? AND status<>'Draft'`, c.companyId, c.row.period, c.id);
    if (dup) throw new Error("A payroll for this month has already been posted.");
    run(`DELETE FROM payroll_runs_lines WHERE doc_id=?`, c.id);
    const emps = all<Row>(`SELECT * FROM employees WHERE company_id=? AND status='Active' ORDER BY code`, c.companyId);
    if (!emps.length) throw new Error("No active employees found.");
    let gross = 0, ded = 0, net = 0;
    for (const emp of emps) {
      const absent = get<Row>(
        `SELECT COUNT(*) c FROM attendance WHERE company_id=? AND employee_id=? AND status='Absent' AND substr(date,1,7)=?`,
        c.companyId, emp.id, c.row.period,
      )!.c;
      const basic = num(emp.basic_salary);
      const allow = num(emp.allowances);
      const g = round2(basic + allow);
      const absentDed = round2((basic / 30) * absent);
      const taxDed = round2((g * num(emp.tax_percent)) / 100);
      const d = round2(absentDed + taxDed);
      const nt = round2(g - d);
      run(
        `INSERT INTO payroll_runs_lines (doc_id,employee_id,basic,allowances,absent_days,deductions,net) VALUES (?,?,?,?,?,?,?)`,
        c.id, emp.id, basic, allow, absent, d, nt,
      );
      gross += g; ded += d; net += nt;
    }
    run(`UPDATE payroll_runs SET gross=?, deductions=?, net=? WHERE id=?`, round2(gross), round2(ded), round2(net), c.id);
    return { message: `Payslips generated for ${emps.length} employees.` };
  },
  "payroll_runs.post": (c) => {
    if (!c.lines.length) throw new Error("Generate payslips first.");
    postJournal(c.companyId, {
      date: today(), memo: `Payroll ${c.row.period}`, source: `Payroll ${c.row.number}`, sourceId: c.id,
      lines: [
        { code: ACC.salariesExp, debit: num(c.row.gross) },
        { code: ACC.salaries, credit: num(c.row.net) },
        { code: ACC.deductions, credit: num(c.row.deductions) },
      ],
    });
    setStatus(c.table, c.companyId, c.id, "Posted");
    return { message: "Payroll posted." };
  },
  "payroll_runs.pay": (c) => {
    postJournal(c.companyId, {
      date: today(), memo: `Salary payment ${c.row.period}`, source: `Payroll ${c.row.number}`, sourceId: c.id,
      lines: [{ code: ACC.salaries, debit: num(c.row.net) }, { code: ACC.bank, credit: num(c.row.net) }],
    });
    setStatus(c.table, c.companyId, c.id, "Paid");
    return { message: "Marked as paid." };
  },

  // -------------------------------------------------------------- Assets
  "asset_disposals.post": (c) => {
    const a = get<Row>(`SELECT * FROM assets WHERE id=? AND company_id=?`, c.row.asset_id, c.companyId);
    if (!a || a.status !== "Active") throw new Error("Asset is not active.");
    const price = round2(num(c.row.sale_price));
    const book = round2(num(a.cost) - num(a.accumulated_depreciation));
    const gain = round2(price - book);
    postJournal(c.companyId, {
      date: c.row.date, memo: `Disposal of ${a.number}`, source: `Disposal ${a.number}`, sourceId: c.id,
      lines: [
        { code: c.row.method === "Cash" ? ACC.cash : ACC.bank, debit: price },
        { code: ACC.accdep, debit: num(a.accumulated_depreciation) },
        { code: ACC.loss, debit: gain < 0 ? -gain : 0 },
        { code: ACC.fixed, credit: num(a.cost) },
        { code: ACC.gain, credit: gain > 0 ? gain : 0 },
      ],
    });
    run(`UPDATE assets SET status='Disposed', book_value=0 WHERE id=?`, a.id);
    run(`UPDATE asset_disposals SET status='Posted', gain_loss=? WHERE id=?`, gain, c.id);
    return { message: `Asset disposed. ${gain >= 0 ? "Gain" : "Loss"}: ${Math.abs(gain)}.` };
  },
  "asset_revaluations.post": (c) => {
    const a = get<Row>(`SELECT * FROM assets WHERE id=? AND company_id=?`, c.row.asset_id, c.companyId);
    if (!a || a.status !== "Active") throw new Error("Asset is not active.");
    const diff = round2(num(c.row.new_value) - num(a.book_value));
    postJournal(c.companyId, {
      date: c.row.date, memo: `Revaluation of ${a.number}`, source: `Revaluation ${a.number}`, sourceId: c.id,
      lines: [
        { code: ACC.fixed, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0 },
        { code: ACC.reval, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 },
      ],
    });
    run(`UPDATE assets SET cost=cost+?, book_value=? WHERE id=?`, diff, round2(num(c.row.new_value)), a.id);
    run(`UPDATE asset_revaluations SET status='Posted', difference=? WHERE id=?`, diff, c.id);
    return { message: "Revaluation posted." };
  },
};

/** Books the purchase of a newly registered asset: Dr Fixed Assets, Cr funding account. */
export function postAssetAcquisition(companyId: number, assetId: number) {
  const a = get<Row>(`SELECT * FROM assets WHERE id=? AND company_id=?`, assetId, companyId);
  if (!a) throw new Error("Asset not found.");
  const credit = ({ Bank: ACC.bank, Cash: ACC.cash, Payable: ACC.ap } as Record<string, string>)[a.funding] ?? "3000";
  postJournal(companyId, {
    date: a.purchase_date, memo: `Purchase of asset ${a.number}`, source: `Asset ${a.number}`, sourceId: a.id,
    lines: [{ code: ACC.fixed, debit: num(a.cost) }, { code: credit, credit: num(a.cost) }],
  });
}

// ------------------------------------------------------ list-level actions
export function runListAction(companyId: number, entityKey: string, action: string): ActionResult {
  if (entityKey === "assets" && action === "depreciate_all") {
    return tx(() => {
      const period = today().slice(0, 7);
      let count = 0, total = 0;
      for (const a of all<Row>(`SELECT * FROM assets WHERE company_id=? AND status='Active'`, companyId)) {
        if (get(`SELECT 1 x FROM asset_depreciations WHERE company_id=? AND asset_id=? AND period=?`, companyId, a.id, period)) continue;
        const monthly = (num(a.cost) - num(a.salvage_value)) / (num(a.life_years) * 12);
        const remaining = num(a.cost) - num(a.salvage_value) - num(a.accumulated_depreciation);
        const amount = round2(Math.min(monthly, Math.max(remaining, 0)));
        if (amount <= 0) continue;
        run(`INSERT INTO asset_depreciations (company_id, asset_id, period, amount) VALUES (?,?,?,?)`, companyId, a.id, period, amount);
        const acc = round2(num(a.accumulated_depreciation) + amount);
        run(`UPDATE assets SET accumulated_depreciation=?, book_value=? WHERE id=?`, acc, round2(num(a.cost) - acc), a.id);
        postJournal(companyId, {
          date: today(), memo: `Depreciation ${period} ${a.number}`, source: `Depreciation ${a.number}`, sourceId: a.id,
          lines: [{ code: ACC.depExp, debit: amount }, { code: ACC.accdep, credit: amount }],
        });
        count++; total += amount;
      }
      return { message: count ? `Depreciation posted for ${count} asset(s): ${round2(total)}.` : `Nothing to depreciate for ${period}.` };
    });
  }
  throw new Error("Unknown action.");
}

// -------------------------------------------------------------------- POS
export interface PosLine { itemId: number; qty: number; price: number }

export function posCheckout(companyId: number, input: { warehouseId: number; method: string; customer?: string; discount: number; taxPercent: number; lines: PosLine[] }) {
  return tx(() => {
    if (!input.lines.length) throw new Error("Cart is empty.");
    if (!get(`SELECT 1 x FROM warehouses WHERE id=? AND company_id=?`, input.warehouseId, companyId)) throw new Error("Select an outlet.");
    if (!["Cash", "Card", "Bank"].includes(input.method)) throw new Error("Invalid payment method.");
    const date = today();
    const number = nextNumber(companyId, "pos_sales", "POS");
    const prepared = input.lines.map((l) => {
      const item = itemById(companyId, l.itemId);
      if (!item) throw new Error("Item not found.");
      const qty = num(l.qty);
      if (qty <= 0) throw new Error("Quantity must be positive.");
      // Price comes from the cart but never below zero; the item master price is the default.
      return { item, qty, price: Math.max(num(l.price), 0) };
    });
    const subtotal = round2(prepared.reduce((s, l) => s + l.qty * l.price, 0));
    const discount = Math.min(Math.max(num(input.discount), 0), subtotal);
    const tax = round2(((subtotal - discount) * Math.max(num(input.taxPercent), 0)) / 100);
    const total = round2(subtotal - discount + tax);
    const id = run(
      `INSERT INTO pos_sales (company_id,number,date,warehouse_id,customer_name,method,subtotal,discount,tax_amount,total,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'Completed')`,
      companyId, number, date, input.warehouseId, input.customer || "Walk-in", input.method, subtotal, discount, tax, total,
    ).id;
    let cogs = 0;
    for (const l of prepared) {
      run(`INSERT INTO pos_sales_lines (doc_id,item_id,description,qty,rate,amount) VALUES (?,?,?,?,?,?)`,
        id, l.item.id, l.item.name, l.qty, l.price, round2(l.qty * l.price));
      if (isStockItem(l.item)) {
        cogs += stockOut(companyId, { item: l.item, warehouseId: input.warehouseId, qty: l.qty, date, refType: "pos_sales", refId: id });
      }
    }
    postJournal(companyId, {
      date, memo: `POS sale ${number}`, source: `POS ${number}`, sourceId: id,
      lines: [
        { code: input.method === "Cash" ? ACC.cash : ACC.bank, debit: total },
        { code: ACC.sales, credit: round2(subtotal - discount) },
        { code: ACC.tax, credit: tax },
        { code: ACC.cogs, debit: cogs },
        { code: ACC.inventory, credit: cogs },
      ],
    });
    return { id, number, total };
  });
}
