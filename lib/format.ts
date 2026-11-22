export function money(v: unknown, currency = "PKR"): string {
  const n = Number(v ?? 0);
  const s = (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${s}`;
}

export function plain(v: unknown): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 7) + "-01";
