"use client";

import { useActionState, useMemo, useState } from "react";
import { saveEntity, type FormState } from "@/lib/actions";
import type { Entity, Field } from "@/lib/schema";
import { computeTrade } from "@/lib/trade";

type Opt = { id: number; label: string };
type Row = Record<string, any>;
export interface ItemPrice { name: string; sale_price: number; avg_cost: number; tax_percent: number }

interface Props {
  entity: Entity;
  row: Row | null;
  lines: Row[];
  options: Record<string, Opt[]>;          // "h:field" and "l:field"
  itemPrices: Record<number, ItemPrice>;
  priceKey: "sale_price" | "avg_cost";
  locked: boolean;
  preset: Record<string, string>;
  today: string;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function initialValue(f: Field, row: Row | null, state: FormState, preset: Record<string, string>, today: string) {
  if (state.values && f.name in state.values) return state.values[f.name];
  if (row && row[f.name] != null) return row[f.name];
  if (preset[f.name] != null) return preset[f.name];
  if (f.type === "date" && f.required) return today;
  return f.default ?? "";
}

export default function EntityForm({ entity, row, lines, options, itemPrices, priceKey, locked, preset, today }: Props) {
  const [state, action, pending] = useActionState(saveEntity, {} as FormState);
  const lineFields = entity.lines ?? [];
  const editableLines = !!entity.lines && !entity.linesReadonly;

  const blank = () => Object.fromEntries(lineFields.map((f) => [f.name, f.default ?? ""])) as Row;
  const [rows, setRows] = useState<Row[]>(() => {
    if (state.values?.__lines) { try { return JSON.parse(state.values.__lines); } catch { /* fall through */ } }
    if (lines.length) return lines.map((l) => ({ ...l }));
    return entity.key === "journal_entries" ? [blank(), blank()] : [blank()];
  });
  const [discount, setDiscount] = useState(toNum(row?.discount));

  const setCell = (i: number, name: string, value: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [name]: value } : r)));

  const pickItem = (i: number, value: string) =>
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      const next: Row = { ...r, item_id: value };
      const p = itemPrices[Number(value)];
      if (p && "rate" in r) {
        next.rate = p[priceKey];
        if ("tax_percent" in r) next.tax_percent = p.tax_percent;
        if ("description" in r && !r.description) next.description = p.name;
      }
      return next;
    }));

  const lineAmount = (r: Row) => toNum(r.qty) * toNum(r.rate);
  const trade = entity.trade ? computeTrade(rows as any, discount) : null;
  const debit = rows.reduce((s, r) => s + toNum(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toNum(r.credit), 0);

  const visible = entity.fields.filter((f) => !f.hidden && (!f.readonly || row));
  const disabled = locked || pending;
  const serialized = useMemo(() => JSON.stringify(rows), [rows]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="__entity" value={entity.key} />
      <input type="hidden" name="__id" value={row?.id ?? ""} />
      <input type="hidden" name="__lines" value={serialized} />

      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}

      <div className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((f) => {
          const id = `f_${f.name}`;
          const val = initialValue(f, row, state, preset, today);
          const common = { id, name: f.name, disabled: disabled || f.readonly, required: f.required, className: "input" };
          return (
            <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2 lg:col-span-3" : ""}>
              <label className="label" htmlFor={id}>{f.label}{f.required && <span className="text-red-600"> *</span>}</label>
              {f.type === "textarea" ? (
                <textarea {...common} rows={3} defaultValue={val as string} />
              ) : f.type === "select" ? (
                <select {...common} defaultValue={val as string}>
                  {f.options!.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === "ref" ? (
                <select {...common} defaultValue={val as string}>
                  <option value="">— select —</option>
                  {(options[`h:${f.name}`] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              ) : f.type === "bool" ? (
                <input type="checkbox" {...common} className="h-5 w-5 accent-teal-700" defaultChecked={!!Number(val)} />
              ) : f.type === "date" ? (
                <input type="date" {...common} defaultValue={val as string} />
              ) : f.type === "number" || f.type === "money" ? (
                <input
                  type="number" step="any" {...common} defaultValue={val as string}
                  onChange={f.name === "discount" ? (e) => setDiscount(toNum(e.target.value)) : undefined}
                />
              ) : (
                <input type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"} {...common} defaultValue={val as string} />
              )}
              {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
            </div>
          );
        })}
      </div>

      {entity.lines && (
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">{entity.linesLabel ?? "Lines"}</h2>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[600px]">
              <thead>
                <tr>
                  {lineFields.map((f) => <th key={f.name}>{f.label}</th>)}
                  {editableLines && !locked && <th className="w-10"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {lineFields.map((f) => (
                      <td key={f.name} className={f.type === "number" || f.type === "money" ? "w-32" : ""}>
                        {f.readonly || entity.linesReadonly ? (
                          <span className="block text-right">
                            {f.type === "ref" ? (options[`l:${f.name}`]?.find((o) => o.id === Number(r[f.name]))?.label ?? "")
                              : f.name === "amount" && entity.trade ? money(lineAmount(r))
                              : typeof r[f.name] === "number" ? money(r[f.name]) : r[f.name]}
                          </span>
                        ) : f.type === "ref" ? (
                          <select aria-label={f.label} disabled={disabled} value={r[f.name] ?? ""} className="input min-w-40"
                            onChange={(e) => (f.name === "item_id" && "rate" in r ? pickItem(i, e.target.value) : setCell(i, f.name, e.target.value))}>
                            <option value="">— select —</option>
                            {(options[`l:${f.name}`] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input aria-label={f.label} disabled={disabled} className="input"
                            type={f.type === "number" || f.type === "money" ? "number" : "text"} step="any"
                            value={r[f.name] ?? ""} onChange={(e) => setCell(i, f.name, e.target.value)} />
                        )}
                      </td>
                    ))}
                    {editableLines && !locked && (
                      <td><button type="button" aria-label="Remove line" className="text-red-600 hover:text-red-800"
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>✕</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editableLines && !locked && (
            <button type="button" className="btn mt-3" onClick={() => setRows((rs) => [...rs, blank()])}>+ Add line</button>
          )}

          {trade && (
            <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(trade.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Discount</dt><dd>− {money(trade.discount)}</dd></div>
              <div className="flex justify-between"><dt>Tax (per line)</dt><dd>{money(trade.tax)}</dd></div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(trade.total)}</dd></div>
            </dl>
          )}
          {entity.key === "journal_entries" && (
            <p className={`mt-4 text-sm font-medium ${Math.abs(debit - credit) < 0.005 ? "text-teal-700" : "text-red-600"}`}>
              Debit {money(debit)} · Credit {money(credit)} · {Math.abs(debit - credit) < 0.005 ? "Balanced" : `Out of balance by ${money(Math.abs(debit - credit))}`}
            </p>
          )}
        </div>
      )}

      {!locked && (
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : row ? "Save changes" : `Create ${entity.label.toLowerCase()}`}</button>
        </div>
      )}
    </form>
  );
}
