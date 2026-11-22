import { requireSession } from "@/lib/auth";
import { all } from "@/lib/db";
import PosTerminal, { type PosItem } from "@/components/PosTerminal";

export default async function PosPage() {
  const s = await requireSession();
  const outlets = all<{ id: number; name: string }>(
    `SELECT id, name FROM warehouses WHERE company_id=? ORDER BY CASE type WHEN 'Outlet' THEN 0 ELSE 1 END, name`, s.companyId);
  const rows = all<any>(`SELECT id, code, name, barcode, sale_price, type FROM items WHERE company_id=? ORDER BY name`, s.companyId);
  const stock = all<any>(`SELECT item_id, warehouse_id, SUM(qty) q FROM stock_moves WHERE company_id=? GROUP BY item_id, warehouse_id`, s.companyId);
  const items: PosItem[] = rows.map((r) => ({
    id: r.id, code: r.code ?? "", name: r.name, barcode: r.barcode, price: r.sale_price ?? 0, service: r.type === "Service", stock: {},
  }));
  const map = new Map(items.map((i) => [i.id, i]));
  for (const st of stock) { const it = map.get(st.item_id); if (it) it.stock[st.warehouse_id] = st.q; }

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-4 text-2xl font-bold">🏪 POS Terminal</h1>
      <PosTerminal items={items} outlets={outlets} currency={s.currency} />
    </div>
  );
}
