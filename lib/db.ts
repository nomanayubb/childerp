import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ENTITIES, tableOf, type Field } from "./schema";

// Database lives inside the project folder: <project>/data/erp.db
const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "erp.db");

type Row = Record<string, any>;

const g = globalThis as unknown as { __erpDb?: DatabaseSync; __txDepth?: number };

const sqlType = (f: Field) =>
  f.type === "number" || f.type === "money" ? "REAL" : f.type === "ref" || f.type === "bool" ? "INTEGER" : "TEXT";

// Columns that exist for internal bookkeeping (not shown in forms).
const EXTRA: Record<string, [string, string][]> = {
  journal_entries: [["source_ref", "TEXT"], ["source_id", "INTEGER"]],
  receipts: [["customer_id", "INTEGER"]],
  vendor_payments: [["vendor_id", "INTEGER"]],
  quotations: [["ref_doc", "TEXT"]],
  sales_orders: [["ref_doc", "TEXT"]],
  sales_invoices: [["ref_doc", "TEXT"]],
  purchase_orders: [["ref_doc", "TEXT"]],
  purchase_bills: [["ref_doc", "TEXT"]],
};

const CORE_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, ntn TEXT, address TEXT, phone TEXT,
  currency TEXT NOT NULL DEFAULT 'PKR',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  company_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, key)
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL, item_id INTEGER NOT NULL, warehouse_id INTEGER NOT NULL,
  qty REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, date TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock_moves (company_id, item_id, warehouse_id);
`;

const FBR_SQL = `
CREATE TABLE IF NOT EXISTS fbr_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL,
  action TEXT NOT NULL, env TEXT NOT NULL, http_status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0, message TEXT,
  request_json TEXT, response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fbr_log_inv ON fbr_log (company_id, invoice_id);
`;

// Company-level FBR settings (the token is stored encrypted, see lib/secret.ts).
const COMPANY_COLUMNS: [string, string][] = [
  ["province", "TEXT"],
  ["fbr_env", "TEXT NOT NULL DEFAULT 'sandbox'"],
  ["fbr_token_enc", "TEXT"],
  ["fbr_scenario", "TEXT NOT NULL DEFAULT 'SN001'"],
];

function syncSchema(db: DatabaseSync) {
  db.exec(CORE_SQL);
  db.exec(FBR_SQL);
  const haveCo = new Set((db.prepare(`PRAGMA table_info("companies")`).all() as Row[]).map((c) => c.name as string));
  for (const [name, type] of COMPANY_COLUMNS) {
    if (!haveCo.has(name)) db.exec(`ALTER TABLE companies ADD COLUMN "${name}" ${type}`);
  }
  const done = new Set<string>();

  const ensureTable = (table: string, cols: [string, string][], base: string) => {
    if (!done.has(table)) {
      db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${base})`);
      done.add(table);
    }
    const have = new Set(
      (db.prepare(`PRAGMA table_info("${table}")`).all() as Row[]).map((c) => c.name as string),
    );
    for (const [name, type] of cols) {
      if (!have.has(name)) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
    }
  };

  for (const e of ENTITIES) {
    const table = tableOf(e);
    const cols: [string, string][] = e.fields.map((f) => [f.name, sqlType(f)]);
    // Aliased entities (e.g. outlets -> warehouses) share one table.
    const existing = ENTITIES.filter((x) => tableOf(x) === table);
    const merged = new Map<string, string>();
    for (const x of existing) for (const f of x.fields) merged.set(f.name, sqlType(f));
    for (const [n, tp] of EXTRA[table] ?? []) merged.set(n, tp);
    void cols;
    ensureTable(
      table,
      [...merged.entries()],
      `id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
    );
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${table}_co" ON "${table}" (company_id)`);

    if (e.lines) {
      const lt = `${table}_lines`;
      ensureTable(
        lt,
        e.lines.map((f) => [f.name, sqlType(f)] as [string, string]),
        `id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL`,
      );
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_${lt}_doc" ON "${lt}" (doc_id)`);
    }
  }
}

export function db(): DatabaseSync {
  if (!g.__erpDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conn = new DatabaseSync(DB_FILE);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    syncSchema(conn);
    g.__erpDb = conn;
  }
  return g.__erpDb;
}

const clean = (params: unknown[]) =>
  params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p)) as any[];

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return (db().prepare(sql).all(...clean(params)) as Row[]).map((r) => ({ ...r })) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  const r = db().prepare(sql).get(...clean(params)) as Row | undefined;
  return r ? ({ ...r } as T) : undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; id: number } {
  const res = db().prepare(sql).run(...clean(params));
  return { changes: Number(res.changes), id: Number(res.lastInsertRowid) };
}

/** Run fn inside a transaction; nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  const conn = db();
  const depth = g.__txDepth ?? 0;
  if (depth > 0) return fn();
  conn.exec("BEGIN IMMEDIATE");
  g.__txDepth = 1;
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    g.__txDepth = 0;
  }
}

export function nextNumber(companyId: number, key: string, prefix: string): string {
  run(
    `INSERT INTO counters (company_id, key, n) VALUES (?, ?, 1)
     ON CONFLICT(company_id, key) DO UPDATE SET n = n + 1`,
    companyId, key,
  );
  const row = get<{ n: number }>(`SELECT n FROM counters WHERE company_id=? AND key=?`, companyId, key)!;
  return `${prefix}-${String(row.n).padStart(5, "0")}`;
}
