# Clearflow OS

The operating system for Clear Flow Water USA. A ground-up rebuild of Mission Control.

**Slice 1: the deal ledger as the source of truth.** One row per deal. Every money
figure anywhere in the app is derived from it by one pure function.

## Rules

1. **Integer cents.** Money is `bigint` cents in Postgres and `number` cents in TypeScript. Dollars exist only at import and display.
2. **Type facts, derive the rest.** People type the price, split, products, payments, payouts, dates and rates. Fees, revenue, balances, commission, COGS, profit and stage are computed in `src/lib/ledger/derive.ts` and never stored.
3. **Rates are stamped at sale.** Comp plans, lender fees and SKU costs are effective-dated tables. A deal copies the rate in force on its sale date. Changing a plan never rewrites history.
4. **Money in and money out are rows.** `payments` (customer and lender) and `payouts` (closer, override, setter, canvasser, installer). Owed = earned − paid.
5. **Overrides are narrow and reasoned.** Four nullable override columns, and the database rejects them without an `override_reason`.
6. **Everything is audited.** Triggers write every insert, update and delete to an append-only `audit_log`, tagged with the actor set per transaction.
7. **Revenue is recognized at install.** Sold-not-installed is backlog, not receivables.

## Layout

```
supabase/migrations/        schema + reference data (timestamped)
src/lib/money.ts            cents helpers
src/lib/ledger/derive.ts    THE ledger math (pure, tested)
src/lib/ledger/rollups.ts   receivables, payables, totals
src/lib/ledger/repo.ts      the only SQL that reads the ledger
src/import/                 Mission Control export → ledger records (pure)
scripts/import-mc-csv.ts    import in one transaction + row-by-row reconciliation
app/ledger/                 read-only ledger page
```

## Run it

```bash
cp .env.example .env.local        # set DATABASE_URL (Supabase pooled URL, or local Postgres)
npm install
npm run db:migrate
npm run import:mc-csv -- path/to/clearflow-deal-ledger.csv --as-of 2026-10-20
npm run dev                       # http://localhost:3000/ledger
npm test
```

The importer refuses to commit unless every Mission Control number on every row is
reproduced within 1 cent. Values Mission Control pinned by hand over its own formula
are listed in the report and not carried over. Re-importing the same file needs `--replace`.
