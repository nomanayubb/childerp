import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { entityMap } from "@/lib/schema";
import { listRows } from "@/lib/crud";
import { doListAction } from "@/lib/actions";
import { plain } from "@/lib/format";
import Flash, { first } from "@/components/Flash";
import ConfirmButton from "@/components/ConfirmButton";

type SP = Record<string, string | string[] | undefined>;

export default async function EntityList({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<SP> }) {
  const s = await requireSession();
  const { entity } = await params;
  const sp = await searchParams;
  const e = entityMap[entity];
  if (!e) notFound();

  const q = first(sp.q) ?? "";
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const { rows, total, pageSize } = listRows(s.companyId, e, { q, page });
  const cols = e.fields.filter((f) => f.list);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{e.plural}</h1>
        <div className="flex flex-wrap gap-2">
          {e.listActions?.map((a) => (
            <form key={a.key} action={doListAction}>
              <input type="hidden" name="__entity" value={e.key} />
              <input type="hidden" name="__action" value={a.key} />
              <ConfirmButton message={a.confirm} className={`btn ${a.style === "primary" ? "btn-primary" : ""}`}>{a.label}</ConfirmButton>
            </form>
          ))}
          {e.key === "pos_sales" && <Link href="/pos" className="btn btn-primary">Open POS terminal</Link>}
          {!e.noCreate && <Link href={`/e/${e.key}/new`} className="btn btn-primary">+ New {e.label.toLowerCase()}</Link>}
        </div>
      </div>

      <Flash msg={first(sp.msg)} error={first(sp.error)} />

      <form className="mb-3 flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder={`Search ${e.plural.toLowerCase()}…`} className="input max-w-sm" aria-label="Search" />
        <button className="btn">Search</button>
        {q && <Link href={`/e/${e.key}`} className="btn">Clear</Link>}
      </form>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[600px]">
          <thead><tr>{cols.map((f) => <th key={f.name} className={f.type === "money" || f.type === "number" ? "text-right" : ""}>{f.label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length} className="py-10 text-center text-slate-500">
                No {e.plural.toLowerCase()} yet.{!e.noCreate && <> <Link className="text-teal-700 underline" href={`/e/${e.key}/new`}>Create the first one</Link>.</>}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                {cols.map((f, ci) => {
                  const raw = r[f.name];
                  const text =
                    f.type === "ref" ? r[`${f.name}__label`]
                    : f.type === "money" ? plain(raw)
                    : f.type === "number" ? String(raw ?? 0)
                    : f.type === "bool" ? (raw ? "Yes" : "No")
                    : (raw ?? "");
                  const isStatus = f.name === "status";
                  return (
                    <td key={f.name} className={f.type === "money" || f.type === "number" ? "text-right tabular-nums" : ""}>
                      {ci === 0 ? <Link href={`/e/${e.key}/${r.id}`} className="font-medium text-teal-700 hover:underline">{text || `#${r.id}`}</Link>
                        : isStatus ? <span className="badge">{text}</span> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} records · page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn" href={qs(page - 1)}>← Previous</Link>}
            {page < pages && <Link className="btn" href={qs(page + 1)}>Next →</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
