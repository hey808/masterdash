import { describe, expect, it } from "vitest";
import { applyRate, toCents } from "../money";
import { derive } from "./derive";
import { payables, receivables, totals } from "./rollups";
import type { Deal } from "./types";

const brock = { id: "p-brock", name: "Brock" };
const mike = { id: "p-mike", name: "Mike" };
const angel = { id: "p-angel", name: "Angel" };

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    number: 1001,
    version: 1,
    location: "wilmington",
    customerName: "Test Customer",
    customerAddress: null,
    saleDate: "2026-09-15",
    leadSource: null,
    externalRef: null,
    closer: brock,
    manager: mike,
    setter: null,
    canvasser: null,
    installer: angel,
    priceCents: 799500,
    cashPortionCents: 0,
    financedPortionCents: 799500,
    splitException: null,
    lender: "ISPC",
    lenderRate: 0.1,
    commissionRate: 0.15,
    commissionRateSource: "plan",
    managerRate: 0.03,
    setterRate: 0.01,
    canvasserRate: 0.01,
    adminFeeCents: 25000,
    extrasCents: 0,
    installerPayCents: 125000,
    loanInterestOverrideCents: null,
    cardFeeOverrideCents: null,
    fundingExpectedOverrideCents: null,
    cogsOverrideCents: null,
    overrideReason: null,
    installScheduledOn: "2026-09-20",
    installedOn: null,
    cancelledAt: null,
    closedAt: null,
    note: null,
    lines: [{ skuCode: "CHLOR-A-SOFT-SYS", qty: 1, unitCostCents: 85000 }],
    payments: [],
    payouts: [],
    ...over,
  };
}

const AS_OF = "2026-10-20";

describe("money", () => {
  it("parses dollars to cents without float drift", () => {
    expect(toCents("$7,495.00")).toBe(749500);
    expect(toCents(224.1)).toBe(22410);
    expect(toCents("1041.825")).toBe(104183);
    expect(toCents("(12.50)")).toBe(-1250);
    expect(toCents("")).toBeNull();
  });
  it("rounds rate math half away from zero", () => {
    expect(applyRate(724500, 0.15)).toBe(108675);
    expect(applyRate(694550, 0.15)).toBe(104183); // 1041.8250 → 1041.83, as Mission Control showed
  });
});

describe("derive: Mission Control regressions", () => {
  it("charges the lender fee on the financed portion only", () => {
    const d = derive(deal({ cashPortionCents: 450000, financedPortionCents: 350000, priceCents: 800000 }), AS_OF);
    expect(d.loanInterestCents).toBe(35000); // 10% of $3,500, not of $8,000
  });

  it("net profit subtracts the fee in dollars, not the rate", () => {
    const d = derive(deal(), AS_OF);
    // net revenue 7995 − 799.50 = 7195.50; base 6945.50; 15% = 1041.83; 3% = 208.37
    expect(d.netRevenueCents).toBe(719550);
    expect(d.commissionBaseCents).toBe(694550);
    expect(d.commissionCents).toBe(104183);
    expect(d.managerOverrideCents).toBe(20837);
    expect(d.netProfitCents).toBe(719550 - 104183 - 20837 - 85000 - 125000);
  });

  it("balance is price minus collected, since the lender funds the gross ticket", () => {
    const d = derive(deal({ payments: [{ source: "lender", method: "lender", amountCents: 719550, feeCents: 0, receivedOn: "2026-09-30" }] }), AS_OF);
    expect(d.fundingDueCents).toBe(0);
    expect(d.balanceCents).toBe(79950);
  });

  it("aggregates several deposits into one deal (Caudell: $5,000 + $2,495)", () => {
    const d = derive(
      deal({
        priceCents: 749500, cashPortionCents: 749500, financedPortionCents: 0, lender: null,
        payments: [
          { source: "customer", method: "check", amountCents: 500000, feeCents: 0, receivedOn: "2026-08-10" },
          { source: "customer", method: "zelle", amountCents: 249500, feeCents: 0, receivedOn: "2026-08-20" },
        ],
      }),
      AS_OF,
    );
    expect(d.cashDueCents).toBe(0);
    expect(d.collectedCents).toBe(749500);
  });

  it("honors the stamped manager rate (0 when the plan said no override)", () => {
    expect(derive(deal({ closer: mike, managerRate: 0 }), AS_OF).managerOverrideCents).toBe(0);
    expect(derive(deal({ closer: mike, managerRate: 0.03 }), AS_OF).managerOverrideCents).toBe(20837);
  });

  it("admin fee comes off the commission base but stays in profit", () => {
    const a = derive(deal({ adminFeeCents: 0 }), AS_OF);
    const b = derive(deal({ adminFeeCents: 25000 }), AS_OF);
    expect(a.commissionBaseCents - b.commissionBaseCents).toBe(25000);
    expect(b.netProfitCents! - a.netProfitCents!).toBeGreaterThan(0); // less commission paid out
  });
});

describe("derive: what the new ledger adds", () => {
  it("recognizes revenue in the install month, not the sale month", () => {
    const d = derive(deal({ saleDate: "2026-09-28", installedOn: "2026-10-03" }), AS_OF);
    expect(d.saleMonth).toBe("2026-09");
    expect(d.revenueMonth).toBe("2026-10");
  });

  it("uses the rates stamped on the deal, whatever today's plan says", () => {
    expect(derive(deal({ commissionRate: 0.1 }), AS_OF).commissionCents).toBe(applyRate(694550, 0.1));
  });

  it("owed = earned − paid, from payout rows", () => {
    const d = derive(deal({ payouts: [{ kind: "closer", personId: brock.id, amountCents: 50000, paidOn: "2026-10-01" }] }), AS_OF);
    const closer = d.payoutPositions.find((p) => p.kind === "closer")!;
    expect(closer.paidCents).toBe(50000);
    expect(closer.openCents).toBe(104183 - 50000);
  });

  it("nothing is payable until the install is done and the money is collected", () => {
    const paid = { source: "lender" as const, method: "lender", amountCents: 719550, feeCents: 0, receivedOn: "2026-09-30" };
    const notInstalled = derive(deal({ payments: [paid] }), AS_OF).payoutPositions;
    expect(notInstalled.every((p) => !p.payable && p.waitingOn === "install not done")).toBe(true);

    const notPaid = derive(deal({ installedOn: "2026-09-20" }), AS_OF).payoutPositions;
    expect(notPaid.every((p) => !p.payable && /ISPC has not funded/.test(p.waitingOn!))).toBe(true);

    const neither = derive(deal(), AS_OF).payoutPositions.find((p) => p.kind === "closer")!;
    expect(neither.waitingOn).toMatch(/^install not done; ISPC has not funded/);

    const both = derive(deal({ installedOn: "2026-09-20", payments: [paid] }), AS_OF).payoutPositions;
    expect(both.every((p) => p.payable)).toBe(true);
  });

  it("flags the problems the old ledger let through", () => {
    const d = derive(deal({ lines: [], installerPayCents: null, installScheduledOn: "2026-10-01" }), AS_OF);
    expect(d.issues).toEqual(expect.arrayContaining(["No products", "No installer pay", "Install date passed"]));
    expect(d.isCosted).toBe(false);
    expect(d.netProfitCents).toBeNull();
  });

  it("walks the lifecycle: sold → installed → collected → closed", () => {
    expect(derive(deal(), AS_OF).stage).toBe("sold");
    expect(derive(deal({ installedOn: "2026-09-20" }), AS_OF).stage).toBe("installed");
    const paid = { source: "lender" as const, method: "lender", amountCents: 719550, feeCents: 0, receivedOn: "2026-09-30" };
    expect(derive(deal({ installedOn: "2026-09-20", payments: [paid] }), AS_OF).stage).toBe("collected");
    expect(derive(deal({ installedOn: "2026-09-20", payments: [paid], closedAt: "2026-10-01T00:00:00Z" }), AS_OF).stage).toBe("closed");
    expect(derive(deal({ cancelledAt: "2026-09-16T00:00:00Z" }), AS_OF).stage).toBe("cancelled");
  });
});

describe("rollups", () => {
  it("keeps sold-not-installed balances out of receivables", () => {
    const rows = [derive(deal({ id: "a" }), AS_OF), derive(deal({ id: "b", installedOn: "2026-09-20" }), AS_OF)];
    const ar = receivables(rows, AS_OF);
    expect(ar).toHaveLength(1);
    expect(ar[0]!.dealId).toBe("b");
    expect(ar[0]!.daysOpen).toBe(30);
  });

  it("totals ignore cancelled deals", () => {
    const rows = [derive(deal({ id: "a" }), AS_OF), derive(deal({ id: "b", cancelledAt: "2026-09-16T00:00:00Z", cancelReason: "x" } as Partial<Deal>), AS_OF)];
    expect(totals(rows, AS_OF).deals).toBe(1);
    expect(payables(rows).every((p) => p.dealId === "a")).toBe(true);
  });
});
