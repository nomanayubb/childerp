import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { entityMap, tableOf } from "@/lib/schema";
import { getRow } from "@/lib/crud";
import { get } from "@/lib/db";
import { plain } from "@/lib/format";
import PrintButton from "@/components/PrintButton";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";

// QR per FBR spec v1.12 section 6: version 2 (25x25), printed 1.0 x 1.0 inch.
// The spec does not say what the QR encodes; we encode the FBR invoice number (IRN).
async function irnQr(irn: string): Promise<string | null> {
  try {
    return await QRCode.toString(irn, { type: "svg", version: 2, errorCorrectionLevel: "L", margin: 0 });
  } catch {
    return null;
  }
}

export default async function PrintDoc({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const s = await requireSession();
  const { entity, id } = await params;
  const e = entityMap[entity];
  if (!e || !e.print) notFound();
  const doc = getRow(s.companyId, e, Number(id));
  if (!doc) notFound();
  const { row, lines } = doc;

  const company = get<any>(`SELECT * FROM companies WHERE id=?`, s.companyId)!;
  const isPurchase = e.key.startsWith("purchase");
  const partyTable = isPurchase ? "vendors" : "customers";
  const party = row.party_id ? get<any>(`SELECT * FROM "${partyTable}" WHERE id=? AND company_id=?`, row.party_id, s.companyId) : null;
  const itemName = (itemId: number | null) => (itemId ? get<any>(`SELECT name FROM items WHERE id=?`, itemId)?.name : "");
  void tableOf;
  const irn: string | null = e.key === "sales_invoices" && row.fbr_status === "Accepted" ? row.fbr_invoice_no : null;
  const qr = irn ? await irnQr(irn) : null;
  const hasLogo = fs.existsSync(path.join(process.cwd(), "public", "fbr-logo.png"));

  return (
    <div className="mx-auto my-6 max-w-3xl bg-white p-10 shadow print:my-0 print:shadow-none">
      <div className="mb-6 flex justify-between border-b pb-4">
        <div>
          <div className="text-2xl font-bold">{company.name}</div>
          {company.address && <div className="text-sm text-slate-600">{company.address}</div>}
          {company.phone && <div className="text-sm text-slate-600">{company.phone}</div>}
          {company.ntn && <div className="text-sm text-slate-600">NTN: {company.ntn}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold uppercase">{e.label}</div>
          <div className="text-sm">No: <strong>{row.number}</strong></div>
          <div className="text-sm">Date: {row.date}</div>
          {row.due_date && <div className="text-sm">Due: {row.due_date}</div>}
          {irn && <div className="text-sm">FBR Invoice No.: <strong className="font-mono">{irn}</strong></div>}
        </div>
      </div>

      {(party || row.customer_name) && (
        <div className="mb-6 text-sm">
          <div className="text-xs uppercase text-slate-500">{isPurchase ? "Vendor" : "Customer"}</div>
          <div className="font-semibold">{party?.name ?? row.customer_name}</div>
          {party?.address && <div>{party.address}</div>}
          {party?.ntn && <div>NTN: {party.ntn}</div>}
        </div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="py-2">#</th><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Tax %</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{i + 1}</td>
              <td>{itemName(l.item_id)}{l.description && l.description !== itemName(l.item_id) ? ` — ${l.description}` : ""}</td>
              <td className="text-right">{l.qty}</td><td className="text-right">{plain(l.rate)}</td><td className="text-right">{l.tax_percent ?? 0}%</td><td className="text-right">{plain(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{plain(row.subtotal)}</dd></div>
        {Number(row.discount) > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {plain(row.discount)}</dd></div>}
        <div className="flex justify-between"><dt>Tax</dt><dd>{plain(row.tax_amount)}</dd></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total ({company.currency})</dt><dd>{plain(row.total)}</dd></div>
      </dl>

      {row.notes && <p className="mt-6 text-sm text-slate-600">Notes: {row.notes}</p>}

      {irn && (
        <div className="mt-8 flex items-center gap-4 border-t pt-4">
          {qr
            ? <div role="img" aria-label={`QR code for FBR invoice ${irn}`} style={{ width: "1in", height: "1in" }} className="[&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            : <div className="text-xs text-red-600">QR could not be generated for this invoice number.</div>}
          <div className="text-xs text-slate-600">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {hasLogo && <img src="/fbr-logo.png" alt="FBR Digital Invoicing System" className="mb-2 h-10" />}
            <div>Digital invoice registered with FBR.</div>
            <div>FBR Invoice No.: <span className="font-mono">{irn}</span></div>
          </div>
        </div>
      )}
      <div className="mt-8 print:hidden"><PrintButton /></div>
    </div>
  );
}
