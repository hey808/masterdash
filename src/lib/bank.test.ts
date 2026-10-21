import { describe, expect, it } from "vitest";
import { fingerprints, matchRule, parseAmount, parseTruistCsv, parseUsDate, type Rule } from "./bank";
import { monthsBetween } from "./reports";

const CSV = `Posted Date,Transaction Date,Transaction Type,Check/Serial #,Full description,Merchant name,Category name,Sub-category name,Amount,Daily Posted Balance
08/27/2026,08/27/2026,POS,,FACEBK *2CNJK3E4S4 08-27 650-543-7818 CA 8416 DEBIT CARD PURCHASE,Facebook,Professional & Legal Services,,($2.00),$139966.24
08/27/2026,08/27/2026,POS,,FACEBK *2CNJK3E4S4 08-27 650-543-7818 CA 8416 DEBIT CARD PURCHASE,Facebook,Professional & Legal Services,,($2.00),$139966.24
08/27/2026,08/27/2026,Credit,,MERCH FUND ISPC 1958 CLEAR FLOW WATER CO. ACH CREDIT,Ispc,Deposits,,$2760.00,$139966.24
08/14/2026,08/14/2026,Check,1147,Check #1147,,Cash & Checks,,($180.00),$140048.02
`;

const rule = (r: Partial<Rule>): Rule => ({ id: r.pattern ?? "x", matchField: "description", pattern: "", direction: null, category: "c", needsReview: false, priority: 100, ...r });

describe("bank import", () => {
  it("reads Truist amounts exactly", () => {
    expect(parseAmount("($2500.00)")).toBe(-250000);
    expect(parseAmount("$14,931.55")).toBe(1493155);
    expect(parseAmount("$0.06")).toBe(6);
    expect(parseAmount("-12.5")).toBe(-1250);
    expect(parseAmount("abc")).toBeNull();
    expect(parseUsDate("8/3/2026")).toBe("2026-08-03");
  });

  it("parses a Truist export", () => {
    const l = parseTruistCsv(CSV);
    expect(l).toHaveLength(4);
    expect(l[2]).toMatchObject({ postedOn: "2026-08-27", amountCents: 276000, balanceCents: 13996624, bankCategory: "Deposits" });
    expect(l[3]).toMatchObject({ checkNo: "1147", amountCents: -18000 });
  });

  it("rejects a file that isn't a Truist export", () => {
    expect(() => parseTruistCsv("Date,Amount\n01/01/2026,5")).toThrow(/Truist/);
  });

  it("keeps true duplicates apart but matches the same line across overlapping files", () => {
    const l = parseTruistCsv(CSV);
    const a = fingerprints("5562", l);
    expect(new Set(a).size).toBe(4); // the two identical $2 lines both survive
    const again = fingerprints("5562", parseTruistCsv(CSV));
    expect(again).toEqual(a);
    expect(fingerprints("9999", l)[0]).not.toBe(a[0]);
  });

  it("picks the lowest-priority, most specific matching rule in the right direction", () => {
    const rules = [
      rule({ pattern: "FACEBK", category: "advertising", priority: 10 }),
      rule({ matchField: "bank_category", pattern: "Professional", category: "professional", priority: 70 }),
      rule({ pattern: "DEPOSIT", direction: "in", category: "customer_payments", priority: 30 }),
      rule({ pattern: "MOBILE DEPOSIT", direction: "in", category: "owner_contributions", priority: 30 }),
    ];
    const [fb, , , check] = parseTruistCsv(CSV);
    expect(matchRule(fb!, rules)?.category).toBe("advertising");
    expect(matchRule(check!, rules)).toBeNull();
    expect(matchRule({ description: "MOBILE DEPOSIT", bankCategory: null, amountCents: 100 }, rules)?.category).toBe("owner_contributions");
    expect(matchRule({ description: "MOBILE DEPOSIT", bankCategory: null, amountCents: -100 }, rules)).toBeNull();
  });

  it("lists months across a year end", () => {
    expect(monthsBetween("2026-11-01", "2027-02-10")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
