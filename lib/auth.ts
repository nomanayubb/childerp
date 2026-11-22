import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, get, run, tx } from "./db";
import { DEFAULT_ACCOUNTS } from "./schema";

const COOKIE = "erp_session";
const SESSION_DAYS = 14;

export interface Session {
  userId: number;
  companyId: number;
  name: string;
  email: string;
  role: string;
  companyName: string;
  currency: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && crypto.timingSafeEqual(test, known);
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function startSession(userId: number) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  run(`DELETE FROM sessions WHERE expires_at < ?`, new Date().toISOString());
  run(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)`, sha(token), userId, expires.toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", expires,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) run(`DELETE FROM sessions WHERE token_hash=?`, sha(token));
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = get<any>(
    `SELECT u.id userId, u.company_id companyId, u.name, u.email, u.role,
            c.name companyName, c.currency, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ?`,
    sha(token),
  );
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return row as Session;
}

/** Use at the top of every page, server action and route handler. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("Only administrators can do this.");
  return s;
}

export function createCompanyWithAdmin(input: { company: string; name: string; email: string; password: string }) {
  return tx(() => {
    const email = input.email.trim().toLowerCase();
    if (get(`SELECT id FROM users WHERE email=?`, email)) throw new Error("An account with this email already exists.");
    const co = run(`INSERT INTO companies (name) VALUES (?)`, input.company.trim());
    for (const [code, name, type] of DEFAULT_ACCOUNTS) {
      run(`INSERT INTO accounts (company_id, code, name, type) VALUES (?,?,?,?)`, co.id, code, name, type);
    }
    run(`INSERT INTO warehouses (company_id, name, type) VALUES (?,?,?)`, co.id, "Main Warehouse", "Warehouse");
    const u = run(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,'admin')`,
      co.id, input.name.trim(), email, hashPassword(input.password),
    );
    return { companyId: co.id, userId: u.id };
  });
}

export function listUsers(companyId: number) {
  return all(`SELECT id, name, email, role FROM users WHERE company_id=? ORDER BY id`, companyId);
}
