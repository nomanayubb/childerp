// Pure calculation of trade-document totals. Shared by the server (to store
// totals), the FBR payload builder (so FBR sees exactly the same numbers) and
// the browser form (live preview). Keep this file free of server imports.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface TradeLineInput { qty: unknown; rate: unknown; tax_percent: unknown }
export interface TradeLineResult { amount: number; discount: number; net: number; tax: number }
export interface TradeTotals { subtotal: number; discount: number; tax: number; total: number; lines: TradeLineResult[] }

/**
 * Header discount is spread across lines in proportion to line value (the last
 * line takes the rounding remainder). Tax is charged per line on the discounted value.
 */
export function computeTrade(lines: TradeLineInput[], discountInput: unknown): TradeTotals {
  const amounts = lines.map((l) => round2(num(l.qty) * num(l.rate)));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));
  const discount = Math.min(Math.max(num(discountInput), 0), subtotal);
  let allocated = 0;
  const out = lines.map((l, i) => {
    const share = subtotal > 0
      ? i === lines.length - 1 ? round2(discount - allocated) : round2((discount * amounts[i]) / subtotal)
      : 0;
    allocated = round2(allocated + share);
    const net = round2(amounts[i] - share);
    const tax = round2((net * Math.max(num(l.tax_percent), 0)) / 100);
    return { amount: amounts[i], discount: share, net, tax };
  });
  const tax = round2(out.reduce((s, l) => s + l.tax, 0));
  return { subtotal, discount, tax, total: round2(subtotal - discount + tax), lines: out };
}
