import { describe, expect, it } from "vitest";
import { csvField, filterTxns, sortTxns, toCsv } from "./bank-export";
import type { BankTxn } from "./bank";

const t = (o: Partial<BankTxn>): BankTxn => ({ id: "1", account: "Operating ••1234", postedOn: "2026-10-01", txnOn: null, description: "X", merchant: null, bankCategory: null, checkNo: null, amountCents: -1000, category: "opex", kind: "opex", categorySource: "rule", needsReview: false, note: null, ...o }) as BankTxn;

describe("bank export", () => {
  it("quotes commas, quotes and line breaks, and defuses formulas", () => {
    expect(csvField('ACME, "INC"')).toBe('"ACME, ""INC"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField(null)).toBe("");
  });
  it("filters like the page", () => {
    const xs = [t({ id: "a", amountCents: 500, postedOn: "2026-09-01" }), t({ id: "b", needsReview: true }), t({ id: "c", description: "LOWES #123" })];
    expect(filterTxns(xs, { filter: "in", category: null, q: null, from: null, to: null }).map((x) => x.id)).toEqual(["a"]);
    expect(filterTxns(xs, { filter: "review", category: null, q: null, from: null, to: null }).map((x) => x.id)).toEqual(["b"]);
    expect(filterTxns(xs, { filter: "all", category: null, q: "lowes", from: null, to: null }).map((x) => x.id)).toEqual(["c"]);
    expect(filterTxns(xs, { filter: "all", category: null, q: null, from: "2026-09-15", to: null }).map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("writes signed and split amounts with a header and BOM", () => {
    const csv = toCsv([t({ amountCents: -12345 }), t({ amountCents: 50000 })], () => "Supplies");
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]!.startsWith("Posted,Transaction date,Account")).toBe(true);
    expect(lines[1]).toContain(",-123.45,,123.45,Supplies,");
    expect(lines[2]).toContain(",500.00,500.00,,Supplies,");
  });
  it("sorts by size, in or out, either way", () => {
    const xs = [t({ id: "s", amountCents: -500 }), t({ id: "b", amountCents: 90000 }), t({ id: "m", amountCents: -20000, postedOn: "2026-09-01" })];
    expect(sortTxns(xs, "size-desc").map((x) => x.id)).toEqual(["b", "m", "s"]);
    expect(sortTxns(xs, "size-asc").map((x) => x.id)).toEqual(["s", "m", "b"]);
    expect(sortTxns(xs, "date-desc")[2]!.id).toBe("m");
  });
});
