import Link from "next/link";
import { all, get } from "@/lib/db";
import { plain } from "@/lib/format";
import { num } from "@/lib/crud";
import { buildPayload, fbrLog, fbrSettings } from "@/lib/fbr";
import { fbrSend } from "@/lib/actions";

type Row = Record<string, any>;

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card p-5"><h2 className="mb-3 font-semibold">{title}</h2>{children}</section>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

export default function Panel({ kind, companyId, row }: { kind: string; companyId: number; row: Row }) {
  if (kind === "fbr") {
    const st = fbrSettings(companyId);
    const accepted = row.fbr_status === "Accepted";
    const problems: string[] = accepted ? [] : buildPayload(companyId, row.id).problems;
    const log = fbrLog(companyId, row.id);
    const send = (action: "validate" | "post", label: string, primary: boolean, disabled: boolean) => (
      <form action={fbrSend}>
        <input type="hidden" name="__id" value={row.id} />
        <input type="hidden" name="__action" value={action} />
        <button className={`btn ${primary ? "btn-primary" : ""}`} disabled={disabled}>{label}</button>
      </form>
    );
    return (
      <Box title="FBR digital invoicing">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span className={`badge ${accepted ? "!bg-teal-100 !text-teal-800" : row.fbr_status === "Rejected" ? "!bg-red-100 !text-red-700" : ""}`}>{row.fbr_status}</span>
          <span className="badge">{st.env === "production" ? "Production" : "Sandbox"}</span>
          {row.fbr_invoice_no && <span>IRN: <strong className="font-mono">{row.fbr_invoice_no}</strong></span>}
        </div>
        {!st.hasToken && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">No FBR token saved yet. An administrator can add it under <Link className="underline" href="/settings">Settings</Link>.</p>}
        {row.fbr_error && !accepted && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">FBR said: {row.fbr_error}</p>}
        {problems.length > 0 && (
          <div className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
            <div className="mb-1 font-medium">Fix before sending:</div>
            <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        {!accepted && (
          <div className="mb-4 flex flex-wrap gap-2">
            {send("validate", "Check with FBR", false, !st.hasToken || problems.length > 0)}
            {send("post", st.env === "production" ? "Submit to FBR (production)" : "Submit to FBR (sandbox)", true, !st.hasToken || problems.length > 0)}
          </div>
        )}
        {accepted && <p className="mb-3 text-sm text-slate-600">Accepted by FBR on {row.fbr_submitted_at}. The invoice is locked; print it to show the QR code.</p>}
        {log.length > 0 && (
          <table className="tbl"><thead><tr><th>When</th><th>Action</th><th>Env</th><th>HTTP</th><th>Result</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.id}><td>{l.created_at}</td><td>{l.action}</td><td>{l.env}</td><td>{l.http_status ?? "—"}</td><td className={l.ok ? "text-teal-700" : "text-red-700"}>{l.message}</td></tr>)}</tbody></table>
        )}
      </Box>
    );
  }
  if (kind === "customer") {
    const inv = all<Row>(`SELECT id, number, date, due_date, total, paid, status FROM sales_invoices WHERE company_id=? AND party_id=? ORDER BY id DESC LIMIT 20`, companyId, row.id);
    const open = inv.filter((i) => ["Posted", "Partially Paid"].includes(i.status)).reduce((s, i) => s + num(i.total) - num(i.paid), 0);
    return (
      <Box title="Account summary">
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Outstanding" value={plain(open)} />
          <Stat label="Credit limit" value={plain(row.credit_limit)} />
          <Stat label="Invoices" value={String(inv.length)} />
        </div>
        {num(row.credit_limit) > 0 && open > num(row.credit_limit) && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">Outstanding balance is above the credit limit.</p>}
        <InvoiceTable rows={inv} base="sales_invoices" />
      </Box>
    );
  }
  if (kind === "vendor") {
    const bills = all<Row>(`SELECT id, number, date, due_date, total, paid, status FROM purchase_bills WHERE company_id=? AND party_id=? ORDER BY id DESC LIMIT 20`, companyId, row.id);
    const open = bills.filter((i) => ["Posted", "Partially Paid"].includes(i.status)).reduce((s, i) => s + num(i.total) - num(i.paid), 0);
    return (
      <Box title="Account summary">
        <div className="mb-4"><Stat label="We owe this vendor" value={plain(open)} /></div>
        <InvoiceTable rows={bills} base="purchase_bills" />
      </Box>
    );
  }
  if (kind === "item") {
    const stock = all<Row>(
      `SELECT w.name, COALESCE(SUM(m.qty),0) qty FROM warehouses w LEFT JOIN stock_moves m ON m.warehouse_id=w.id AND m.item_id=? WHERE w.company_id=? GROUP BY w.id ORDER BY w.name`,
      row.id, companyId,
    );
    const total = stock.reduce((s, w) => s + num(w.qty), 0);
    return (
      <Box title="Stock by warehouse">
        <div className="mb-3 grid grid-cols-3 gap-4">
          <Stat label="On hand" value={plain(total)} />
          <Stat label="Value (avg cost)" value={plain(total * num(row.avg_cost))} />
          <Stat label="Reorder level" value={plain(row.reorder_level)} />
        </div>
        {total <= num(row.reorder_level) && row.type !== "Service" && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">Stock is at or below the reorder level.</p>}
        <table className="tbl"><thead><tr><th>Warehouse / outlet</th><th className="text-right">Qty</th></tr></thead>
          <tbody>{stock.map((w) => <tr key={w.name}><td>{w.name}</td><td className="text-right">{plain(w.qty)}</td></tr>)}</tbody></table>
      </Box>
    );
  }
  if (kind === "production") {
    const bom = get<Row>(`SELECT * FROM boms WHERE id=? AND company_id=?`, row.bom_id, companyId);
    if (!bom) return null;
    const comps = all<Row>(
      `SELECT i.name, i.avg_cost, l.qty FROM boms_lines l JOIN items i ON i.id=l.item_id WHERE l.doc_id=?`, bom.id,
    );
    const factor = num(row.qty) / Math.max(num(bom.output_qty), 0.0001);
    const est = comps.reduce((s, c) => s + c.qty * factor * num(c.avg_cost), 0);
    return (
      <Box title={row.status === "Completed" ? "Job costing (actual)" : "Job costing (estimate at current average cost)"}>
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Material" value={plain(row.status === "Completed" ? row.material_cost : est)} />
          <Stat label="Labor" value={plain(row.labor_cost)} />
          <Stat label="Overhead" value={plain(row.overhead_cost)} />
          <Stat label="Cost / unit" value={plain(row.status === "Completed" ? row.unit_cost : (est + num(row.labor_cost) + num(row.overhead_cost)) / Math.max(num(row.qty), 1))} />
        </div>
        <table className="tbl"><thead><tr><th>Component</th><th className="text-right">Qty needed</th></tr></thead>
          <tbody>{comps.map((c) => <tr key={c.name}><td>{c.name}</td><td className="text-right">{plain(c.qty * factor)}</td></tr>)}</tbody></table>
      </Box>
    );
  }
  if (kind === "project") {
    const boq = get<Row>(`SELECT COALESCE(SUM(amount),0) v FROM boq_items WHERE company_id=? AND project_id=?`, companyId, row.id)!.v;
    const time = get<Row>(`SELECT COALESCE(SUM(cost),0) v, COALESCE(SUM(hours),0) h FROM time_entries WHERE company_id=? AND project_id=?`, companyId, row.id)!;
    const exp = get<Row>(`SELECT COALESCE(SUM(amount),0) v FROM project_expenses WHERE company_id=? AND project_id=?`, companyId, row.id)!.v;
    const tasks = all<Row>(`SELECT title, status, progress, due_date FROM tasks WHERE company_id=? AND project_id=? ORDER BY due_date`, companyId, row.id);
    const actual = num(time.v) + num(exp);
    const progress = tasks.length ? tasks.reduce((s, t) => s + num(t.progress), 0) / tasks.length : 0;
    const over = actual > num(row.budget) && num(row.budget) > 0;
    return (
      <Box title="Project budgeting & progress">
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Budget" value={plain(row.budget)} />
          <Stat label="BOQ value" value={plain(boq)} />
          <Stat label={`Labor (${plain(time.h)} h)`} value={plain(time.v)} />
          <Stat label="Expenses" value={plain(exp)} />
          <Stat label="Actual cost" value={plain(actual)} />
        </div>
        {over && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">Actual cost is over budget by {plain(actual - num(row.budget))}.</p>}
        <p className="mb-2 text-sm">Task progress: <strong>{progress.toFixed(0)}%</strong></p>
        <div className="mb-4 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-teal-600" style={{ width: `${Math.min(progress, 100)}%` }} /></div>
        {tasks.length > 0 && (
          <table className="tbl"><thead><tr><th>Task</th><th>Due</th><th>Status</th><th className="text-right">%</th></tr></thead>
            <tbody>{tasks.map((t, i) => <tr key={i}><td>{t.title}</td><td>{t.due_date}</td><td><span className="badge">{t.status}</span></td><td className="text-right">{t.progress}</td></tr>)}</tbody></table>
        )}
      </Box>
    );
  }
  return null;
}

function InvoiceTable({ rows, base }: { rows: Row[]; base: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No documents yet.</p>;
  return (
    <table className="tbl"><thead><tr><th>Number</th><th>Date</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><td><Link className="text-teal-700 hover:underline" href={`/e/${base}/${r.id}`}>{r.number}</Link></td><td>{r.date}</td><td>{r.due_date}</td>
          <td className="text-right">{plain(r.total)}</td><td className="text-right">{plain(r.paid)}</td><td><span className="badge">{r.status}</span></td></tr>
      ))}</tbody></table>
  );
}
