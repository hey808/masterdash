/**
 * Forms + inventory against a real Postgres (TEST_DATABASE_URL, disposable,
 * with migrations and the import loaded).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db";
import { submitInstall, submitSale } from "./forms";
import { createPurchaseOrder, loadStock, recordCount, setPurchaseOrderStatus } from "./inventory";
import { loadDeal } from "./ledger/repo";

const url = process.env.TEST_DATABASE_URL;
const LOC = "myrtle-beach";

describe.skipIf(!url)("forms and inventory (database)", () => {
  let brock: string, angel: string, mike: string, adam: string;
  let dealId = "";
  const stockOf = async (sku: string) => (await loadStock(LOC, "2026-10-20")).find((r) => r.skuCode === sku)!;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const ids = Object.fromEntries((await db().query("select lower(name) n, id from people")).rows.map((r) => [r.n, r.id])) as Record<string, string>;
    [brock, angel, mike, adam] = [ids.brock!, ids.angel!, ids.mike!, ids.adam!];
  });
  afterAll(closeDb);

  it("a shelf count sets on-hand to what was counted", async () => {
    const { delta } = await recordCount({ location: LOC, skuCode: "WH", countedQty: 5, countedOn: "2026-10-20" });
    expect(typeof delta).toBe("number");
    expect((await stockOf("WH")).onHand).toBe(5);
  });

  it("the sales form creates the deal with plan rates and allocates its products", async () => {
    const before = await stockOf("WH");
    const r = await submitSale({
      closerId: brock, setterId: adam, location: LOC, customerName: "Test Buyer", customerAddress: "1 Ocean Blvd, Myrtle Beach SC",
      saleDate: "2026-10-20", products: [{ skuCode: "WH", qty: 2 }], priceCents: 749500, financedPortionCents: 0, lender: null,
      deposit: { amountCents: 50000, method: "check" }, installScheduledOn: "2026-10-27",
    });
    dealId = r.id;
    const d = (await loadDeal(r.id))!;
    expect(d.commissionRate).toBe(0.15); // at or above the $7,495 tier
    expect(d.managerRate).toBe(0.03);
    expect(d.manager?.id).toBe(mike);
    expect(d.setterRate).toBe(0); // setters earn nothing
    expect(d.adminFeeCents).toBe(25000);
    expect(d.cashPortionCents).toBe(749500);
    expect(d.payments).toHaveLength(1);
    const after = await stockOf("WH");
    expect(after.committed - before.committed).toBe(2);
    expect(after.available - before.available).toBe(-2);
    expect(after.onHand).toBe(before.onHand); // still on the shelf until installed
    const sub = await db().query("select kind, submitted_by from form_submissions where deal_id = $1", [r.id]);
    expect(sub.rows[0]).toEqual({ kind: "sale", submitted_by: brock });
  });

  it("the manager's own sale carries no override", async () => {
    const r = await submitSale({
      closerId: mike, location: LOC, customerName: "Mike Own", customerAddress: "2 Ocean Blvd", saleDate: "2026-10-20",
      products: [{ skuCode: "PWF", qty: 1 }], priceCents: 300000, financedPortionCents: 300000, lender: "ISPC", deposit: null, installScheduledOn: null,
    });
    const d = (await loadDeal(r.id))!;
    expect(d.managerRate).toBe(0);
    expect(d.commissionRate).toBe(0.1);
    expect(d.lenderRate).toBe(0.1);
  });

  it("rejects a financed sale with no lender", async () => {
    await expect(
      submitSale({ closerId: brock, location: LOC, customerName: "No Lender", customerAddress: "3 Ocean Blvd", saleDate: "2026-10-20", products: [{ skuCode: "RO", qty: 1 }], priceCents: 100000, financedPortionCents: 100000, lender: null, deposit: null, installScheduledOn: null }),
    ).rejects.toThrow(/lender/i);
  });

  it("the installer form only accepts an existing deal", async () => {
    await expect(submitInstall({ dealId: "00000000-0000-4000-8000-000000000000", installerId: angel, installedOn: "2026-10-20", collected: null })).rejects.toThrow(/existing customer/);
  });

  it("the installer form marks it installed and the units leave the warehouse", async () => {
    const before = await stockOf("WH");
    await submitInstall({ dealId, installerId: angel, installedOn: "2026-10-20", collected: { amountCents: 699500, method: "check" }, note: "All good" });
    const d = (await loadDeal(dealId))!;
    expect(d.installedOn).toBe("2026-10-20");
    expect(d.installer?.id).toBe(angel);
    expect(d.payments).toHaveLength(2);
    expect(d.note).toMatch(/Install 2026-10-20 \(Angel\): All good/);
    const after = await stockOf("WH");
    expect(after.onHand - before.onHand).toBe(-2);
    expect(after.committed - before.committed).toBe(-2);
    expect(after.available).toBe(before.available); // was already set aside
  });

  it("won't install the same job twice", async () => {
    await expect(submitInstall({ dealId, installerId: angel, installedOn: "2026-10-20", collected: null })).rejects.toThrow(/already marked installed/);
  });

  it("a purchase order counts as on order, then on the shelf once received", async () => {
    const before = await stockOf("RO");
    const po = await createPurchaseOrder({ location: LOC, vendor: "Aquonyx", orderedOn: "2026-10-20", expectedOn: null, lines: [{ skuCode: "RO", qty: 10, unitCostCents: 29700 }] });
    expect((await stockOf("RO")).onOrder - before.onOrder).toBe(10);
    await setPurchaseOrderStatus(po.id, { action: "receive", receivedOn: "2026-10-20" });
    const after = await stockOf("RO");
    expect(after.onOrder).toBe(before.onOrder);
    expect(after.onHand - before.onHand).toBe(10);
  });
});
