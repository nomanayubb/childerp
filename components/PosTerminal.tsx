"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { posSale } from "@/lib/actions";

export interface PosItem { id: number; code: string; name: string; barcode: string | null; price: number; service: boolean; stock: Record<number, number> }
export interface PosOutlet { id: number; name: string }
interface CartLine { itemId: number; qty: number; price: number }

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PosTerminal({ items, outlets, currency }: { items: PosItem[]; outlets: PosOutlet[]; currency: string }) {
  const [outletId, setOutletId] = useState<number>(outlets[0]?.id ?? 0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [method, setMethod] = useState("Cash");
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: number } | null>(null);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const stockOf = (i: PosItem) => (i.service ? Infinity : (i.stock[outletId] ?? 0));

  const add = (item: PosItem) => {
    const inCart = cart.find((l) => l.itemId === item.id)?.qty ?? 0;
    if (inCart + 1 > stockOf(item)) { setMsg({ ok: false, text: `Only ${stockOf(item)} of "${item.name}" in stock at this outlet.` }); return; }
    setMsg(null);
    setCart((c) => (c.some((l) => l.itemId === item.id)
      ? c.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
      : [...c, { itemId: item.id, qty: 1, price: item.price }]));
  };

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const hit = items.find((i) => i.barcode?.toLowerCase() === code || i.code.toLowerCase() === code);
    if (hit) add(hit); else setMsg({ ok: false, text: `No item with barcode / code "${scan}".` });
    setScan("");
    scanRef.current?.focus();
  };

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const disc = Math.min(Math.max(discount, 0), subtotal);
  const tax = ((subtotal - disc) * Math.max(taxPct, 0)) / 100;
  const total = subtotal - disc + tax;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => !q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)).slice(0, 60);
  }, [items, search]);

  const checkout = () => {
    start(async () => {
      const res = await posSale({ warehouseId: outletId, method, customer, discount: disc, taxPercent: taxPct, lines: cart });
      if (res.ok) {
        setMsg({ ok: true, text: `Sale ${res.number} completed — ${currency} ${fmt(res.total)}`, id: res.id });
        setCart([]); setDiscount(0); setCustomer("");
        // Reflect stock reduction locally so the grid stays accurate until the next reload.
        for (const l of cart) { const it = byId.get(l.itemId); if (it && !it.service) it.stock[outletId] = (it.stock[outletId] ?? 0) - l.qty; }
      } else setMsg({ ok: false, text: res.error });
    });
  };

  if (!outlets.length) {
    return (
      <div className="card mx-auto max-w-xl p-6 text-center">
        <p className="mb-3">No outlet or warehouse exists yet.</p>
        <Link href="/e/outlets/new" className="btn btn-primary">Create an outlet</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <section className="space-y-3 xl:col-span-3">
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <div><label className="label" htmlFor="outlet">Outlet</label>
            <select id="outlet" className="input" value={outletId} onChange={(e) => { setOutletId(Number(e.target.value)); setCart([]); }}>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <form onSubmit={onScan} className="flex-1"><label className="label" htmlFor="scan">Scan barcode / enter code</label>
            <input id="scan" ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)} className="input" placeholder="Scan and press Enter" /></form>
          <div className="flex-1"><label className="label" htmlFor="psearch">Search products</label>
            <input id="psearch" value={search} onChange={(e) => setSearch(e.target.value)} className="input" placeholder="Name or code" /></div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((i) => {
            const st = stockOf(i);
            return (
              <button key={i.id} onClick={() => add(i)} disabled={st <= 0}
                className="card p-3 text-left transition hover:border-teal-500 disabled:cursor-not-allowed disabled:opacity-50">
                <div className="line-clamp-2 text-sm font-medium">{i.name}</div>
                <div className="mt-1 text-sm font-semibold text-teal-700">{fmt(i.price)}</div>
                <div className="text-xs text-slate-500">{i.service ? "Service" : `${st} in stock`}</div>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="col-span-full py-8 text-center text-slate-500">No products found. Add items under Inventory.</p>}
        </div>
      </section>

      <section className="card flex flex-col p-4 xl:col-span-2">
        <h2 className="mb-2 font-semibold">Cart</h2>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`mb-2 rounded p-2 text-sm ${msg.ok ? "bg-teal-50 text-teal-800" : "bg-red-50 text-red-700"}`}>
            {msg.text} {msg.ok && msg.id && <Link href={`/e/pos_sales/${msg.id}/print`} target="_blank" className="font-semibold underline">Print receipt</Link>}
          </p>
        )}
        <div className="min-h-32 flex-1 overflow-y-auto">
          {cart.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Scan or tap a product to add it.</p> : (
            <ul className="divide-y">
              {cart.map((l) => {
                const it = byId.get(l.itemId)!;
                return (
                  <li key={l.itemId} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{it.name}</span>
                      <button aria-label={`Remove ${it.name}`} className="text-red-600" onClick={() => setCart((c) => c.filter((x) => x.itemId !== l.itemId))}>✕</button>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-500">Qty
                        <input type="number" min={0.01} step="any" className="input w-20" value={l.qty}
                          onChange={(e) => setCart((c) => c.map((x) => (x.itemId === l.itemId ? { ...x, qty: Math.min(Number(e.target.value), stockOf(it)) } : x)))} />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-500">Price
                        <input type="number" min={0} step="any" className="input w-24" value={l.price}
                          onChange={(e) => setCart((c) => c.map((x) => (x.itemId === l.itemId ? { ...x, price: Number(e.target.value) } : x)))} />
                      </label>
                      <span className="ml-auto text-sm font-semibold tabular-nums">{fmt(l.qty * l.price)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
          <div><label className="label" htmlFor="cust">Customer</label><input id="cust" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Walk-in" /></div>
          <div><label className="label" htmlFor="pm">Payment</label>
            <select id="pm" className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Bank</option></select></div>
          <div><label className="label" htmlFor="disc">Discount</label><input id="disc" type="number" min={0} step="any" className="input" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></div>
          <div><label className="label" htmlFor="tax">Tax %</label><input id="tax" type="number" min={0} step="any" className="input" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
        </div>

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{fmt(subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Discount</dt><dd>− {fmt(disc)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{fmt(tax)}</dd></div>
          <div className="flex justify-between border-t pt-1 text-xl font-bold"><dt>Total</dt><dd>{currency} {fmt(total)}</dd></div>
        </dl>
        <button className="btn btn-primary mt-3 py-3 text-base" disabled={pending || cart.length === 0} onClick={checkout}>
          {pending ? "Processing…" : `Charge ${currency} ${fmt(total)}`}
        </button>
      </section>
    </div>
  );
}
