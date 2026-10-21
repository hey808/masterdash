/**
 * Edit path against a real Postgres. Runs only when TEST_DATABASE_URL points
 * at a disposable database that has the migrations and the import loaded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db";
import { EditError, applyEdit } from "./edit";
import { loadDeal } from "./repo";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("applyEdit (database)", () => {
  let cashDeal: { id: string; version: number; price_cents: number };
  let finDeal: { id: string; version: number };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    cashDeal = (await db().query("select id, version, price_cents from deals where financed_portion_cents = 0 and cash_portion_cents = price_cents limit 1")).rows[0];
    finDeal = (await db().query("select id, version from deals where financed_portion_cents > 0 and cash_portion_cents = 0 and lender_id is not null limit 1")).rows[0];
  });
  afterAll(closeDb);

  it("changing the price of an all-cash deal moves the cash portion with it", async () => {
    const d = await applyEdit(cashDeal.id, "priceCents", cashDeal.price_cents + 10000, cashDeal.version, "test:edit");
    expect(d.priceCents).toBe(cashDeal.price_cents + 10000);
    expect(d.cashPortionCents).toBe(d.priceCents);
    expect(d.version).toBe(cashDeal.version + 1);
    cashDeal.version = d.version;
  });

  it("records who changed what in the audit log", async () => {
    const { rows } = await db().query(
      "select actor, before->>'price_cents' as b, after->>'price_cents' as a from audit_log where table_name = 'deals' and row_id = $1 order by id desc limit 1",
      [cashDeal.id],
    );
    expect(rows[0].actor).toBe("test:edit");
    expect(Number(rows[0].a) - Number(rows[0].b)).toBe(10000);
  });

  it("rejects an edit made against a stale version and returns the latest row", async () => {
    const err = await applyEdit(cashDeal.id, "note", "stale", cashDeal.version - 1, "test:edit").catch((e) => e);
    expect(err).toBeInstanceOf(EditError);
    expect(err.status).toBe(409);
    expect(err.current.version).toBe(cashDeal.version);
  });

  it("turns a constraint violation into a plain message", async () => {
    // Moving a cash deal's money to financing with no lender on it breaks the lender rule.
    const err = await applyEdit(cashDeal.id, "cashPortionCents", 1, cashDeal.version, "test:edit").catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/lender/i);
  });

  it("keeps cash + financed = price when either side or the price is edited", async () => {
    const cur = (await loadDeal(finDeal.id))!;
    const price = cur.priceCents;
    let d = await applyEdit(finDeal.id, "cashPortionCents", 100000, cur.version, "test:edit");
    expect([d.cashPortionCents, d.financedPortionCents]).toEqual([100000, price - 100000]);
    d = await applyEdit(finDeal.id, "financedPortionCents", price - 50000, d.version, "test:edit");
    expect([d.cashPortionCents, d.financedPortionCents]).toEqual([50000, price - 50000]);
    // Mixed deal: a new price keeps the financed amount and moves cash.
    d = await applyEdit(finDeal.id, "priceCents", price + 20000, d.version, "test:edit");
    expect([d.priceCents, d.cashPortionCents, d.financedPortionCents]).toEqual([price + 20000, 70000, price - 50000]);
    const err = await applyEdit(finDeal.id, "financedPortionCents", price + 999999, d.version, "test:edit").catch((e) => e);
    expect(err.message).toMatch(/more than the price/);
  });

  it("replaces products and snapshots each SKU's cost on the sale date", async () => {
    const fresh = (await loadDeal(finDeal.id))!;
    const d = await applyEdit(finDeal.id, "products", [{ skuCode: "PWF", qty: 1 }, { skuCode: "RO", qty: 2 }], fresh.version, "test:edit");
    expect(d.lines.map((l) => `${l.qty}x${l.skuCode}`).sort()).toEqual(["1xPWF", "2xRO"]);
    expect(d.cogsCents).toBe(d.cogsOverrideCents ?? d.lines.reduce((s, l) => s + l.qty * l.unitCostCents, 0));
  });

  it("rejects bad values before touching the database", async () => {
    const err = await applyEdit(cashDeal.id, "commissionRate", 1.5, cashDeal.version, "test:edit").catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/100% or less/);
  });

  it("a hand-typed commission rate is marked as an override with a reason", async () => {
    const d = await applyEdit(cashDeal.id, "commissionRate", 0.12, cashDeal.version, "test:edit");
    expect(d.commissionRateSource).toBe("override");
    expect(d.overrideReason).toMatch(/edited in the ledger/);
  });
});
