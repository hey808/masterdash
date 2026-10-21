import { describe, expect, it } from "vitest";
import { buildPayRun, payDateFor, payWeek } from "./payrun";
import type { Deal } from "./types";

const brock = { id: "b", name: "Brock" };
const angel = { id: "a", name: "Angel" };
const deal = (o: Partial<Deal>): Deal => ({
  id: "d1", number: 1001, version: 1, location: "wilmington", customerName: "Smith", customerAddress: null, saleDate: "2026-10-01",
  leadSource: null, externalRef: null, closer: brock, manager: null, setter: null, canvasser: null, installer: angel,
  priceCents: 749500, cashPortionCents: 749500, cardPortionCents: 0, financedPortionCents: 0, splitException: null, lender: null, lenderRate: 0,
  commissionRate: 0.15, commissionRateSource: "plan", managerRate: 0, setterRate: 0, canvasserRate: 0, adminFeeCents: 25000,
  extrasCents: 0, installerPayCents: 125000, loanInterestOverrideCents: null, cardFeeOverrideCents: null, fundingExpectedOverrideCents: null,
  cogsOverrideCents: null, overrideReason: null, installScheduledOn: null, installedOn: "2026-10-05", cancelledAt: null, closedAt: null,
  note: null, lines: [], payments: [], payouts: [], ...o,
});
const pay = (receivedOn: string | null, amountCents = 749500) => ({ id: `p-${receivedOn}`, source: "customer" as const, method: "check", amountCents, feeCents: 0, receivedOn });

describe("pay week", () => {
  it("runs Friday; covers the previous Friday through Thursday", () => {
    expect(payWeek("2026-10-23")).toEqual({ payDate: "2026-10-23", start: "2026-10-16", cutoff: "2026-10-22", runEnd: "2026-10-29" });
  });
  it("any day belongs to the coming Friday (Friday to itself)", () => {
    expect(payDateFor("2026-10-20")).toBe("2026-10-23"); // Tue
    expect(payDateFor("2026-10-23")).toBe("2026-10-23"); // Fri
    expect(payDateFor("2026-10-24")).toBe("2026-10-30"); // Sat
  });
});

describe("pay run", () => {
  it("installed earlier + paid in full by Thursday midnight: due this Friday", () => {
    const run = buildPayRun([deal({ payments: [pay("2026-10-22")] })], "2026-10-23");
    const closer = run.lines.find((l) => l.kind === "closer")!;
    expect(closer.isNew).toBe(true);
    expect(closer.unlockedBy).toBe("customer paid in full 2026-10-22");
    expect(run.lines.find((l) => l.kind === "installer")).toBeDefined(); // installer waits for the money too
    expect(run.collections).toHaveLength(1);
    expect(run.collections[0]!.completesDeal).toBe(true);
    expect(run.totals.collectedCents).toBe(749500);
  });

  it("money in on Friday waits for next week's run", () => {
    const run = buildPayRun([deal({ payments: [pay("2026-10-23")] })], "2026-10-23");
    expect(run.lines.find((l) => l.kind === "closer")).toBeUndefined();
    expect(run.waiting.find((w) => w.kind === "closer")!.waitingOn).toMatch(/customer owes/);
    expect(run.collections).toHaveLength(0);
  });

  it("no carryovers: something payable in an earlier week isn't in this run", () => {
    const run = buildPayRun([deal({ payments: [pay("2026-10-08")] })], "2026-10-23");
    expect(run.lines).toHaveLength(0);
    expect(run.totals.dueCents).toBe(0);
  });

  it("paid in full earlier, installed this week: due this Friday", () => {
    const run = buildPayRun([deal({ installedOn: "2026-10-19", payments: [pay("2026-10-08")] })], "2026-10-23");
    const closer = run.lines.find((l) => l.kind === "closer")!;
    expect(closer.unlockedBy).toBe("installed 2026-10-19");
  });

  it("paid in full but not installed by the cutoff: waiting, not due", () => {
    const run = buildPayRun([deal({ installedOn: null, payments: [pay("2026-10-20")] })], "2026-10-23");
    expect(run.lines).toHaveLength(0);
    expect(run.waiting.find((w) => w.kind === "closer")!.waitingOn).toBe("install not done");
  });

  it("a payout recorded on Friday counts as paid in this run and leaves nothing remaining", () => {
    const d = deal({ payments: [pay("2026-10-20")], payouts: [{ id: "x", kind: "closer", personId: "b", amountCents: 108675, paidOn: "2026-10-23" }] });
    const closer = buildPayRun([d], "2026-10-23").lines.find((l) => l.kind === "closer")!;
    expect(closer.dueCents).toBe(108675);
    expect(closer.paidThisRunCents).toBe(108675);
    expect(closer.remainingCents).toBe(0);
    expect(closer.payoutIds).toEqual(["x"]);
  });

  it("a payout paid early (Tuesday) but tagged for Friday's run counts in Friday's run, not last week's", () => {
    const d = deal({ payments: [pay("2026-10-20")], payouts: [{ id: "y", kind: "closer", personId: "b", amountCents: 108675, paidOn: "2026-10-20", payRun: "2026-10-23" }] });
    const closer = buildPayRun([d], "2026-10-23").lines.find((l) => l.kind === "closer")!;
    expect(closer.paidThisRunCents).toBe(108675);
    expect(closer.remainingCents).toBe(0);
    expect(buildPayRun([d], "2026-10-16").lines.find((l) => l.kind === "closer")).toBeUndefined();
  });

  it("an untagged payout goes by date: the Friday on or before it", () => {
    const d = deal({ payments: [pay("2026-10-13")], payouts: [{ id: "z", kind: "closer", personId: "b", amountCents: 108675, paidOn: "2026-10-20" }] });
    expect(buildPayRun([d], "2026-10-16").lines.find((l) => l.kind === "closer")!.paidThisRunCents).toBe(108675);
  });

  it("installer pay also waits for the money", () => {
    const run = buildPayRun([deal({ installedOn: "2026-10-19" })], "2026-10-23");
    expect(run.lines.find((l) => l.kind === "installer")).toBeUndefined();
    expect(run.waiting.find((w) => w.kind === "installer")!.waitingOn).toMatch(/customer owes/);
  });

  it("undated (imported) money counts as already in, so those deals never land in a run", () => {
    const run = buildPayRun([deal({ payments: [pay(null)] })], "2026-10-23");
    expect(run.lines).toHaveLength(0);
    expect(run.undatedPayments).toBe(1);
  });
});
