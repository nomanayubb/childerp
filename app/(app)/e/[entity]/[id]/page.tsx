import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { entityMap } from "@/lib/schema";
import { getRow, num } from "@/lib/crud";
import { deleteEntity, doAction } from "@/lib/actions";
import { loadFormSupport } from "@/lib/formdata";
import { today } from "@/lib/format";
import EntityForm from "@/components/EntityForm";
import ConfirmButton from "@/components/ConfirmButton";
import Flash, { first } from "@/components/Flash";
import Panel from "@/components/Panels";

type SP = Record<string, string | string[] | undefined>;

export default async function EntityDetail({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SP> }) {
  const s = await requireSession();
  const { entity, id } = await params;
  const sp = await searchParams;
  const e = entityMap[entity];
  const numId = Number(id);
  if (!e || !Number.isInteger(numId)) notFound();
  const doc = getRow(s.companyId, e, numId);
  if (!doc) notFound();

  const { row, lines } = doc;
  const fbrLocked = e.key === "sales_invoices" && row.fbr_status === "Accepted";
  const locked = !!e.lock?.includes(row.status) || fbrLocked;
  const actions = (e.actions ?? []).filter((a) => !a.from || a.from.includes(row.status));
  const title = row.number ?? row.name ?? row.title ?? `#${row.id}`;
  const due = num(row.total) - num(row.paid);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href={`/e/${e.key}`} className="text-sm text-teal-700 hover:underline">← {e.plural}</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            {e.label} {title} {row.status && <span className="badge ml-2 align-middle">{row.status}</span>}
          </h1>
          <div className="flex flex-wrap gap-2">
            {e.print && <Link href={`/e/${e.key}/${row.id}/print`} className="btn" target="_blank">🖨 Print</Link>}
            {e.key === "sales_invoices" && ["Posted", "Partially Paid"].includes(row.status) && (
              <Link href={`/e/receipts/new?invoice_id=${row.id}&amount=${due.toFixed(2)}`} className="btn btn-primary">Receive payment</Link>
            )}
            {e.key === "purchase_bills" && ["Posted", "Partially Paid"].includes(row.status) && (
              <Link href={`/e/vendor_payments/new?bill_id=${row.id}&amount=${due.toFixed(2)}`} className="btn btn-primary">Pay bill</Link>
            )}
            {actions.map((a) => (
              <form key={a.key} action={doAction}>
                <input type="hidden" name="__entity" value={e.key} />
                <input type="hidden" name="__id" value={row.id} />
                <input type="hidden" name="__action" value={a.key} />
                <ConfirmButton message={a.confirm} className={`btn ${a.style === "primary" ? "btn-primary" : a.style === "danger" ? "btn-danger" : ""}`}>{a.label}</ConfirmButton>
              </form>
            ))}
            {!locked && (
              <form action={deleteEntity}>
                <input type="hidden" name="__entity" value={e.key} />
                <input type="hidden" name="__id" value={row.id} />
                <ConfirmButton message="Delete this record permanently?" className="btn btn-danger">Delete</ConfirmButton>
              </form>
            )}
          </div>
        </div>
      </div>

      <Flash msg={first(sp.msg)} error={first(sp.error)} />
      {locked && (
        <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">
          {fbrLocked ? <>This invoice was accepted by FBR and is locked from editing.</> : <>This record is <strong>{row.status}</strong> and is locked from editing.</>}
        </p>
      )}

      <EntityForm
        key={`${row.id}-${row.status}-${row.total ?? ""}`}
        entity={e} row={row} lines={lines} locked={locked} preset={{}} today={today()}
        {...loadFormSupport(s.companyId, e)}
      />

      {e.panel && <Panel kind={e.panel} companyId={s.companyId} row={row} />}
    </div>
  );
}
