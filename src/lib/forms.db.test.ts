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
      products: [{ skuCode: "PWF", qty: 1 }], priceCents: 300000, financedPortionCents: 300000, lender: "ISPC", deposit: null, installScheduledOn: "2026-10-28",
    });
    const d = (await loadDeal(r.id))!;
    expect(d.managerRate).toBe(0);
    expect(d.commissionRate).toBe(0.1);
    expect(d.lenderRate).toBe(0.1);
  });

  it("rejects a financed sale with no lender", async () => {
    await expect(
      submitSale({ closerId: brock, location: LOC, customerName: "No Lender", customerAddress: "3 Ocean Blvd", saleDate: "2026-10-20", products: [{ skuCode: "RO", qty: 1 }], priceCents: 100000, financedPortionCents: 100000, lender: null, deposit: null, installScheduledOn: "2026-10-28" }),
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

describe.skipIf(!url)("payout form (database)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  afterAll(closeDb);

  it("records one payment split across deals, and refuses the wrong person", async () => {
    const { submitPayouts } = await import("./forms");
    // Deals where the closer is still owed more than this payout, so it fits.
    const { loadLedger } = await import("./ledger/repo");
    const open = (await loadLedger("2026-10-20")).filter(
      (d) => d.stage !== "cancelled" && d.installer && d.closer && d.installer.id !== d.closer.id && (d.payoutPositions.find((p) => p.kind === "closer")?.openCents ?? 0) > 20000,
    );
    const [a, b] = open.map((d) => ({ id: d.id, closer_id: d.closer!.id, installer_id: d.installer!.id }));
    const before = (await loadDeal(a!.id))!.payouts.length;
    const res = await submitPayouts({
      payRun: "2026-10-23", paidOn: "2026-10-20",
      payees: [{ personId: a!.closer_id, method: "check", reference: "1206", lines: [{ dealId: a!.id, kind: "closer", amountCents: 12345 }] }],
    });
    expect(res).toEqual({ people: 1, lines: 1, totalCents: 12345 });
    const d = (await loadDeal(a!.id))!;
    expect(d.payouts.length).toBe(before + 1);
    const row = await db().query("select method, note, paid_on, pay_run from payouts where deal_id = $1 and amount_cents = 12345 order by created_at desc limit 1", [a!.id]);
    expect(row.rows[0]).toMatchObject({ method: "check", note: "Check #1206", paid_on: "2026-10-20", pay_run: "2026-10-23" });
    // All or nothing: a bad second person rolls back the first.
    const count = async () => Number((await db().query("select count(*) n from payouts")).rows[0].n);
    const n0 = await count();
    await expect(
      submitPayouts({
        payRun: "2026-10-23", paidOn: "2026-10-20",
        payees: [
          { personId: a!.closer_id, method: "zelle", lines: [{ dealId: a!.id, kind: "closer", amountCents: 100 }] },
          { personId: b!.installer_id, method: "zelle", lines: [{ dealId: b!.id, kind: "closer", amountCents: 100 }] },
        ],
      }),
    ).rejects.toThrow(/isn't the closer/);
    expect(await count()).toBe(n0);
    // Can't pay more than is still owed (a double click / stale tab).
    await expect(
      submitPayouts({ payRun: "2026-10-23", paidOn: "2026-10-20", payees: [{ personId: a!.closer_id, method: "zelle", lines: [{ dealId: a!.id, kind: "closer", amountCents: 999_999_00 }] }] }),
    ).rejects.toThrow(/still owed|paid in full/);
    // The pay run screen's single payout has the same guard, including who it's paid to.
    const { recordPayout } = await import("./ledger/money-events");
    await expect(recordPayout({ dealId: a!.id, kind: "closer", personId: a!.installer_id, amountCents: 100, paidOn: "2026-10-20" }, "test")).rejects.toThrow(/not the person picked/);
    await expect(recordPayout({ dealId: a!.id, kind: "closer", personId: a!.closer_id, amountCents: 100, paidOn: "2026-10-20", payRun: "2026-10-22" }, "test")).rejects.toThrow(/Fridays/);
    await expect(submitPayouts({ payRun: "2026-10-22", paidOn: "2026-10-20", payees: [{ personId: a!.closer_id, method: "zelle", lines: [{ dealId: a!.id, kind: "closer", amountCents: 1 }] }] })).rejects.toThrow(/Fridays/);
    const sub = await db().query("select kind, payload->>'totalCents' t from form_submissions where kind = 'payout' order by created_at desc limit 1");
    expect(sub.rows[0]).toEqual({ kind: "payout", t: "12345" });
  });
});
