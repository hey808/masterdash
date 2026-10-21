/** Record funding + the cash/card/financed split, against a real Postgres (TEST_DATABASE_URL). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db";
import { submitFunding } from "./forms";
import { applyEdit } from "./ledger/edit";
import { derive } from "./ledger/derive";
import { loadDeal } from "./ledger/repo";

const url = process.env.TEST_DATABASE_URL;
const AS_OF = "2026-10-21";

describe.skipIf(!url)("record funding (database)", () => {
  let unfunded: { id: string; financed: number };
  let cash: { id: string; version: number; price: number };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    unfunded = (
      await db().query(
        `select id, financed_portion_cents as financed from deals d where financed_portion_cents > 0 and cancelled_at is null
           and loan_interest_override_cents is null and not exists (select 1 from payments p where p.deal_id = d.id and p.source = 'lender') limit 1`,
      )
    ).rows[0];
    cash = (await db().query("select id, version, price_cents as price from deals where financed_portion_cents = 0 and cash_portion_cents = price_cents and price_cents > 300000 limit 1")).rows[0];
  });
  afterAll(closeDb);

  it("before funding the lender fee is 0 and the whole financed amount is due", async () => {
    const d = derive((await loadDeal(unfunded.id))!, AS_OF);
    expect(d.loanInterestCents).toBe(0);
    expect(d.fundingDueCents).toBe(unfunded.financed);
  });

  it("refuses funding plus fee above the loan", async () => {
    await expect(submitFunding({ dealId: unfunded.id, fundedOn: AS_OF, amountCents: unfunded.financed, lenderFeeCents: 10000 })).rejects.toThrow(/more than what's left/);
  });

  it("records what the lender sent and the fee they kept; nothing left due", async () => {
    const fee = Math.round(unfunded.financed * 0.08);
    await submitFunding({ dealId: unfunded.id, fundedOn: AS_OF, amountCents: unfunded.financed - fee, lenderFeeCents: fee, reference: "T-1" });
    const d = derive((await loadDeal(unfunded.id))!, AS_OF);
    expect(d.loanInterestCents).toBe(fee);
    expect(d.fundedCents).toBe(unfunded.financed - fee);
    expect(d.fundingDueCents).toBe(0);
    expect(d.netRevenueCents).toBe(d.priceCents - fee - d.cardFeeCents);
    const sub = (await db().query("select kind from form_submissions where deal_id = $1 order by created_at desc limit 1", [unfunded.id])).rows[0];
    expect(sub.kind).toBe("funding");
  });

  it("a card amount comes out of cash, and the split always adds up", async () => {
    let d = await applyEdit(cash.id, "cardPortionCents", 100000, cash.version, "test:edit");
    expect(d.cardPortionCents).toBe(100000);
    expect(d.cashPortionCents).toBe(cash.price - 100000);
    expect(d.splitDiffCents).toBe(0);
    d = await applyEdit(cash.id, "priceCents", cash.price + 5000, d.version, "test:edit");
    expect(d.cardPortionCents).toBe(100000);
    expect(d.cashPortionCents).toBe(cash.price + 5000 - 100000);
    await expect(applyEdit(cash.id, "cardPortionCents", cash.price + 6000, d.version, "test:edit")).rejects.toThrow(/more than the price/);
  });
});
