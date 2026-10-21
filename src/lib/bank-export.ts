/** Bank transactions as CSV: what the Bank page shows, for a spreadsheet or QuickBooks. */
import type { BankTxn } from "./bank";

export type BankFilter = "all" | "review" | "in" | "out";
/** Newest / oldest first, or by size (dollar amount, in or out). */
export type BankSort = "date-desc" | "date-asc" | "size-desc" | "size-asc";
export const isBankSort = (s: unknown): s is BankSort => s === "date-desc" || s === "date-asc" || s === "size-desc" || s === "size-asc";

export function sortTxns(txns: BankTxn[], sort: BankSort): BankTxn[] {
  const size = (t: BankTxn) => Math.abs(t.amountCents);
  const byDate = (a: BankTxn, b: BankTxn) => a.postedOn.localeCompare(b.postedOn) || size(a) - size(b);
  const out = [...txns];
  switch (sort) {
    case "date-desc": return out.sort((a, b) => byDate(b, a));
    case "date-asc": return out.sort(byDate);
    case "size-desc": return out.sort((a, b) => size(b) - size(a) || b.postedOn.localeCompare(a.postedOn));
    case "size-asc": return out.sort((a, b) => size(a) - size(b) || b.postedOn.localeCompare(a.postedOn));
  }
}

export interface ExportQuery {
  filter: BankFilter;
  category: string | null;
  q: string | null;
  from: string | null;
  to: string | null;
}

export function filterTxns(txns: BankTxn[], f: ExportQuery): BankTxn[] {
  return txns.filter(
    (t) =>
      (f.filter === "all" || (f.filter === "review" ? t.needsReview : f.filter === "in" ? t.amountCents > 0 : t.amountCents < 0)) &&
      (!f.category || t.category === f.category) &&
      (!f.q || t.description.toUpperCase().includes(f.q.toUpperCase())) &&
      (!f.from || t.postedOn >= f.from) &&
      (!f.to || t.postedOn <= f.to),
  );
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break; leading =+-@ neutralized so a spreadsheet won't run it as a formula. */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const KIND: Record<string, string> = {
  income: "Income",
  other_income: "Other income",
  ledger: "Job costs (booked on deals)",
  cogs: "Cost of goods",
  opex: "Operating expense",
  financing: "Loans & owner",
  transfer: "Transfer",
  uncategorized: "Uncategorized",
};

export function toCsv(txns: BankTxn[], categoryName: (slug: string) => string): string {
  const head = ["Posted", "Transaction date", "Account", "Description", "Merchant", "Check #", "Amount", "Money in", "Money out", "Category", "Type", "Bank category", "Needs review", "Note"];
  const rows = txns.map((t) => {
    const amt = (t.amountCents / 100).toFixed(2);
    return [
      t.postedOn,
      t.txnOn ?? "",
      t.account,
      t.description,
      t.merchant ?? "",
      t.checkNo ?? "",
      amt,
      t.amountCents > 0 ? amt : "",
      t.amountCents < 0 ? (-t.amountCents / 100).toFixed(2) : "",
      categoryName(t.category),
      KIND[t.kind] ?? t.kind,
      t.bankCategory ?? "",
      t.needsReview ? "Yes" : "No",
      t.note ?? "",
    ]
      .map(csvField)
      .join(",");
  });
  // BOM so Excel reads it as UTF-8; CRLF line ends per RFC 4180.
  return "﻿" + [head.join(","), ...rows].join("\r\n") + "\r\n";
}
