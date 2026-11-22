import { all, get, run, tx, nextNumber } from "./db";
import { entityMap, tableOf, type Entity, type Field } from "./schema";
import { computeTrade } from "./trade";

type Row = Record<string, any>;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function entityOrThrow(key: string): Entity {
  const e = entityMap[key];
  if (!e) throw new Error(`Unknown entity: ${key}`);
  return e;
}

/** Look up options for a reference dropdown. */
export function refOptions(companyId: number, field: Field): { id: number; label: string }[] {
  const target = entityOrThrow(field.ref!);
  const where = field.refWhere ? ` AND (${field.refWhere})` : target.where ? ` AND (${target.where})` : "";
  return all(
    `SELECT id, (${target.labelSql ?? "id"}) AS label FROM "${tableOf(target)}" WHERE company_id=?${where} ORDER BY ${target.sort ?? "id"} LIMIT 1000`,
    companyId,
  );
}

function attachLabels(companyId: number, e: Entity, rows: Row[]) {
  for (const f of e.fields) {
    if (f.type !== "ref") continue;
    const ids = [...new Set(rows.map((r) => r[f.name]).filter((v) => v != null))];
    if (!ids.length) continue;
    const target = entityOrThrow(f.ref!);
    const labels = all<{ id: number; label: string }>(
      `SELECT id, (${target.labelSql ?? "id"}) AS label FROM "${tableOf(target)}" WHERE company_id=? AND id IN (${ids.map(() => "?").join(",")})`,
      companyId, ...ids,
    );
    const map = new Map(labels.map((l) => [l.id, l.label]));
    for (const r of rows) r[`${f.name}__label`] = map.get(r[f.name]) ?? "";
  }
}

export function listRows(companyId: number, e: Entity, opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const params: unknown[] = [companyId];
  let where = `company_id=?`;
  if (e.where) where += ` AND (${e.where})`;
  if (opts.q?.trim()) {
    const cols = e.searchFields ?? e.fields.filter((f) => f.list && ["text", "phone"].includes(f.type)).map((f) => f.name).slice(0, 3);
    const searchable = cols.length ? cols : ["id"];
    where += ` AND (${searchable.map((c) => `CAST("${c}" AS TEXT) LIKE ?`).join(" OR ")})`;
    for (let i = 0; i < searchable.length; i++) params.push(`%${opts.q.trim()}%`);
  }
  const table = tableOf(e);
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM "${table}" WHERE ${where}`, ...params)!.c;
  const rows = all(
    `SELECT * FROM "${table}" WHERE ${where} ORDER BY ${e.sort ?? "id DESC"} LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  attachLabels(companyId, e, rows);
  return { rows, total, page, pageSize };
}

export function getRow(companyId: number, e: Entity, id: number) {
  const table = tableOf(e);
  const row = get(`SELECT * FROM "${table}" WHERE id=? AND company_id=?`, id, companyId);
  if (!row) return null;
  const lines = e.lines ? all(`SELECT * FROM "${table}_lines" WHERE doc_id=? ORDER BY id`, id) : [];
  attachLabels(companyId, e, [row]);
  return { row, lines };
}

function parseValue(f: Field, raw: FormDataEntryValue | null): string | number | null {
  if (f.type === "bool") return raw === "on" || raw === "1" || raw === "true" ? 1 : 0;
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (f.type === "number" || f.type === "money") return v === "" ? 0 : num(v);
  if (f.type === "ref") return v === "" ? null : Math.trunc(num(v));
  if (f.type === "select" && f.options && v !== "" && !f.options.includes(v)) throw new Error(`Invalid value for ${f.label}`);
  return v === "" ? null : v;
}

function assertRef(companyId: number, f: Field, id: unknown) {
  if (id == null) return;
  const target = entityOrThrow(f.ref!);
  if (!get(`SELECT 1 x FROM "${tableOf(target)}" WHERE id=? AND company_id=?`, id, companyId)) {
    throw new Error(`${f.label}: selected record does not exist.`);
  }
}

export interface SaveInput {
  data: FormData;
  lines: Row[];
}

export function saveRow(companyId: number, e: Entity, id: number | null, input: SaveInput): number {
  return tx(() => {
    const table = tableOf(e);
    const existing = id ? (get<Row>(`SELECT * FROM "${table}" WHERE id=? AND company_id=?`, id, companyId) ?? null) : null;
    if (id && !existing) throw new Error("Record not found.");
    if (existing && e.lock?.includes(existing.status)) throw new Error(`This ${e.label.toLowerCase()} is ${existing.status} and can no longer be edited.`);
    if (existing && e.key === "sales_invoices" && existing.fbr_status === "Accepted") {
      throw new Error("This invoice has been accepted by FBR and can no longer be edited.");
    }

    const values: Row = {};
    for (const f of e.fields) {
      if (f.readonly || f.hidden) continue;
      const v = parseValue(f, input.data.get(f.name));
      if (f.required && (v === null || v === "")) throw new Error(`${f.label} is required.`);
      if (f.type === "ref") assertRef(companyId, f, v);
      values[f.name] = v;
    }

    // Parse and validate document lines.
    const lines: Row[] = [];
    if (e.lines && !e.linesReadonly) {
      for (const raw of input.lines) {
        const line: Row = {};
        for (const f of e.lines) {
          if (f.readonly) continue;
          const rv = raw[f.name];
          const v = f.type === "ref" ? (rv === "" || rv == null ? null : Math.trunc(num(rv)))
            : f.type === "number" || f.type === "money" ? num(rv) : (rv === "" || rv == null ? null : String(rv));
          if (f.type === "ref") assertRef(companyId, f, v);
          line[f.name] = v;
        }
        const meaningful = e.lines.some((f) => !f.readonly && line[f.name] != null && line[f.name] !== 0 && line[f.name] !== "");
        if (meaningful) lines.push(line);
      }
    }

    applyComputed(companyId, e, values, lines, existing);

    let docId = id;
    if (!existing) {
      const cols = ["company_id"];
      const vals: unknown[] = [companyId];
      for (const f of e.fields) {
        cols.push(f.name);
        vals.push(f.name in values ? values[f.name] : (f.default ?? (f.type === "number" || f.type === "money" ? 0 : null)));
      }
      for (const [k, v] of Object.entries(e.defaults ?? {})) {
        const i = cols.indexOf(k);
        if (i >= 0) vals[i] = v;
      }
      const ni = cols.indexOf("number");
      if (e.numbered && ni >= 0) vals[ni] = nextNumber(companyId, e.key, e.numbered);
      docId = run(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        ...vals,
      ).id;
    } else {
      const keys = Object.keys(values);
      if (keys.length) {
        run(`UPDATE "${table}" SET ${keys.map((k) => `"${k}"=?`).join(",")} WHERE id=? AND company_id=?`, ...keys.map((k) => values[k]), id, companyId);
      }
    }

    if (e.lines && !e.linesReadonly) {
      run(`DELETE FROM "${table}_lines" WHERE doc_id=?`, docId);
      for (const line of lines) {
        const cols = ["doc_id", ...e.lines.map((f) => f.name)];
        run(
          `INSERT INTO "${table}_lines" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
          docId, ...e.lines.map((f) => line[f.name] ?? (f.type === "number" || f.type === "money" ? 0 : null)),
        );
      }
    }
    return docId!;
  });
}

/** Entity-specific calculations done on the server so totals can't be tampered with. */
function applyComputed(companyId: number, e: Entity, v: Row, lines: Row[], existing: Row | null) {
  if (e.trade) {
    for (const l of lines) {
      if (num(l.qty) < 0 || num(l.rate) < 0) throw new Error("Quantity and rate cannot be negative.");
      l.tax_percent = Math.max(num(l.tax_percent), 0);
    }
    const t = computeTrade(lines as any, v.discount);
    lines.forEach((l, i) => { l.amount = t.lines[i].amount; });
    v.discount = t.discount;
    v.subtotal = t.subtotal;
    v.tax_amount = t.tax;
    v.total = t.total;
  }
  switch (e.key) {
    case "boq_items":
      v.amount = round2(num(v.qty) * num(v.rate));
      break;
    case "time_entries":
      v.cost = round2(num(v.hours) * num(v.hourly_rate));
      break;
    case "journal_entries":
      v.total_debit = round2(lines.reduce((s, l) => s + num(l.debit), 0));
      for (const l of lines) {
        if (num(l.debit) < 0 || num(l.credit) < 0) throw new Error("Debit and credit cannot be negative.");
        if (num(l.debit) > 0 && num(l.credit) > 0) throw new Error("A line cannot have both debit and credit.");
      }
      break;
    case "receipts": {
      const inv = get<Row>(`SELECT party_id FROM sales_invoices WHERE id=? AND company_id=?`, v.invoice_id, companyId);
      v.customer_id = inv?.party_id ?? null;
      if (num(v.amount) <= 0) throw new Error("Amount must be greater than zero.");
      break;
    }
    case "vendor_payments": {
      const bill = get<Row>(`SELECT party_id FROM purchase_bills WHERE id=? AND company_id=?`, v.bill_id, companyId);
      v.vendor_id = bill?.party_id ?? null;
      if (num(v.amount) <= 0) throw new Error("Amount must be greater than zero.");
      break;
    }
    case "assets": {
      const acc = num(existing?.accumulated_depreciation);
      if (existing) {
        // Cost and funding are fixed once the purchase journal exists.
        if (Math.abs(num(v.cost) - num(existing.cost)) > 0.005) throw new Error("Asset cost cannot be changed after registration. Use Asset Revaluation instead.");
        v.funding = existing.funding;
      }
      v.book_value = round2(num(v.cost) - acc);
      if (num(v.life_years) <= 0) throw new Error("Useful life must be greater than zero.");
      break;
    }
    case "asset_revaluations": {
      const a = get<Row>(`SELECT book_value FROM assets WHERE id=? AND company_id=?`, v.asset_id, companyId);
      v.difference = round2(num(v.new_value) - num(a?.book_value));
      break;
    }
    case "asset_disposals":
      break;
    case "stock_transfers":
      if (v.from_warehouse_id === v.to_warehouse_id) throw new Error("Source and destination must be different.");
      break;
    case "leave_requests":
      if (String(v.to_date) < String(v.from_date)) throw new Error("'To' date cannot be before 'From' date.");
      break;
  }
}

export function deleteRow(companyId: number, e: Entity, id: number) {
  tx(() => {
    const table = tableOf(e);
    const row = get<Row>(`SELECT * FROM "${table}" WHERE id=? AND company_id=?`, id, companyId);
    if (!row) throw new Error("Record not found.");
    if (e.lock?.includes(row.status)) throw new Error(`A ${row.status} record cannot be deleted.`);
    if (e.key === "sales_invoices" && row.fbr_status === "Accepted") throw new Error("An invoice accepted by FBR cannot be deleted.");
    // Refuse to delete records other records still point to.
    const sameTable = new Set(Object.values(entityMap).filter((x) => tableOf(x) === table).map((x) => x.key));
    for (const x of Object.values(entityMap)) {
      const xt = tableOf(x);
      for (const f of x.fields) {
        if (f.type !== "ref" || !sameTable.has(f.ref!)) continue;
        const used = get<{ c: number }>(`SELECT COUNT(*) c FROM "${xt}" WHERE company_id=? AND "${f.name}"=?`, companyId, id)!.c;
        if (used) throw new Error(`Cannot delete: it is used by ${used} ${x.plural} record(s).`);
      }
      for (const f of x.lines ?? []) {
        if (f.type !== "ref" || !sameTable.has(f.ref!)) continue;
        const used = get<{ c: number }>(
          `SELECT COUNT(*) c FROM "${xt}_lines" l JOIN "${xt}" h ON h.id=l.doc_id WHERE h.company_id=? AND l."${f.name}"=?`,
          companyId, id,
        )!.c;
        if (used) throw new Error(`Cannot delete: it is used on ${used} ${x.plural} line(s).`);
      }
    }
    if (get(`SELECT 1 x FROM stock_moves WHERE company_id=? AND (item_id=? OR warehouse_id=?) LIMIT 1`, companyId, table === "items" ? id : -1, table === "warehouses" ? id : -1)) {
      throw new Error("Cannot delete: stock movements exist for this record.");
    }
    if (e.lines) run(`DELETE FROM "${table}_lines" WHERE doc_id=?`, id);
    run(`DELETE FROM "${table}" WHERE id=? AND company_id=?`, id, companyId);
  });
}
