import { all } from "./db";
import { refOptions } from "./crud";
import type { Entity } from "./schema";

/** Dropdown options and item prices needed to render an entity form. */
export function loadFormSupport(companyId: number, e: Entity) {
  const options: Record<string, { id: number; label: string }[]> = {};
  for (const f of e.fields) if (f.type === "ref") options[`h:${f.name}`] = refOptions(companyId, f);
  for (const f of e.lines ?? []) if (f.type === "ref") options[`l:${f.name}`] = refOptions(companyId, f);
  const itemPrices: Record<number, { name: string; sale_price: number; avg_cost: number; tax_percent: number }> = {};
  if (e.lines?.some((f) => f.name === "item_id")) {
    for (const i of all<any>(`SELECT id, name, sale_price, avg_cost, tax_percent FROM items WHERE company_id=?`, companyId)) {
      itemPrices[i.id] = { name: i.name, sale_price: i.sale_price ?? 0, avg_cost: i.avg_cost ?? 0, tax_percent: i.tax_percent ?? 0 };
    }
  }
  const priceKey = ["purchase_orders", "purchase_bills"].includes(e.key) ? ("avg_cost" as const) : ("sale_price" as const);
  return { options, itemPrices, priceKey };
}
