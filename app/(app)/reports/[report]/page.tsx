import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { REPORTS } from "@/lib/nav";
import { buildReport } from "@/lib/reports";
import { plain, today } from "@/lib/format";
import PrintButton from "@/components/PrintButton";
import { first } from "@/components/Flash";

type SP = Record<string, string | string[] | undefined>;
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function ReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<SP> }) {
  const s = await requireSession();
  const { report } = await params;
  const sp = await searchParams;
  const def = REPORTS.find((r) => r.key === report);
  if (!def) notFound();

  const fromQ = first(sp.from);
  const toQ = first(sp.to);
  const from = isDate(fromQ) ? fromQ! : `${today().slice(0, 4)}-01-01`;
  const to = isDate(toQ) ? toQ! : today();
  const data = buildReport(report, s.companyId, { from, to })!;

  const cell = (kind: string | undefined, v: unknown) =>
    kind === "money" ? plain(v) : kind === "num" ? Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) : (v ?? "");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href="/m/reports" className="text-sm text-teal-700 hover:underline">← Reports</Link>
          <h1 className="text-2xl font-bold">{def.label}</h1>
          <p className="text-sm text-slate-500">{def.desc}</p>
        </div>
        <PrintButton />
      </div>

      {def.range && def.range !== "none" && (
        <form className="card flex flex-wrap items-end gap-3 p-4 print:hidden">
          {def.range === "period" && (
            <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
          )}
          <div><label className="label" htmlFor="to">{def.range === "period" ? "To" : "As of"}</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
          <button className="btn btn-primary">Run report</button>
        </form>
      )}

      <div className="hidden print:block"><h1 className="text-xl font-bold">{s.companyName} — {data.title}</h1></div>

      {data.summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.summary.map((x) => (
            <div key={x.label} className="card p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">{x.label}</div>
              <div className={`text-xl font-semibold ${x.tone === "bad" ? "text-red-600" : x.tone === "good" ? "text-teal-700" : ""}`}>
                {x.kind === "money" ? `${s.currency} ${plain(x.value)}` : x.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{data.note}</p>}

      {data.sections.map((sec, i) => (
        <section key={i} className="card overflow-x-auto">
          {sec.heading && <h2 className="border-b px-4 py-3 font-semibold">{sec.heading}</h2>}
          <table className="tbl min-w-[560px]">
            <thead><tr>{sec.columns.map((c) => <th key={c.key} className={c.kind && c.kind !== "text" ? "text-right" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>
              {sec.rows.length === 0 && <tr><td colSpan={sec.columns.length} className="py-8 text-center text-slate-500">No data for this period.</td></tr>}
              {sec.rows.map((r, ri) => (
                <tr key={ri}>{sec.columns.map((c) => <td key={c.key} className={c.kind && c.kind !== "text" ? "text-right tabular-nums" : ""}>{String(cell(c.kind, r[c.key]))}</td>)}</tr>
              ))}
            </tbody>
            {sec.footer && (
              <tfoot><tr className="bg-slate-50 font-semibold">
                {sec.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.kind && c.kind !== "text" ? "text-right tabular-nums" : ""}`}>{sec.footer![c.key] != null ? String(cell(c.kind, sec.footer![c.key])) : ""}</td>)}
              </tr></tfoot>
            )}
          </table>
        </section>
      ))}
    </div>
  );
}
