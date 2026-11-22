import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { plain } from "@/lib/format";
import { MODULES } from "@/lib/schema";

const n = (v: unknown) => Number(v ?? 0) || 0;

export default async function Dashboard() {
  const s = await requireSession();
  const c = s.companyId;
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const salesMonth = n(get(`SELECT SUM(total) v FROM sales_invoices WHERE company_id=? AND status IN ('Posted','Partially Paid','Paid') AND substr(date,1,7)=?`, c, month)?.v)
    + n(get(`SELECT SUM(total) v FROM pos_sales WHERE company_id=? AND substr(date,1,7)=?`, c, month)?.v);
  const receivable = n(get(`SELECT SUM(total-COALESCE(paid,0)) v FROM sales_invoices WHERE company_id=? AND status IN ('Posted','Partially Paid')`, c)?.v);
  const overdue = n(get(`SELECT SUM(total-COALESCE(paid,0)) v FROM sales_invoices WHERE company_id=? AND status IN ('Posted','Partially Paid') AND COALESCE(due_date,date) < ?`, c, today)?.v);
  const payable = n(get(`SELECT SUM(total-COALESCE(paid,0)) v FROM purchase_bills WHERE company_id=? AND status IN ('Posted','Partially Paid')`, c)?.v);
  const cash = n(get(`SELECT SUM(l.debit-l.credit) v FROM journal_entries_lines l JOIN journal_entries j ON j.id=l.doc_id JOIN accounts a ON a.id=l.account_id WHERE j.company_id=? AND j.status='Posted' AND a.code IN ('1000','1010')`, c)?.v);
  const stockValue = n(get(`SELECT SUM(m.qty*i.avg_cost) v FROM stock_moves m JOIN items i ON i.id=m.item_id WHERE m.company_id=?`, c)?.v);
  const openLeads = n(get(`SELECT COUNT(*) v FROM leads WHERE company_id=? AND status NOT IN ('Won','Lost')`, c)?.v);
  const employees = n(get(`SELECT COUNT(*) v FROM employees WHERE company_id=? AND status='Active'`, c)?.v);
  const pendingPO = n(get(`SELECT COUNT(*) v FROM purchase_orders WHERE company_id=? AND status='Pending Approval'`, c)?.v);
  const activeProjects = n(get(`SELECT COUNT(*) v FROM projects WHERE company_id=? AND status='Active'`, c)?.v);

  // Last 6 months of sales for the bar chart.
  const months: { m: string; v: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    const v = n(get(`SELECT SUM(total) v FROM sales_invoices WHERE company_id=? AND status IN ('Posted','Partially Paid','Paid') AND substr(date,1,7)=?`, c, key)?.v)
      + n(get(`SELECT SUM(total) v FROM pos_sales WHERE company_id=? AND substr(date,1,7)=?`, c, key)?.v);
    months.push({ m: key, v });
  }
  const max = Math.max(...months.map((x) => x.v), 1);

  const recent = all<any>(
    `SELECT i.id, i.number, i.date, i.total, i.status, c.name customer FROM sales_invoices i LEFT JOIN customers c ON c.id=i.party_id WHERE i.company_id=? ORDER BY i.id DESC LIMIT 6`, c);
  const low = all<any>(
    `SELECT i.id, i.name, i.reorder_level, COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.item_id=i.id),0) qty FROM items i WHERE i.company_id=? AND i.type<>'Service' ORDER BY i.name`, c)
    .filter((r) => n(r.qty) <= n(r.reorder_level)).slice(0, 6);

  const cards: { label: string; value: string; href: string; tone?: string }[] = [
    { label: "Sales this month", value: `${s.currency} ${plain(salesMonth)}`, href: "/reports/sales" },
    { label: "Receivables", value: `${s.currency} ${plain(receivable)}`, href: "/reports/receivables" },
    { label: "Overdue", value: `${s.currency} ${plain(overdue)}`, href: "/reports/receivables", tone: overdue > 0 ? "text-red-600" : "" },
    { label: "Payables", value: `${s.currency} ${plain(payable)}`, href: "/reports/payables" },
    { label: "Cash & bank", value: `${s.currency} ${plain(cash)}`, href: "/reports/cash-flow" },
    { label: "Stock value", value: `${s.currency} ${plain(stockValue)}`, href: "/reports/inventory" },
    { label: "Open leads", value: String(openLeads), href: "/e/leads" },
    { label: "Active employees", value: String(employees), href: "/e/employees" },
    { label: "POs awaiting approval", value: String(pendingPO), href: "/e/purchase_orders" },
    { label: "Active projects", value: String(activeProjects), href: "/e/projects" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {s.name}</h1>
        <p className="text-slate-500">Live overview of {s.companyName}.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((k) => (
          <Link key={k.label} href={k.href} className="card p-4 transition hover:border-teal-500">
            <div className="text-xs uppercase tracking-wide text-slate-500">{k.label}</div>
            <div className={`mt-1 text-lg font-semibold ${k.tone ?? ""}`}>{k.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Sales — last 6 months</h2>
          <div className="flex h-44 items-end gap-3" role="img" aria-label="Sales by month bar chart">
            {months.map((x) => (
              <div key={x.m} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-xs text-slate-500">{x.v ? plain(x.v) : ""}</div>
                <div className="w-full rounded-t bg-teal-600" style={{ height: `${Math.max((x.v / max) * 100, x.v ? 3 : 0)}%` }} />
                <div className="text-xs text-slate-500">{x.m.slice(5)}/{x.m.slice(2, 4)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Low stock</h2>
          {low.length === 0 ? <p className="text-sm text-slate-500">Nothing at or below reorder level.</p> : (
            <ul className="space-y-2 text-sm">
              {low.map((i) => (
                <li key={i.id} className="flex justify-between"><Link href={`/e/items/${i.id}`} className="text-teal-700 hover:underline">{i.name}</Link><span className="text-red-600">{plain(i.qty)} left</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">Recent invoices</h2>
          <Link href="/e/sales_invoices/new" className="btn btn-primary">+ New invoice</Link>
        </div>
        <table className="tbl min-w-[500px]">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-right">Total</th><th>Status</th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No invoices yet. Start by adding a customer and some items.</td></tr>}
            {recent.map((r) => (
              <tr key={r.id}><td><Link className="text-teal-700 hover:underline" href={`/e/sales_invoices/${r.id}`}>{r.number}</Link></td><td>{r.customer}</td><td>{r.date}</td><td className="text-right">{plain(r.total)}</td><td><span className="badge">{r.status}</span></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">All modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Link key={m.key} href={`/m/${m.key}`} className="card p-4 transition hover:border-teal-500">
              <div className="text-2xl" aria-hidden>{m.icon}</div>
              <div className="font-semibold">{m.label}</div>
              <div className="text-xs text-slate-500">{m.desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
