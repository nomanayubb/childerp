import { MODULES, entitiesOf } from "./schema";

export interface ReportDef { key: string; label: string; desc: string; range?: "period" | "asof" | "none" }

export const REPORTS: ReportDef[] = [
  { key: "profit-loss", label: "Profit & Loss", desc: "Income and expenses for a period", range: "period" },
  { key: "balance-sheet", label: "Balance Sheet", desc: "Assets, liabilities and equity as of a date", range: "asof" },
  { key: "trial-balance", label: "Trial Balance", desc: "Debit and credit totals per account", range: "asof" },
  { key: "general-ledger", label: "General Ledger", desc: "Every posted journal line by account", range: "period" },
  { key: "cash-flow", label: "Cash Flow", desc: "Cash and bank inflows and outflows by month", range: "period" },
  { key: "budget-vs-actual", label: "Budget vs Actual", desc: "Budgeted amounts compared with ledger actuals", range: "none" },
  { key: "inventory", label: "Inventory Report", desc: "Stock on hand and valuation by item and warehouse", range: "none" },
  { key: "sales", label: "Sales Report", desc: "Posted invoices and POS sales by customer and item", range: "period" },
  { key: "purchases", label: "Purchase Report", desc: "Posted purchase bills by vendor", range: "period" },
  { key: "receivables", label: "Receivables Aging", desc: "Overdue customer invoices for payment recovery", range: "asof" },
  { key: "payables", label: "Payables Aging", desc: "Outstanding vendor bills by age", range: "asof" },
  { key: "outlets", label: "Outlet Comparison", desc: "POS sales compared across outlets", range: "period" },
];

const EXTRA: Record<string, { href: string; label: string }[]> = {
  sales: [{ href: "/reports/receivables", label: "Overdue invoices" }],
  inventory: [{ href: "/reports/inventory", label: "Stock report" }],
  accounting: [
    { href: "/reports/cash-flow", label: "Cash flow" },
    { href: "/reports/budget-vs-actual", label: "Budget vs actual" },
  ],
  pos: [{ href: "/pos", label: "▶ POS terminal" }, { href: "/reports/outlets", label: "Comparative reports" }],
};

export function navModules() {
  return MODULES.map((m) => {
    const items =
      m.key === "reports"
        ? REPORTS.map((r) => ({ href: `/reports/${r.key}`, label: r.label }))
        : [
            ...(m.key === "pos" ? EXTRA.pos.slice(0, 1) : []),
            ...entitiesOf(m.key).map((e) => ({ href: `/e/${e.key}`, label: e.plural })),
            ...(EXTRA[m.key] ?? []).filter((x) => m.key !== "pos" || x.href !== "/pos"),
          ];
    return { key: m.key, label: m.label, icon: m.icon, items };
  });
}
