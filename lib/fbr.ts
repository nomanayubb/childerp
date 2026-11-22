// FBR Digital Invoicing (PRAL) client, written to "Technical Specification for
// DI API v1.12" (a copy is kept in docs/fbr/). Bearer-token auth; sandbox and
// production use different post/validate URLs.
import { all, get, run } from "./db";
import { decryptSecret } from "./secret";
import { computeTrade } from "./trade";
import { FBR_SALE_TYPES } from "./schema";

type Row = Record<string, any>;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");

export type FbrAction = "validate" | "post";
export interface FbrResult { ok: boolean; message: string; irn?: string; problems?: string[] }

/** Gateway base URL. Only overridable through the environment (used for local testing). */
export function baseUrl(): string {
  const u = (process.env.FBR_BASE_URL || "https://gw.fbr.gov.pk").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) {
    throw new Error("FBR_BASE_URL must be https (or http://localhost for testing).");
  }
  return u;
}

export function fbrSettings(companyId: number) {
  const c = get<Row>(`SELECT name, ntn, address, province, fbr_env, fbr_token_enc, fbr_scenario FROM companies WHERE id=?`, companyId)!;
  let hint = "";
  if (c.fbr_token_enc) {
    try { hint = decryptSecret(c.fbr_token_enc).slice(-4); } catch { hint = "?"; }
  }
  return {
    name: c.name as string, ntn: c.ntn as string | null, address: c.address as string | null,
    province: (c.province as string | null) ?? "", env: (c.fbr_env === "production" ? "production" : "sandbox") as "sandbox" | "production",
    scenario: (c.fbr_scenario as string) || "SN001", hasToken: !!c.fbr_token_enc, tokenHint: hint,
  };
}

function token(companyId: number): string {
  const c = get<Row>(`SELECT fbr_token_enc FROM companies WHERE id=?`, companyId);
  if (!c?.fbr_token_enc) throw new Error("No FBR token saved. Add it under Settings → FBR digital invoicing.");
  return decryptSecret(c.fbr_token_enc);
}

const rateText = (line: Row, item: Row) => (item.fbr_rate_desc?.trim() ? item.fbr_rate_desc.trim() : `${num(line.tax_percent)}%`);

/** Builds the exact JSON FBR expects, or lists what is missing. */
export function buildPayload(companyId: number, invoiceId: number): { payload?: Row; problems: string[] } {
  const problems: string[] = [];
  const inv = get<Row>(`SELECT * FROM sales_invoices WHERE id=? AND company_id=?`, invoiceId, companyId);
  if (!inv) return { problems: ["Invoice not found."] };
  const s = fbrSettings(companyId);
  const lines = all<Row>(`SELECT * FROM sales_invoices_lines WHERE doc_id=? ORDER BY id`, invoiceId);
  const buyer = inv.party_id ? get<Row>(`SELECT * FROM customers WHERE id=? AND company_id=?`, inv.party_id, companyId) : undefined;

  const sellerId = digits(s.ntn);
  if (![7, 13].includes(sellerId.length)) problems.push("Company NTN/CNIC must be 7 or 13 digits (Settings → Company profile).");
  if (!s.province) problems.push("Company province is not set (Settings → FBR digital invoicing).");
  if (!s.address?.trim()) problems.push("Company address is empty (Settings → Company profile).");

  if (!buyer) problems.push("Select a customer on the invoice.");
  else {
    const buyerId = digits(buyer.ntn);
    if (buyer.registration_type !== "Unregistered" && ![7, 9, 13].includes(buyerId.length)) {
      problems.push(`Customer "${buyer.name}" is Registered but has no valid NTN (7/9 digits) or CNIC (13 digits).`);
    }
    if (buyerId && ![7, 9, 13].includes(buyerId.length)) problems.push(`Customer "${buyer.name}": NTN/CNIC has ${buyerId.length} digits; expected 7, 9 or 13.`);
    if (!buyer.province) problems.push(`Customer "${buyer.name}" has no province.`);
    if (!buyer.address?.trim()) problems.push(`Customer "${buyer.name}" has no address.`);
  }
  if (!lines.length) problems.push("The invoice has no lines.");

  const t = computeTrade(lines as any, inv.discount);
  if (Math.abs(t.total - num(inv.total)) > 0.005) problems.push("Saved invoice totals are out of date. Open the invoice and save it once, then retry.");

  const items: Row[] = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    const item = l.item_id ? get<Row>(`SELECT * FROM items WHERE id=? AND company_id=?`, l.item_id, companyId) : undefined;
    if (!item) { problems.push(`Line ${n}: choose an item (FBR needs an HS code for every line).`); return; }
    if (!/^\d{4}\.\d{4}$/.test(String(item.hs_code ?? "").trim())) problems.push(`Line ${n}: item "${item.name}" needs an HS code like 0101.2100.`);
    if (!String(item.fbr_uom ?? "").trim()) problems.push(`Line ${n}: item "${item.name}" has no FBR unit of measure.`);
    if (!FBR_SALE_TYPES.includes(item.fbr_sale_type)) problems.push(`Line ${n}: sale type "${item.fbr_sale_type}" is not supported yet.`);
    if (num(l.qty) <= 0) problems.push(`Line ${n}: quantity must be above zero.`);
    const calc = t.lines[i];
    items.push({
      hsCode: String(item.hs_code ?? "").trim(),
      productDescription: String(l.description || item.name).slice(0, 250),
      rate: rateText(l, item),
      uoM: String(item.fbr_uom ?? "").trim(),
      quantity: num(l.qty),
      totalValues: round2(calc.net + calc.tax),
      valueSalesExcludingST: calc.net,
      fixedNotifiedValueOrRetailPrice: 0,
      salesTaxApplicable: calc.tax,
      salesTaxWithheldAtSource: 0,
      extraTax: 0,
      furtherTax: 0,
      sroScheduleNo: String(item.sro_schedule_no ?? "").trim(),
      fedPayable: 0,
      discount: calc.discount,
      saleType: item.fbr_sale_type,
      sroItemSerialNo: String(item.sro_item_serial_no ?? "").trim(),
    });
  });

  if (problems.length) return { problems };
  const payload: Row = {
    invoiceType: "Sale Invoice",
    invoiceDate: inv.date,
    sellerNTNCNIC: sellerId,
    sellerBusinessName: s.name,
    sellerProvince: s.province,
    sellerAddress: s.address!.trim(),
    buyerNTNCNIC: digits(buyer!.ntn),
    buyerBusinessName: buyer!.name,
    buyerProvince: buyer!.province,
    buyerAddress: buyer!.address.trim(),
    buyerRegistrationType: buyer!.registration_type === "Unregistered" ? "Unregistered" : "Registered",
    invoiceRefNo: "",
    ...(s.env === "sandbox" ? { scenarioId: inv.fbr_scenario || s.scenario } : {}),
    items,
  };
  return { payload, problems: [] };
}

const inFlight = ((globalThis as any).__fbrInFlight ??= new Set<number>()) as Set<number>;

function cap(text: string, max = 20000) { return text.length > max ? text.slice(0, max) + "…[truncated]" : text; }

function logCall(companyId: number, invoiceId: number, action: string, env: string, httpStatus: number | null, ok: boolean, message: string, req: unknown, res: unknown) {
  run(
    `INSERT INTO fbr_log (company_id, invoice_id, action, env, http_status, ok, message, request_json, response_json) VALUES (?,?,?,?,?,?,?,?,?)`,
    companyId, invoiceId, action, env, httpStatus, ok ? 1 : 0, message.slice(0, 1000), cap(JSON.stringify(req)), cap(typeof res === "string" ? res : JSON.stringify(res)),
  );
}

/** Joins FBR's header-level and per-item error messages into one readable string. */
export function describeErrors(body: Row | null): string[] {
  const vr = body?.validationResponse;
  const out: string[] = [];
  if (vr?.error) out.push(`${vr.errorCode ? vr.errorCode + ": " : ""}${vr.error}`);
  for (const it of vr?.invoiceStatuses ?? []) {
    if (it && (it.statusCode !== "00" || it.error)) out.push(`Item ${it.itemSNo}: ${it.errorCode ? it.errorCode + ": " : ""}${it.error || it.status || "invalid"}`);
  }
  return out;
}

export async function callFbr(companyId: number, invoiceId: number, action: FbrAction): Promise<FbrResult> {
  const inv = get<Row>(`SELECT id, fbr_status, number FROM sales_invoices WHERE id=? AND company_id=?`, invoiceId, companyId);
  if (!inv) return { ok: false, message: "Invoice not found." };
  if (inv.fbr_status === "Accepted") return { ok: false, message: `Invoice ${inv.number} was already accepted by FBR.` };

  const { payload, problems } = buildPayload(companyId, invoiceId);
  if (!payload) return { ok: false, message: "Fix these items before sending to FBR.", problems };

  if (inFlight.has(invoiceId)) return { ok: false, message: "This invoice is already being sent to FBR. Wait for the result." };
  inFlight.add(invoiceId);
  const s = fbrSettings(companyId);
  try {
    const path = (action === "post" ? "postinvoicedata" : "validateinvoicedata") + (s.env === "sandbox" ? "_sb" : "");
    let res: Response;
    let text = "";
    try {
      res = await fetch(`${baseUrl()}/di_data/v1/di/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(companyId)}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      text = cap(await res.text(), 1_000_000);
    } catch (err) {
      // We cannot know whether FBR processed it, so never mark it Rejected.
      const msg = err instanceof Error ? err.message : "Network error";
      logCall(companyId, invoiceId, action, s.env, null, false, `Network error: ${msg}`, payload, "");
      return {
        ok: false,
        message: `Could not confirm the result (${msg}). Before retrying, check the IRIS portal in case FBR already accepted this invoice.`,
      };
    }

    let body: Row | null = null;
    try { body = JSON.parse(text); } catch { /* non-JSON body */ }

    if (res.status === 401) {
      logCall(companyId, invoiceId, action, s.env, 401, false, "Unauthorized (401)", payload, text);
      return { ok: false, message: "FBR rejected the security token (401). Check the token and the Sandbox/Production setting." };
    }
    if (res.status >= 500) {
      logCall(companyId, invoiceId, action, s.env, res.status, false, `FBR server error ${res.status}`, payload, text);
      return { ok: false, message: `FBR returned a server error (${res.status}). The invoice was not accepted; retry later. If unsure, check the IRIS portal first.` };
    }

    const vr = body?.validationResponse;
    const items: Row[] = Array.isArray(vr?.invoiceStatuses) ? vr.invoiceStatuses : [];
    const valid = res.ok && vr?.statusCode === "00" && items.every((i) => i.statusCode === "00");
    const errors = describeErrors(body);
    const irn = typeof body?.invoiceNumber === "string" ? body.invoiceNumber : undefined;

    if (valid && (action === "validate" || irn)) {
      const msg = action === "validate" ? "FBR says this invoice is valid. Nothing was submitted." : `Accepted by FBR. Invoice number ${irn}.`;
      logCall(companyId, invoiceId, action, s.env, res.status, true, msg, payload, text);
      if (action === "post") {
        run(
          `UPDATE sales_invoices SET fbr_status='Accepted', fbr_invoice_no=?, fbr_submitted_at=?, fbr_error='' WHERE id=? AND company_id=?`,
          irn, body?.dated ?? new Date().toISOString().replace("T", " ").slice(0, 19), invoiceId, companyId,
        );
      }
      return { ok: true, message: msg, irn };
    }

    const reason = errors.length ? errors.join(" | ") : `Unexpected FBR response (HTTP ${res.status}).`;
    logCall(companyId, invoiceId, action, s.env, res.status, false, reason, payload, text);
    if (action === "post") {
      run(`UPDATE sales_invoices SET fbr_status='Rejected', fbr_error=? WHERE id=? AND company_id=?`, reason.slice(0, 1000), invoiceId, companyId);
    }
    return { ok: false, message: reason, problems: errors };
  } finally {
    inFlight.delete(invoiceId);
  }
}

/** Confirms the token works by fetching FBR's province list (also shows the exact province names). */
export async function testConnection(companyId: number): Promise<FbrResult> {
  try {
    const res = await fetch(`${baseUrl()}/pdi/v1/provinces`, {
      headers: { Authorization: `Bearer ${token(companyId)}` }, signal: AbortSignal.timeout(20_000), redirect: "error",
    });
    if (res.status === 401) return { ok: false, message: "FBR rejected the token (401)." };
    if (!res.ok) return { ok: false, message: `FBR responded with HTTP ${res.status}.` };
    const list = (await res.json()) as Row[];
    const names = list.map((p) => p.stateProvinceDesc).filter(Boolean).join(", ");
    return { ok: true, message: `Connected. FBR provinces: ${names || "(none returned)"}.` };
  } catch (err) {
    return { ok: false, message: `Could not reach FBR: ${err instanceof Error ? err.message : "network error"}.` };
  }
}

export function fbrLog(companyId: number, invoiceId: number) {
  return all<Row>(
    `SELECT id, action, env, http_status, ok, message, created_at FROM fbr_log WHERE company_id=? AND invoice_id=? ORDER BY id DESC LIMIT 8`,
    companyId, invoiceId,
  );
}
