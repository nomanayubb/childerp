import { all, get } from "./db";

type Row = Record<string, any>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface Col { key: string; label: string; kind?: "money" | "num" | "text" }
export interface Section { heading?: string; columns: Col[]; rows: Row[]; footer?: Row }
export interface Report { title: string; summary?: { label: string; value: number | string; kind?: "money" | "text"; tone?: "good" | "bad" }[]; sections: Section[]; note?: string }
export interface Range { from: string; to: string }

const M = (key: string, label: string): Col => ({ key, label, kind: "money" });
const T = (key: string, label: string): Col => ({ key, label, kind: "text" });
const N = (key: string, label: string): Col => ({ key, label, kind: "num" });

/** Debit/credit totals per account from posted journals. */
function balances(companyId: number, from: string | null, to: string): Row[] {
  return all(
    `SELECT a.id, a.code, a.name, a.type, COALESCE(SUM(l.debit),0) dr, COALESCE(SUM(l.credit),0) cr
       FROM accounts a
       LEFT JOIN journal_entries_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries j ON j.id = l.doc_id
      WHERE a.company_id = ? AND (j.id IS NULL OR (j.status='Posted' AND j.company_id=? AND j.date <= ? ${from ? "AND j.date >= ?" : ""}))
      GROUP BY a.id ORDER BY a.code`,
    companyId, companyId, to, ...(from ? [from] : []),
  ).map((r) => ({ ...r, dr: n(r.dr), cr: n(r.cr) }));
}

export function profitLoss(companyId: number, { from, to }: Range): Report {
  const b = balances(companyId, from, to);
  const income = b.filter((a) => a.type === "Income" && (a.dr || a.cr)).map((a) => ({ account: `${a.code} ${a.name}`, amount: r2(a.cr - a.dr) }));
  const expense = b.filter((a) => a.type === "Expense" && (a.dr || a.cr)).map((a) => ({ account: `${a.code} ${a.name}`, amount: r2(a.dr - a.cr) }));
  const ti = r2(income.reduce((s, x) => s + x.amount, 0));
  const te = r2(expense.reduce((s, x) => s + x.amount, 0));
  const cols = [T("account", "Account"), M("amount", "Amount")];
  return {
    title: "Profit & Loss",
    summary: [
      { label: "Total income", value: ti, kind: "money" },
      { label: "Total expenses", value: te, kind: "money" },
      { label: ti - te >= 0 ? "Net profit" : "Net loss", value: r2(ti - te), kind: "money", tone: ti - te >= 0 ? "good" : "bad" },
    ],
    sections: [
      { heading: "Income", columns: cols, rows: income, footer: { account: "Total income", amount: ti } },
      { heading: "Expenses", columns: cols, rows: expense, footer: { account: "Total expenses", amount: te } },
    ],
  };
}

export function balanceSheet(companyId: number, { to }: Range): Report {
  const b = balances(companyId, null, to);
  const pick = (type: string, sign: 1 | -1) =>
    b.filter((a) => a.type === type && (a.dr || a.cr)).map((a) => ({ account: `${a.code} ${a.name}`, amount: r2(sign * (a.dr - a.cr)) }));
  const assets = pick("Asset", 1);
  const liabilities = pick("Liability", -1);
  const equity = pick("Equity", -1);
  const earnings = r2(
    b.filter((a) => a.type === "Income").reduce((s, a) => s + (a.cr - a.dr), 0) -
    b.filter((a) => a.type === "Expense").reduce((s, a) => s + (a.dr - a.cr), 0),
  );
  if (earnings) equity.push({ account: "Current earnings (unclosed)", amount: earnings });
  const sum = (x: { amount: number }[]) => r2(x.reduce((s, r) => s + r.amount, 0));
  const ta = sum(assets), tl = sum(liabilities), te = sum(equity);
  const cols = [T("account", "Account"), M("amount", "Amount")];
  return {
    title: `Balance Sheet as of ${to}`,
    summary: [
      { label: "Total assets", value: ta, kind: "money" },
      { label: "Liabilities + equity", value: r2(tl + te), kind: "money", tone: Math.abs(ta - tl - te) < 0.01 ? "good" : "bad" },
    ],
    sections: [
      { heading: "Assets", columns: cols, rows: assets, footer: { account: "Total assets", amount: ta } },
      { heading: "Liabilities", columns: cols, rows: liabilities, footer: { account: "Total liabilities", amount: tl } },
      { heading: "Equity", columns: cols, rows: equity, footer: { account: "Total equity", amount: te } },
    ],
  };
}

export function trialBalance(companyId: number, { to }: Range): Report {
  const b = balances(companyId, null, to).filter((a) => a.dr || a.cr);
  const rows = b.map((a) => {
    const net = r2(a.dr - a.cr);
    return { account: `${a.code} ${a.name}`, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
  const td = r2(rows.reduce((s, r) => s + r.debit, 0));
  const tc = r2(rows.reduce((s, r) => s + r.credit, 0));
  return {
    title: `Trial Balance as of ${to}`,
    summary: [{ label: "Total debit", value: td, kind: "money" }, { label: "Total credit", value: tc, kind: "money", tone: Math.abs(td - tc) < 0.01 ? "good" : "bad" }],
    sections: [{ columns: [T("account", "Account"), T("type", "Type"), M("debit", "Debit"), M("credit", "Credit")], rows, footer: { account: "Total", debit: td, credit: tc } }],
  };
}

export function generalLedger(companyId: number, { from, to }: Range): Report {
  const rows = all(
    `SELECT j.date, j.number, a.code || ' ' || a.name account, COALESCE(l.memo, j.memo) memo, l.debit, l.credit
       FROM journal_entries_lines l JOIN journal_entries j ON j.id=l.doc_id
       JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=? AND j.status='Posted' AND j.date BETWEEN ? AND ?
      ORDER BY a.code, j.date, j.id LIMIT 2000`,
    companyId, from, to,
  );
  return {
    title: "General Ledger",
    note: rows.length === 2000 ? "Showing the first 2,000 lines. Narrow the date range to see more." : undefined,
    sections: [{ columns: [T("account", "Account"), T("date", "Date"), T("number", "Entry"), T("memo", "Memo"), M("debit", "Debit"), M("credit", "Credit")], rows }],
  };
}

export function cashFlow(companyId: number, { from, to }: Range): Report {
  const cashIds = all<Row>(`SELECT id FROM accounts WHERE company_id=? AND code IN ('1000','1010')`, companyId).map((a) => a.id);
  if (!cashIds.length) return { title: "Cash Flow", sections: [] };
  const ph = cashIds.map(() => "?").join(",");
  const opening = n(get<Row>(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_entries_lines l JOIN journal_entries j ON j.id=l.doc_id
      WHERE j.company_id=? AND j.status='Posted' AND j.date < ? AND l.account_id IN (${ph})`, companyId, from, ...cashIds)?.v);
  const months = all<Row>(
    `SELECT substr(j.date,1,7) month, COALESCE(SUM(l.debit),0) inflow, COALESCE(SUM(l.credit),0) outflow
       FROM journal_entries_lines l JOIN journal_entries j ON j.id=l.doc_id
      WHERE j.company_id=? AND j.status='Posted' AND j.date BETWEEN ? AND ? AND l.account_id IN (${ph})
      GROUP BY month ORDER BY month`, companyId, from, to, ...cashIds);
  let bal = opening;
  const rows = months.map((m) => {
    const open = bal;
    bal = r2(bal + n(m.inflow) - n(m.outflow));
    return { month: m.month, opening: r2(open), inflow: n(m.inflow), outflow: n(m.outflow), closing: bal };
  });
  return {
    title: "Cash Flow (Cash in Hand + Bank)",
    summary: [
      { label: "Opening cash", value: r2(opening), kind: "money" },
      { label: "Net movement", value: r2(bal - opening), kind: "money", tone: bal - opening >= 0 ? "good" : "bad" },
      { label: "Closing cash", value: r2(bal), kind: "money" },
    ],
    sections: [{ columns: [T("month", "Month"), M("opening", "Opening"), M("inflow", "Cash in"), M("outflow", "Cash out"), M("closing", "Closing")], rows }],
  };
}

export function budgetVsActual(companyId: number): Report {
  const rows = all<Row>(
    `SELECT b.period, a.code || ' ' || a.name account, a.type, b.amount budget,
            COALESCE((SELECT SUM(CASE WHEN a.type='Income' THEN l.credit-l.debit ELSE l.debit-l.credit END)
                        FROM journal_entries_lines l JOIN journal_entries j ON j.id=l.doc_id
                       WHERE l.account_id=b.account_id AND j.status='Posted' AND j.company_id=b.company_id
                         AND substr(j.date,1,7)=b.period),0) actual
       FROM budgets b JOIN accounts a ON a.id=b.account_id
      WHERE b.company_id=? ORDER BY b.period DESC, a.code`, companyId,
  ).map((r) => ({ ...r, budget: n(r.budget), actual: r2(n(r.actual)), variance: r2(n(r.budget) - n(r.actual)), used: n(r.budget) ? `${Math.round((n(r.actual) / n(r.budget)) * 100)}%` : "—" }));
  return {
    title: "Budget vs Actual",
    note: rows.length ? "Variance = budget − actual. For expense accounts a negative variance means over budget." : "No budgets yet. Add them under Financial Management → Budget Management.",
    sections: [{ columns: [T("period", "Month"), T("account", "Account"), M("budget", "Budget"), M("actual", "Actual"), M("variance", "Variance"), T("used", "Used")], rows }],
  };
}

export function inventoryReport(companyId: number): Report {
  const rows = all<Row>(
    `SELECT i.code, i.name, i.category, i.avg_cost, i.reorder_level, w.name warehouse, COALESCE(SUM(m.qty),0) qty
       FROM items i
       LEFT JOIN stock_moves m ON m.item_id=i.id
       LEFT JOIN warehouses w ON w.id=m.warehouse_id
      WHERE i.company_id=? AND i.type<>'Service'
      GROUP BY i.id, m.warehouse_id ORDER BY i.code, w.name`, companyId,
  ).filter((r) => r.warehouse || true).map((r) => ({ ...r, qty: r2(n(r.qty)), value: r2(n(r.qty) * n(r.avg_cost)), warehouse: r.warehouse ?? "—" }));
  const total = r2(rows.reduce((s, r) => s + r.value, 0));
  const low = all<Row>(
    `SELECT i.code, i.name, i.reorder_level, COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.item_id=i.id),0) qty
       FROM items i WHERE i.company_id=? AND i.type<>'Service' ORDER BY i.code`, companyId,
  ).filter((r) => n(r.qty) <= n(r.reorder_level)).map((r) => ({ ...r, qty: r2(n(r.qty)) }));
  return {
    title: "Inventory Report",
    summary: [{ label: "Stock value (avg cost)", value: total, kind: "money" }, { label: "Items at/below reorder level", value: low.length, kind: "text", tone: low.length ? "bad" : "good" }],
    sections: [
      { heading: "Stock by item and warehouse", columns: [T("code", "Code"), T("name", "Item"), T("category", "Category"), T("warehouse", "Warehouse"), N("qty", "Qty"), M("avg_cost", "Avg cost"), M("value", "Value")], rows, footer: { name: "Total", value: total } },
      { heading: "Low stock alerts", columns: [T("code", "Code"), T("name", "Item"), N("qty", "On hand"), N("reorder_level", "Reorder level")], rows: low },
    ],
  };
}

export function salesReport(companyId: number, { from, to }: Range): Report {
  const byCustomer = all<Row>(
    `SELECT COALESCE(c.name,'—') customer, COUNT(*) docs, SUM(i.total) total, SUM(COALESCE(i.paid,0)) paid
       FROM sales_invoices i LEFT JOIN customers c ON c.id=i.party_id
      WHERE i.company_id=? AND i.status IN ('Posted','Partially Paid','Paid') AND i.date BETWEEN ? AND ?
      GROUP BY i.party_id ORDER BY total DESC`, companyId, from, to);
  const byItem = all<Row>(
    `SELECT it.name item, SUM(l.qty) qty, SUM(l.amount) amount FROM sales_invoices_lines l
       JOIN sales_invoices i ON i.id=l.doc_id JOIN items it ON it.id=l.item_id
      WHERE i.company_id=? AND i.status IN ('Posted','Partially Paid','Paid') AND i.date BETWEEN ? AND ?
      GROUP BY l.item_id ORDER BY amount DESC LIMIT 50`, companyId, from, to);
  const pos = get<Row>(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM pos_sales WHERE company_id=? AND date BETWEEN ? AND ?`, companyId, from, to)!;
  const inv = r2(byCustomer.reduce((s, r) => s + n(r.total), 0));
  return {
    title: "Sales Report",
    summary: [
      { label: "Invoiced", value: inv, kind: "money" },
      { label: "POS sales", value: r2(n(pos.t)), kind: "money" },
      { label: "Total sales", value: r2(inv + n(pos.t)), kind: "money", tone: "good" },
    ],
    sections: [
      { heading: "By customer (invoices)", columns: [T("customer", "Customer"), N("docs", "Invoices"), M("total", "Total"), M("paid", "Received")], rows: byCustomer },
      { heading: "By item (invoices)", columns: [T("item", "Item"), N("qty", "Qty sold"), M("amount", "Amount")], rows: byItem },
    ],
  };
}

export function purchaseReport(companyId: number, { from, to }: Range): Report {
  const byVendor = all<Row>(
    `SELECT COALESCE(v.name,'—') vendor, COUNT(*) docs, SUM(b.total) total, SUM(COALESCE(b.paid,0)) paid
       FROM purchase_bills b LEFT JOIN vendors v ON v.id=b.party_id
      WHERE b.company_id=? AND b.status IN ('Posted','Partially Paid','Paid') AND b.date BETWEEN ? AND ?
      GROUP BY b.party_id ORDER BY total DESC`, companyId, from, to);
  const byItem = all<Row>(
    `SELECT it.name item, SUM(l.qty) qty, SUM(l.amount) amount FROM purchase_bills_lines l
       JOIN purchase_bills b ON b.id=l.doc_id JOIN items it ON it.id=l.item_id
      WHERE b.company_id=? AND b.status IN ('Posted','Partially Paid','Paid') AND b.date BETWEEN ? AND ?
      GROUP BY l.item_id ORDER BY amount DESC LIMIT 50`, companyId, from, to);
  return {
    title: "Purchase Report",
    summary: [{ label: "Total purchases", value: r2(byVendor.reduce((s, r) => s + n(r.total), 0)), kind: "money" }],
    sections: [
      { heading: "By vendor", columns: [T("vendor", "Vendor"), N("docs", "Bills"), M("total", "Total"), M("paid", "Paid")], rows: byVendor },
      { heading: "By item", columns: [T("item", "Item"), N("qty", "Qty bought"), M("amount", "Amount")], rows: byItem },
    ],
  };
}

function aging(docs: Row[], asOf: string, partyKey: string) {
  const asOfMs = Date.parse(asOf);
  const rows = docs.map((d) => {
    const base = Date.parse(d.due_date || d.date);
    const days = Math.max(0, Math.floor((asOfMs - base) / 86400000));
    const out = r2(n(d.total) - n(d.paid));
    const bucket = days === 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90p";
    return { party: d[partyKey], number: d.number, due_date: d.due_date || d.date, days, outstanding: out, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, [bucket]: out };
  });
  const sum = (k: string) => r2(rows.reduce((s, r: Row) => s + n(r[k]), 0));
  return {
    rows,
    footer: { party: "Total", outstanding: sum("outstanding"), current: sum("current"), d30: sum("d30"), d60: sum("d60"), d90: sum("d90"), d90p: sum("d90p") },
  };
}

const agingCols = (partyLabel: string): Col[] => [
  T("party", partyLabel), T("number", "Document"), T("due_date", "Due"), N("days", "Days overdue"),
  M("outstanding", "Outstanding"), M("current", "Not due"), M("d30", "1–30"), M("d60", "31–60"), M("d90", "61–90"), M("d90p", "90+"),
];

export function receivables(companyId: number, { to }: Range): Report {
  const docs = all<Row>(
    `SELECT i.number, i.date, i.due_date, i.total, COALESCE(i.paid,0) paid, c.name customer
       FROM sales_invoices i LEFT JOIN customers c ON c.id=i.party_id
      WHERE i.company_id=? AND i.status IN ('Posted','Partially Paid') ORDER BY COALESCE(i.due_date,i.date)`, companyId);
  const a = aging(docs, to, "customer");
  return {
    title: `Receivables Aging as of ${to}`,
    summary: [{ label: "Total outstanding", value: a.footer.outstanding, kind: "money" }, { label: "Over 30 days", value: r2(a.footer.d60 + a.footer.d90 + a.footer.d90p), kind: "money", tone: "bad" }],
    sections: [{ columns: agingCols("Customer"), rows: a.rows, footer: a.footer }],
  };
}

export function payables(companyId: number, { to }: Range): Report {
  const docs = all<Row>(
    `SELECT b.number, b.date, b.due_date, b.total, COALESCE(b.paid,0) paid, v.name vendor
       FROM purchase_bills b LEFT JOIN vendors v ON v.id=b.party_id
      WHERE b.company_id=? AND b.status IN ('Posted','Partially Paid') ORDER BY COALESCE(b.due_date,b.date)`, companyId);
  const a = aging(docs, to, "vendor");
  return {
    title: `Payables Aging as of ${to}`,
    summary: [{ label: "Total payable", value: a.footer.outstanding, kind: "money" }],
    sections: [{ columns: agingCols("Vendor"), rows: a.rows, footer: a.footer }],
  };
}

export function outletComparison(companyId: number, { from, to }: Range): Report {
  const rows = all<Row>(
    `SELECT w.name outlet, COUNT(p.id) sales, COALESCE(SUM(p.total),0) total, COALESCE(SUM(p.discount),0) discount
       FROM warehouses w LEFT JOIN pos_sales p ON p.warehouse_id=w.id AND p.date BETWEEN ? AND ?
      WHERE w.company_id=? AND w.type='Outlet' GROUP BY w.id ORDER BY total DESC`, from, to, companyId,
  ).map((r) => {
    const stock = n(get<Row>(
      `SELECT COALESCE(SUM(m.qty*i.avg_cost),0) v FROM stock_moves m JOIN items i ON i.id=m.item_id WHERE m.company_id=? AND m.warehouse_id=(SELECT id FROM warehouses WHERE company_id=? AND name=? AND type='Outlet' LIMIT 1)`,
      companyId, companyId, r.outlet)?.v);
    return { ...r, total: r2(n(r.total)), avg: r.sales ? r2(n(r.total) / r.sales) : 0, stock: r2(stock) };
  });
  return {
    title: "Outlet Comparison (POS)",
    sections: [{ columns: [T("outlet", "Outlet"), N("sales", "Sales count"), M("total", "Sales total"), M("avg", "Average ticket"), M("discount", "Discounts"), M("stock", "Stock value")], rows }],
    note: rows.length ? undefined : "No outlets yet. Create outlets under POS → Multi Outlet Setup.",
  };
}

export function buildReport(key: string, companyId: number, range: Range): Report | null {
  switch (key) {
    case "profit-loss": return profitLoss(companyId, range);
    case "balance-sheet": return balanceSheet(companyId, range);
    case "trial-balance": return trialBalance(companyId, range);
    case "general-ledger": return generalLedger(companyId, range);
    case "cash-flow": return cashFlow(companyId, range);
    case "budget-vs-actual": return budgetVsActual(companyId);
    case "inventory": return inventoryReport(companyId);
    case "sales": return salesReport(companyId, range);
    case "purchases": return purchaseReport(companyId, range);
    case "receivables": return receivables(companyId, range);
    case "payables": return payables(companyId, range);
    case "outlets": return outletComparison(companyId, range);
    default: return null;
  }
}
