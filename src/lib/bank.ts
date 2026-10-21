/**
 * Bank activity. Truist CSV export → bank_transactions, categorized by rules.
 *
 * Re-importing an overlapping statement is safe: each line gets a fingerprint
 * (account + dates + amount + description + check no. + how many identical
 * lines came before it in the file), and existing fingerprints are skipped.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db, tx } from "./db";
import { EditError } from "./ledger/edit";

export type CategoryKind = "income" | "other_income" | "ledger" | "cogs" | "opex" | "financing" | "transfer" | "uncategorized";

export interface BankCategory {
  slug: string;
  name: string;
  kind: CategoryKind;
}

export interface ParsedLine {
  postedOn: string;
  txnOn: string | null;
  txnType: string | null;
  checkNo: string | null;
  description: string;
  merchant: string | null;
  bankCategory: string | null;
  amountCents: number;
  balanceCents: number | null;
}

export interface Rule {
  id: string;
  matchField: "description" | "bank_category";
  pattern: string;
  direction: "in" | "out" | null;
  category: string;
  needsReview: boolean;
  priority: number;
}

/* ── Parsing ─────────────────────────────────────────────────────────── */

/** "($2,500.00)" → -250000, "$5000.00" → 500000, "-12.5" → -1250. Exact, no floats. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return neg ? -cents : cents;
}

/** mm/dd/yyyy → yyyy-mm-dd */
export function parseUsDate(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

const HEADERS = ["Posted Date", "Transaction Date", "Transaction Type", "Check/Serial #", "Full description", "Merchant name", "Category name", "Sub-category name", "Amount", "Daily Posted Balance"];

export function parseTruistCsv(text: string): ParsedLine[] {
  const records = parse(text.replace(/^﻿/, ""), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Array<Record<string, string>>;
  if (!records.length) throw new EditError("That file has no transactions in it.", 400);
  const missing = HEADERS.filter((h) => !(h in records[0]!)).filter((h) => h !== "Sub-category name");
  if (missing.length) throw new EditError(`This doesn't look like a Truist export (missing ${missing.join(", ")}).`, 400);
  return records.map((r, i) => {
    const postedOn = parseUsDate(r["Posted Date"] ?? "");
    const amountCents = parseAmount(r["Amount"] ?? "");
    if (!postedOn || amountCents == null) throw new EditError(`Row ${i + 2}: couldn't read the date or amount.`, 400);
    const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
    return {
      postedOn,
      txnOn: parseUsDate(r["Transaction Date"] ?? ""),
      txnType: blank(r["Transaction Type"]),
      checkNo: blank(r["Check/Serial #"]),
      description: (r["Full description"] ?? "").trim().replace(/\s+/g, " "),
      merchant: blank(r["Merchant name"]),
      bankCategory: blank(r["Category name"]),
      amountCents,
      balanceCents: parseAmount(r["Daily Posted Balance"] ?? ""),
    };
  });
}

/** Stable per-line identity; the nth identical line in a file gets #n so true duplicates survive. */
export function fingerprints(accountLast4: string, lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [accountLast4, l.postedOn, l.txnOn ?? "", l.amountCents, l.checkNo ?? "", l.description.toUpperCase()].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}|#${n}`).digest("hex").slice(0, 32);
  });
}

/** Bank tables not created yet (migration not applied): read as empty instead of failing the page. */
async function orEmpty<T>(q: () => Promise<T[]>): Promise<T[]> {
  try {
    return await q();
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return [];
    throw e;
  }
}

/* ── Rules ───────────────────────────────────────────────────────────── */

export function matchRule(line: Pick<ParsedLine, "description" | "bankCategory" | "amountCents">, rules: Rule[]): Rule | null {
  const dir = line.amountCents >= 0 ? "in" : "out";
  let best: Rule | null = null;
  for (const r of rules) {
    if (r.direction && r.direction !== dir) continue;
    const hay = (r.matchField === "description" ? line.description : line.bankCategory ?? "").toUpperCase();
    if (!hay.includes(r.pattern.toUpperCase())) continue;
    // Lower priority number wins; ties go to the longer (more specific) pattern.
    if (!best || r.priority < best.priority || (r.priority === best.priority && r.pattern.length > best.pattern.length)) best = r;
  }
  return best;
}

async function loadRules(client: pg.Pool | pg.PoolClient = db()): Promise<Rule[]> {
  const { rows } = await client.query(
    `select id, match_field as "matchField", pattern, direction, category, needs_review as "needsReview", priority from bank_rules`,
  );
  return rows;
}

export async function loadCategories(): Promise<BankCategory[]> {
  return orEmpty(async () => (await db().query("select slug, name, kind from bank_categories order by sort")).rows);
}

/* ── Import ──────────────────────────────────────────────────────────── */

export const ImportRequest = z.object({
  fileName: z.string().trim().min(1).max(200),
  text: z.string().min(10, "The file is empty").max(5_000_000, "That file is too big"),
  accountLast4: z.string().regex(/^\d{4}$/, "Account must be the last 4 digits").optional(),
});

export interface ImportResult {
  account: string;
  rows: number;
  added: number;
  skipped: number;
  firstOn: string;
  lastOn: string;
  needsReview: number;
}

export async function importBankCsv(input: unknown, actor = "web:bank"): Promise<ImportResult> {
  const p = ImportRequest.safeParse(input);
  if (!p.success) throw new EditError(p.error.issues[0]?.message ?? "Check the file", 400);
  const { fileName, text } = p.data;
  const last4 = p.data.accountLast4 ?? /acct_(\d{4})/i.exec(fileName)?.[1];
  if (!last4) throw new EditError("Which account is this? The file name doesn't say (expected acct_1234 in it).", 400);
  const lines = parseTruistCsv(text);
  const prints = fingerprints(last4, lines);
  const dates = lines.map((l) => l.postedOn).sort();
  const firstOn = dates[0]!;
  const lastOn = dates[dates.length - 1]!;

  return tx(actor, async (c) => {
    const acct = await c.query(
      `insert into bank_accounts (name, last4) values ($1, $2)
       on conflict (last4) do update set last4 = excluded.last4 returning id, name`,
      [`Truist ****${last4}`, last4],
    );
    const accountId: string = acct.rows[0].id;
    const rules = await loadRules(c);
    const imp = await c.query(
      "insert into bank_imports (account_id, file_name, row_count, new_count, first_on, last_on) values ($1, $2, $3, 0, $4, $5) returning id",
      [accountId, fileName, lines.length, firstOn, lastOn],
    );
    const importId: string = imp.rows[0].id;
    const batch = lines.map((l, i) => {
      const rule = matchRule(l, rules);
      // Every deposit is revenue unless a rule says otherwise (e.g. lender funding).
      const inflowDefault = !rule && l.amountCents > 0;
      return {
        fingerprint: prints[i], posted_on: l.postedOn, txn_on: l.txnOn, txn_type: l.txnType, check_no: l.checkNo,
        description: l.description, merchant: l.merchant, bank_category: l.bankCategory, amount_cents: l.amountCents,
        balance_cents: l.balanceCents,
        category: rule?.category ?? (inflowDefault ? "customer_payments" : "uncategorized"),
        rule_id: rule?.id ?? null,
        needs_review: rule ? rule.needsReview : !inflowDefault,
      };
    });
    // One statement for the whole file; existing fingerprints (overlapping statements) are skipped.
    const ins = await c.query(
      `insert into bank_transactions (account_id, import_id, fingerprint, posted_on, txn_on, txn_type, check_no, description, merchant,
         bank_category, amount_cents, balance_cents, category, category_source, rule_id, needs_review)
       select $1, $2, x.fingerprint, x.posted_on, x.txn_on, x.txn_type, x.check_no, x.description, x.merchant,
         x.bank_category, x.amount_cents, x.balance_cents, x.category, 'rule', x.rule_id, x.needs_review
       from jsonb_to_recordset($3::jsonb) as x(fingerprint text, posted_on date, txn_on date, txn_type text, check_no text, description text,
         merchant text, bank_category text, amount_cents bigint, balance_cents bigint, category text, rule_id uuid, needs_review boolean)
       on conflict (account_id, fingerprint) do nothing
       returning needs_review`,
      [accountId, importId, JSON.stringify(batch)],
    );
    const added = ins.rowCount ?? 0;
    const review = ins.rows.filter((r) => r.needs_review).length;
    await c.query("update bank_imports set new_count = $2 where id = $1", [importId, added]);
    return { account: acct.rows[0].name, rows: lines.length, added, skipped: lines.length - added, firstOn, lastOn, needsReview: review };
  });
}

/* ── Reading ─────────────────────────────────────────────────────────── */

export interface BankTxn {
  id: string;
  account: string;
  postedOn: string;
  txnOn: string | null;
  description: string;
  merchant: string | null;
  bankCategory: string | null;
  checkNo: string | null;
  amountCents: number;
  category: string;
  kind: CategoryKind;
  categorySource: "rule" | "user";
  needsReview: boolean;
  note: string | null;
}

export async function loadTransactions(f: { from?: string | null; to?: string | null } = {}): Promise<BankTxn[]> {
  return orEmpty(async () => (await db().query(
    `select t.id, a.name as account, t.posted_on as "postedOn", t.txn_on as "txnOn", t.description, t.merchant,
            t.bank_category as "bankCategory", t.check_no as "checkNo", t.amount_cents as "amountCents",
            t.category, c.kind, t.category_source as "categorySource", t.needs_review as "needsReview", t.note
     from bank_transactions t join bank_accounts a on a.id = t.account_id join bank_categories c on c.slug = t.category
     where ($1::date is null or t.posted_on >= $1) and ($2::date is null or t.posted_on <= $2)
     order by t.posted_on desc, t.amount_cents asc, t.id`,
    [f.from ?? null, f.to ?? null],
  )).rows);
}

export interface AccountBalance {
  accountId: string;
  name: string;
  last4: string;
  /** End-of-day balance on the latest posted day on or before the date. */
  balanceCents: number | null;
  asOf: string | null;
  firstOn: string | null;
  lastOn: string | null;
}

/** Each account's bank-reported balance at the end of `onOrBefore` (latest posted day ≤ that date). */
export async function accountBalances(onOrBefore: string): Promise<AccountBalance[]> {
  return orEmpty(async () => (await db().query(
    `select a.id as "accountId", a.name, a.last4,
       (select t.balance_cents from bank_transactions t where t.account_id = a.id and t.posted_on <= $1 and t.balance_cents is not null
         order by t.posted_on desc limit 1) as "balanceCents",
       (select max(t.posted_on) from bank_transactions t where t.account_id = a.id and t.posted_on <= $1) as "asOf",
       (select min(t.posted_on) from bank_transactions t where t.account_id = a.id) as "firstOn",
       (select max(t.posted_on) from bank_transactions t where t.account_id = a.id) as "lastOn"
     from bank_accounts a order by a.name`,
    [onOrBefore],
  )).rows);
}

/** Bank balance at the start of `day`: end-of-day balance of the first posted day ≥ day, minus that day's movement. */
export async function openingBalance(accountId: string, day: string): Promise<number | null> {
  const { rows } = await db().query(
    `with d as (select min(posted_on) as on_day from bank_transactions where account_id = $1 and posted_on >= $2)
     select (select balance_cents from bank_transactions where account_id = $1 and posted_on = d.on_day and balance_cents is not null limit 1)
          - (select coalesce(sum(amount_cents), 0) from bank_transactions where account_id = $1 and posted_on = d.on_day) as opening
     from d`,
    [accountId, day],
  );
  return rows[0]?.opening == null ? null : Number(rows[0].opening);
}

/* ── Editing ─────────────────────────────────────────────────────────── */

export const Recategorize = z.object({
  category: z.string().regex(/^[a-z_]+$/),
  /** Also make a rule from this text and apply it to every line it matches that nobody set by hand. */
  rulePattern: z.string().trim().min(3, "Rule text must be at least 3 characters").max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function recategorize(id: string, input: unknown, actor = "web:bank"): Promise<{ updated: number }> {
  const p = Recategorize.safeParse(input);
  if (!p.success) throw new EditError(p.error.issues[0]?.message ?? "Check the category", 400);
  const v = p.data;
  return tx(actor, async (c) => {
    const cat = await c.query("select 1 from bank_categories where slug = $1", [v.category]);
    if (!cat.rowCount) throw new EditError("Unknown category.", 400);
    const t = await c.query("select amount_cents, description from bank_transactions where id = $1 for update", [id]);
    if (!t.rowCount) throw new EditError("That transaction no longer exists.", 404);
    await c.query(
      `update bank_transactions set category = $2, category_source = 'user', needs_review = false, rule_id = null,
         note = coalesce($3, note) where id = $1`,
      [id, v.category, v.note ?? null],
    );
    let updated = 1;
    if (v.rulePattern) {
      if (!String(t.rows[0].description).toUpperCase().includes(v.rulePattern.toUpperCase())) {
        throw new EditError("The rule text has to appear in this line's description.", 400);
      }
      const dir = Number(t.rows[0].amount_cents) >= 0 ? "in" : "out";
      const rule = await c.query(
        `insert into bank_rules (match_field, pattern, direction, category, needs_review, priority, created_by)
         values ('description', $1, $2, $3, false, 1, $4) returning id`,
        [v.rulePattern, dir, v.category, actor],
      );
      const res = await c.query(
        `update bank_transactions set category = $1, rule_id = $2, needs_review = false
         where category_source = 'rule' and id <> $3
           and upper(description) like '%' || upper($4) || '%'
           and (case when amount_cents >= 0 then 'in' else 'out' end) = $5`,
        [v.category, rule.rows[0].id, id, v.rulePattern.replace(/[%_]/g, (m) => `\\${m}`), dir],
      );
      updated += res.rowCount ?? 0;
    }
    return { updated };
  });
}

export async function markReviewed(ids: string[], actor = "web:bank"): Promise<number> {
  if (!ids.length) return 0;
  return tx(actor, async (c) => {
    const r = await c.query("update bank_transactions set needs_review = false where id = any($1::uuid[])", [ids]);
    return r.rowCount ?? 0;
  });
}
