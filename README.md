# Child ERP

All-in-one cloud ERP: Sales, Procurement, Inventory & Warehouse, Manufacturing,
Financial Management, HRM & Payroll, CRM, Projects, Assets, POS and Reports.

Everything lives in this folder, including the database (`data/erp.db`).

## Run it

```powershell
npm install        # first time only
npm run dev        # development: http://localhost:9500
```

Production: `npm run build` then `npm start`.

Open the app and choose **Create an account** to set up your first company. A
default chart of accounts and a "Main Warehouse" are created for you.

## How the modules work together

| Action | Stock | Ledger |
| --- | --- | --- |
| Post purchase bill | Stock in, average cost updated | Dr Inventory / Dr Tax, Cr Payables |
| Post sales invoice | Stock out (blocked if insufficient) | Dr Receivables, Cr Sales + Tax, Dr COGS, Cr Inventory |
| Receipt / vendor payment | - | Dr Cash/Bank, Cr Receivables (or reverse for payables) |
| Stock transfer / adjustment | Moves or corrects stock | Adjustments hit Inventory |
| Production order complete | Components out, finished goods in | Materials + labor + overhead capitalised, job cost recorded |
| POS sale | Stock out of the outlet | Cash/Bank, Sales, Tax, COGS |
| Payroll (generate / post / pay) | - | Salaries expense, payable, deductions |
| Asset register / depreciation / disposal / revaluation | - | Fixed Assets, Accumulated Depreciation, gain/loss |

Reports (Profit & Loss, Balance Sheet, Trial Balance, General Ledger, Cash Flow,
Budget vs Actual, Inventory, Sales, Purchases, Receivables/Payables Aging,
Outlet Comparison) are all computed from posted ledger and stock data.

## FBR digital invoicing (PRAL)

Implements "Technical Specification for DI API v1.12" (copy in `docs/fbr/`).

Setup, in order:
1. **Settings → Company profile**: company name, NTN (7 digits) or CNIC (13), and address.
2. **Settings → FBR digital invoicing**: province, paste the token FBR issues you, keep
   **Sandbox**, then press **Test connection**. The token is encrypted in the database.
3. **Items**: every item sold needs an HS code (0000.0000), FBR unit of measure and sales
   tax %. **Customers**: NTN/CNIC, province, address and registered/unregistered.
4. Open a sales invoice. The **FBR digital invoicing** panel lists anything missing, then
   **Check with FBR** (validates only) and **Submit to FBR**.
5. After FBR accepts, the invoice gets its FBR invoice number, is locked, and prints with
   the number and a QR code (version 2, 1 x 1 inch).

Tax is now set **per line** (defaults from the item), as FBR requires. Every call is
logged on the invoice. Put FBR's official logo at `public/fbr-logo.png` to print it.

Local test without credentials: `node scripts/dev-with-mock.mjs` runs the app on port 3100
against a mock gateway (token `MOCK-TOKEN-1234567890`). Testing only.

Unconfirmed details to verify in the sandbox: the spec's sample is inconsistent on
sale-type capitalisation, whether `valueSalesExcludingST` is before or after discount (we
send it after, with the discount shown separately), and exact province spellings (Test
connection prints FBR's list). The spec does not say what the QR encodes; we encode the
FBR invoice number.

## Where things are

- `lib/schema.ts` - every module's fields, statuses and buttons, defined once.
  Adding a field here adds the column, form input and list column.
- `lib/posting.ts` - business rules that connect the modules.
- `lib/crud.ts`, `lib/db.ts`, `lib/auth.ts`, `lib/actions.ts` - data access, SQLite, login, server actions.
- `lib/reports.ts` - report queries.
- `app/` - screens. `components/` - shared UI (forms, POS terminal, sidebar).

## Known limits (honest list)

- **FBR digital invoicing** is built to the official spec but has **not been run
  against the real FBR gateway** (that needs your tax registration and token). It was
  tested against a local mock that follows the spec. Run FBR's sandbox scenarios first.
  Not supported yet: debit notes, further tax / extra tax / FED, withholding, 3rd-schedule
  retail-price items, and sale types beyond standard, reduced, exempt and zero-rated.
- **ZATCA** (Saudi Arabia) is not built.
- Posted documents are locked. There is no reversal or credit-note flow yet.
- Money is stored as decimal numbers rounded to 2 places (fine for an MVP; consider
  integer minor units before heavy production use).
- SQLite (built into Node) is a single-server database. For many concurrent
  customers, move to PostgreSQL; `lib/db.ts` is the only file that touches it.
- Permissions are two roles (administrator, user); no per-module access control yet.
- No automated tests yet; the main flows were checked by hand in the browser.
