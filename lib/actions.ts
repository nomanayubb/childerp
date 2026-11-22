"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createCompanyWithAdmin, endSession, hashPassword, requireAdmin, requireSession,
  startSession, verifyPassword,
} from "./auth";
import { get, run, tx } from "./db";
import { deleteRow, entityOrThrow, saveRow } from "./crud";
import { callFbr, testConnection } from "./fbr";
import { encryptSecret } from "./secret";
import { FBR_PROVINCES, FBR_SCENARIOS } from "./schema";
import { posCheckout, postAssetAcquisition, runAction, runListAction, type PosLine } from "./posting";

export interface FormState { error?: string; message?: string; values?: Record<string, string> }

const msgOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const enc = encodeURIComponent;

// ---------------------------------------------------------------- auth
export async function login(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const u = get<any>(`SELECT id, password_hash FROM users WHERE email=?`, email);
  if (!u || !verifyPassword(password, u.password_hash)) return { error: "Wrong email or password.", values: { email } };
  await startSession(u.id);
  redirect("/");
}

export async function register(_prev: FormState, fd: FormData): Promise<FormState> {
  const v = {
    company: String(fd.get("company") ?? ""), name: String(fd.get("name") ?? ""),
    email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""),
  };
  const keep = { company: v.company, name: v.name, email: v.email };
  if (!v.company.trim() || !v.name.trim()) return { error: "Company and your name are required.", values: keep };
  if (!/^\S+@\S+\.\S+$/.test(v.email)) return { error: "Enter a valid email.", values: keep };
  if (v.password.length < 8) return { error: "Password must be at least 8 characters.", values: keep };
  try {
    const { userId } = createCompanyWithAdmin(v);
    await startSession(userId);
  } catch (err) {
    return { error: msgOf(err), values: keep };
  }
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

// ---------------------------------------------------------------- CRUD
export async function saveEntity(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const key = String(fd.get("__entity"));
  const id = Number(fd.get("__id")) || null;
  const values: Record<string, string> = {};
  fd.forEach((v, k) => { if (typeof v === "string") values[k] = v; });
  let target: string;
  try {
    const e = entityOrThrow(key);
    let lines: any[] = [];
    try { lines = JSON.parse(String(fd.get("__lines") ?? "[]")); } catch { throw new Error("Invalid line data."); }
    if (!Array.isArray(lines) || lines.length > 500) throw new Error("Invalid line data.");
    const newId = tx(() => {
      const savedId = saveRow(s.companyId, e, id, { data: fd, lines });
      if (e.key === "assets" && !id) postAssetAcquisition(s.companyId, savedId);
      return savedId;
    });
    target = `/e/${key}/${newId}?msg=${enc("Saved.")}`;
  } catch (err) {
    return { error: msgOf(err), values };
  }
  revalidatePath(`/e/${key}`);
  redirect(target);
}

export async function deleteEntity(fd: FormData) {
  const s = await requireSession();
  const key = String(fd.get("__entity"));
  const id = Number(fd.get("__id"));
  let target = `/e/${key}?msg=${enc("Deleted.")}`;
  try {
    deleteRow(s.companyId, entityOrThrow(key), id);
  } catch (err) {
    target = `/e/${key}/${id}?error=${enc(msgOf(err))}`;
  }
  revalidatePath(`/e/${key}`);
  redirect(target);
}

export async function doAction(fd: FormData) {
  const s = await requireSession();
  const key = String(fd.get("__entity"));
  const id = Number(fd.get("__id"));
  const action = String(fd.get("__action"));
  let target: string;
  try {
    const res = runAction(s.companyId, key, id, action);
    target = res.redirect ? `${res.redirect}?msg=${enc(res.message)}` : `/e/${key}/${id}?msg=${enc(res.message)}`;
  } catch (err) {
    target = `/e/${key}/${id}?error=${enc(msgOf(err))}`;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function doListAction(fd: FormData) {
  const s = await requireSession();
  const key = String(fd.get("__entity"));
  const action = String(fd.get("__action"));
  let target: string;
  try {
    target = `/e/${key}?msg=${enc(runListAction(s.companyId, key, action).message)}`;
  } catch (err) {
    target = `/e/${key}?error=${enc(msgOf(err))}`;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// ------------------------------------------------------------------ POS
export async function posSale(input: {
  warehouseId: number; method: string; customer?: string; discount: number; taxPercent: number; lines: PosLine[];
}): Promise<{ ok: true; id: number; number: string; total: number } | { ok: false; error: string }> {
  const s = await requireSession();
  try {
    const r = posCheckout(s.companyId, input);
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: msgOf(err) };
  }
}

// ------------------------------------------------------------- settings
export async function saveCompany(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireAdmin();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Company name is required." };
  run(`UPDATE companies SET name=?, ntn=?, address=?, phone=?, currency=? WHERE id=?`,
    name, String(fd.get("ntn") ?? ""), String(fd.get("address") ?? ""), String(fd.get("phone") ?? ""),
    String(fd.get("currency") ?? "PKR").trim().toUpperCase().slice(0, 5) || "PKR", s.companyId);
  revalidatePath("/", "layout");
  return {};
}

export async function addUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const role = fd.get("role") === "admin" ? "admin" : "user";
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: "Name and a valid email are required.", values: { name, email } };
  if (password.length < 8) return { error: "Password must be at least 8 characters.", values: { name, email } };
  if (get(`SELECT id FROM users WHERE email=?`, email)) return { error: "That email is already registered.", values: { name, email } };
  run(`INSERT INTO users (company_id,name,email,password_hash,role) VALUES (?,?,?,?,?)`, s.companyId, name, email, hashPassword(password), role);
  revalidatePath("/settings");
  return {};
}

// ------------------------------------------------------------------ FBR
export async function fbrSend(fd: FormData) {
  const s = await requireSession();
  const id = Number(fd.get("__id"));
  const action = fd.get("__action") === "post" ? "post" : "validate";
  const r = await callFbr(s.companyId, id, action);
  const detail = r.message.startsWith("Fix these") && r.problems?.length ? `${r.message} ${r.problems.join(" • ")}` : r.message;
  revalidatePath(`/e/sales_invoices/${id}`);
  redirect(`/e/sales_invoices/${id}?${r.ok ? "msg" : "error"}=${enc(detail.slice(0, 1200))}`);
}

export async function saveFbr(_prev: FormState, fd: FormData): Promise<FormState> {
  const s = await requireAdmin();
  if (fd.get("__intent") === "test") {
    const r = await testConnection(s.companyId);
    return r.ok ? { message: r.message } : { error: r.message };
  }
  const env = fd.get("env") === "production" ? "production" : "sandbox";
  const province = String(fd.get("province") ?? "");
  const scenario = String(fd.get("scenario") ?? "SN001");
  if (!FBR_PROVINCES.includes(province)) return { error: "Choose a valid province." };
  if (!FBR_SCENARIOS.includes(scenario)) return { error: "Choose a valid sandbox scenario." };
  const tokenIn = String(fd.get("token") ?? "").trim();
  if (tokenIn && (tokenIn.length < 10 || /\s/.test(tokenIn))) return { error: "That does not look like a valid FBR token." };
  run(`UPDATE companies SET fbr_env=?, province=?, fbr_scenario=? WHERE id=?`, env, province || null, scenario, s.companyId);
  if (tokenIn) run(`UPDATE companies SET fbr_token_enc=? WHERE id=?`, encryptSecret(tokenIn), s.companyId);
  if (fd.get("clear_token") === "on") run(`UPDATE companies SET fbr_token_enc=NULL WHERE id=?`, s.companyId);
  revalidatePath("/settings");
  return { message: "FBR settings saved." };
}
